import type { Scenario } from "../types";

export const theManualGcCall: Scenario = {
  id: "the-manual-gc-call",
  title: "The Manual GC Call",
  subtitle: "session-store freezes for a full second, exactly every ten minutes, like clockwork",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "gc", "performance"],
  briefing: `"session-store" has a bizarrely regular hiccup: every ten minutes, on the
dot, every in-flight request stalls for around a second before recovering
instantly. It's too regular to be normal GC behavior, and too short-lived
to be a real outage - but it's happening on every single pod, in sync.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-store", namespace: "platform", labels: { app: "session-store" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "session-store", image: "registry.internal/session-store:1.1.0" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "30d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "session-store-8c9d0e1f2-g3h4i", namespace: "platform", labels: { app: "session-store" } },
        status: { phase: "Running", containerStatuses: [{ name: "session-store", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "session-store": [
            "2026-09-15T12:10:00.010Z INFO  c.e.platform.StatsReporter - reporting session stats to monitoring dashboard",
            "2026-09-15T12:10:00.015Z INFO  [gc] GC(842) Pause Full (System.gc()) 1024M->340M(2048M) 980.442ms",
            "2026-09-15T12:20:00.011Z INFO  c.e.platform.StatsReporter - reporting session stats to monitoring dashboard",
            "2026-09-15T12:20:00.014Z INFO  [gc] GC(843) Pause Full (System.gc()) 1030M->342M(2048M) 1012.115ms",
          ],
        },
        age: "30d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "session-store-notes", namespace: "platform" },
        spec: {
          data: {
            "StatsReporter.java.excerpt":
              "@Scheduled(fixedRate = 600000) // every 10 minutes\npublic void reportStats() {\n    System.gc(); // added a while back to \"get an accurate reading\"\n                  // of live heap before measuring memory stats -\n                  // triggers a full stop-the-world collection\n    long used = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();\n    dashboard.publish(used);\n}\n",
          },
        },
        age: "30d",
      },
    ],
  },
  hints: [
    "`kubectl logs session-store-8c9d0e1f2-g3h4i -n platform` - the `[gc]` line right after `StatsReporter` runs says `Pause Full (System.gc())`. What in the application code could be calling that explicitly?",
    "The pause happens exactly every ten minutes, in lockstep with a `@Scheduled` job - not the somewhat irregular cadence a normal collector picks on its own based on allocation rate.",
    "`kubectl get configmap session-store-notes -n platform -o yaml` - a call to `System.gc()` requests a full, stop-the-world garbage collection immediately, regardless of whether the collector thinks one is actually needed yet.",
  ],
  options: [
    {
      id: "explicit-system-gc-call-every-ten-minutes",
      label:
        "`StatsReporter.reportStats()` calls `System.gc()` directly every ten minutes to get an 'accurate' heap reading before publishing stats, and that call requests an immediate full, stop-the-world garbage collection - which the GC log confirms is exactly what's firing (`Pause Full (System.gc())`, ~1 second each time), in lockstep with the `@Scheduled` job's own fixed ten-minute interval.",
      explanation:
        "The GC log line names its own cause explicitly: `Pause Full (System.gc())` - not an allocation-driven collection the JVM decided it needed, but one requested directly by application code. `session-store-notes` shows exactly where: `reportStats()`, itself scheduled every 600,000ms (ten minutes), calls `System.gc()` before reading memory stats. That call forces a full stop-the-world collection immediately, on demand, which is why the pause lines up so precisely with the scheduled job's own cadence instead of the more irregular timing a collector's own heuristics would normally produce.",
    },
    {
      id: "memory-leak-triggering-frequent-gc",
      label: "A memory leak is causing garbage collections to run more frequently than they should.",
      explanation:
        "A leak-driven GC cadence wouldn't be locked to a precise ten-minute interval matching a `@Scheduled` job exactly - it would track allocation rate and drift over time as the leak grows, which is a very different pattern from the clockwork regularity described and shown in the logs.",
    },
    {
      id: "monitoring-dashboard-blocking-call",
      label: "The call to publish stats to the monitoring dashboard is a slow, blocking network call.",
      explanation:
        "The GC log line itself explicitly attributes the pause to `System.gc()`, a stop-the-world collection - not to a blocking network call, which would show up as ordinary thread blocking time, not a JVM-wide GC safepoint pause reported by the collector's own logging.",
    },
    {
      id: "heap-too-small-for-workload",
      label: "The heap is simply too small for session-store's workload, forcing frequent full collections.",
      explanation:
        "The GC log's before/after heap sizes (`1024M->340M`, `1030M->342M` out of a 2048M max) show plenty of headroom well before each collection - this isn't a heap running out of room and being forced to collect, it's a collection being explicitly requested on a fixed schedule regardless of actual memory pressure.",
    },
  ],
  correctOptionId: "explicit-system-gc-call-every-ten-minutes",
  resolution: `The GC log line names its trigger directly: \`Pause Full (System.gc())\`.
This isn't the collector responding to memory pressure on its own - the
\`(System.gc())\` annotation means something in application code explicitly
requested a full, stop-the-world collection, and it's firing every ten
minutes almost to the millisecond.

\`session-store-notes\` shows exactly where: \`StatsReporter.reportStats()\`,
a \`@Scheduled(fixedRate = 600000)\` job, calls \`System.gc()\` directly
before reading heap usage, apparently added at some point "to get an
accurate reading" of live memory before publishing stats to the
monitoring dashboard. \`System.gc()\` doesn't just hint that a collection
would be nice - by default it forces one immediately, a full stop-the-world
pause, regardless of whether the collector's own heuristics think one is
warranted. Because the job runs on a fixed ten-minute schedule, so does
the forced full GC pause, giving every pod in the fleet the same
suspiciously regular ~1-second freeze in lockstep.

The fix is simply not calling it - modern collectors track live heap size
well enough on their own without forcing a stop-the-world pause to sample
it:

\`\`\`java
@Scheduled(fixedRate = 600000)
public void reportStats() {
    long used = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
    dashboard.publish(used); // System.gc() removed - this reading is
                              // approximate but doesn't cost a full pause
}
\`\`\`

If a genuinely precise, point-in-time live-heap figure is needed, that's
what JFR or a heap histogram (\`jcmd <pid> GC.class_histogram\`) is for -
not a periodic \`System.gc()\` call baked into a scheduled job, which turns
a monitoring convenience into a recurring, fleet-wide latency spike.`,
};
