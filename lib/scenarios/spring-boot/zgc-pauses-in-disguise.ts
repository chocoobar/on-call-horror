import type { Scenario } from "../types";

export const zgcPausesInDisguise: Scenario = {
  id: "zgc-pauses-in-disguise",
  title: "ZGC Pauses in Disguise",
  subtitle: "analytics-aggregator drops health checks for a couple seconds, every few minutes, under load",
  difficulty: "hard",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 25,
  tags: ["java25", "gc", "performance"],
  briefing: `"analytics-aggregator" switched to Generational ZGC last quarter for its
much lower typical pause times, and it's been great - except during its
daily batch-heavy window, when it now fails a couple of health checks
every few minutes, each time recovering on its own within a couple of
seconds.`,
  constraints: [
    "This only happens during the batch-heavy window, when the service processes large in-memory aggregation batches - it's rock solid the rest of the day under normal request traffic.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "analytics-aggregator", namespace: "analytics", labels: { app: "analytics-aggregator" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "analytics-aggregator",
                  image: "registry.internal/analytics-aggregator:4.2.0",
                  env: [{ name: "JAVA_TOOL_OPTIONS", value: "-XX:+UseZGC -XX:+ZGenerational -Xmx4g" }],
                  livenessProbe: { httpGet: { path: "/actuator/health", port: 8080 }, periodSeconds: 5, failureThreshold: 1, timeoutSeconds: 1 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "analytics-aggregator-5u6v7w8x9-y0z1a", namespace: "analytics", labels: { app: "analytics-aggregator" } },
        status: { phase: "Running", containerStatuses: [{ name: "analytics-aggregator", ready: true, restartCount: 3, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "4m", message: "Liveness probe failed: Get \"http://10.244.2.9:8080/actuator/health\": context deadline exceeded" },
        ],
        logs: {
          "analytics-aggregator": [
            "2026-09-15T14:02:00.011Z INFO  c.e.analytics.BatchAggregator - aggregating batch region-eu, 2100000 records, single large result array",
            "2026-09-15T14:02:01.884Z INFO  [gc] GC(311) Pause Relocate Start 0.021ms",
            "2026-09-15T14:02:03.910Z INFO  [gc] GC(311) Pause Relocate End 2010.442ms",
            "2026-09-15T14:02:03.998Z INFO  c.e.analytics.BatchAggregator - batch region-eu aggregated in 3987ms",
          ],
        },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "analytics-aggregator-notes", namespace: "analytics" },
        spec: {
          data: {
            "notes.md":
              "Generational ZGC's low-pause design relies on most objects dying young\nand being collected cheaply in the young generation. `BatchAggregator`\nbuilds one very large single array (millions of entries) to hold an\nentire batch's results, which is allocated once, lives long enough to be\npromoted to the old generation, and has to be handled by ZGC's\nrelocation phase like any other old-generation memory. The liveness\nprobe has `failureThreshold: 1` and `timeoutSeconds: 1` - a single slow\nresponse anywhere fails it immediately.\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl logs analytics-aggregator-5u6v7w8x9-y0z1a -n analytics` - the `[gc]` log lines are printed by the JVM itself. How long did that one 'Pause Relocate' actually take?",
    "`kubectl get configmap analytics-aggregator-notes -n analytics -o yaml` - what does `BatchAggregator` actually allocate, and how does that interact with a generational collector's assumption that most objects die young?",
    "`kubectl get deployment analytics-aggregator -n analytics -o yaml` - look at the liveness probe's `failureThreshold` and `timeoutSeconds` together. How much slack does it actually have for even a single slow response?",
  ],
  options: [
    {
      id: "large-long-lived-allocation-plus-strict-probe",
      label:
        "BatchAggregator builds one huge, long-lived array per batch that gets promoted out of the young generation, which ZGC's relocation phase then has to handle like any other old-gen memory - producing a real ~2-second pause during heavy batch processing - and the liveness probe's `failureThreshold: 1`/`timeoutSeconds: 1` gives it zero tolerance for even one slow response, so that single pause is enough to fail a health check outright.",
      explanation:
        "The GC log line shows a real, non-trivial pause (\"Pause Relocate ... 2010.442ms\") lining up almost exactly with the liveness probe's own \"context deadline exceeded\" failure a few minutes later. `analytics-aggregator-notes` explains the mechanism: Generational ZGC gets its low pause times from the assumption that most allocations die young and never need expensive handling - a single large, long-lived array defeats that assumption and lands in the same relocation work ZGC has to do for any old-generation memory. With `failureThreshold: 1` and a 1-second timeout, the probe has no room to absorb even one occasional multi-second pause, so a real but infrequent GC event becomes a liveness failure every time it happens.",
    },
    {
      id: "zgc-misconfigured",
      label: "ZGC itself is misconfigured and not actually running in low-pause mode.",
      explanation:
        "`-XX:+UseZGC -XX:+ZGenerational` are both present and correct, and the pause observed (about 2 seconds) is a real, occasional cost of handling large long-lived allocations, not evidence that ZGC is silently falling back to a different, unintended collection mode - the service is otherwise stable and fast the rest of the day, exactly as expected under a working low-pause collector.",
    },
    {
      id: "network-blip-during-batch-window",
      label: "A network issue during the batch window is causing the health check requests to fail.",
      explanation:
        "The failure is a timeout on the liveness probe's HTTP call, and the GC log timing lines up precisely with when the failures occur - this points at the process itself being briefly unresponsive during a GC pause, not at anything happening on the network path to reach it.",
    },
    {
      id: "batch-aggregator-cpu-bound",
      label: "BatchAggregator is simply too CPU-intensive during batch processing, starving the health check thread.",
      explanation:
        "The delay shown in the logs is an explicit JVM-reported GC pause (\"Pause Relocate\"), not ordinary application CPU contention - during a true GC safepoint pause, no application thread runs regardless of CPU availability, which is a different mechanism than a thread simply being out-competed for CPU time.",
    },
  ],
  correctOptionId: "large-long-lived-allocation-plus-strict-probe",
  resolution: `The JVM's own GC log names the cost directly: a "Pause Relocate" phase
taking just over 2 seconds, timed almost exactly with the liveness
probe's "context deadline exceeded" failure. \`analytics-aggregator-notes\`
explains why a supposedly low-pause collector produces a multi-second stop
here: Generational ZGC gets its typical low pause times from most objects
dying young and being reclaimed cheaply, without needing full relocation
work. \`BatchAggregator\` allocates one very large array per batch that
survives long enough to be promoted to the old generation - exactly the
kind of allocation pattern that defeats the generational assumption and
falls back to the more expensive relocation path any collector needs for
old-generation memory, generational or not.

None of that would page anyone by itself if the liveness probe had any
slack - but \`failureThreshold: 1\` with a 1-second timeout means a single
slow response, for any reason, is treated as a dead process. A collector
occasionally taking ~2 seconds to relocate a large batch result isn't a
bug; a probe with zero tolerance for that is what turns it into a
restart-triggering incident.

Two independent fixes, both worth doing:

\`\`\`yaml
livenessProbe:
  httpGet: { path: /actuator/health, port: 8080 }
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3   # tolerate an occasional slow response
\`\`\`

and, on the application side, avoiding one giant long-lived array per
batch in favor of streaming/chunked aggregation that doesn't need a
single large object to survive into the old generation at all - reducing
how often ZGC has to do expensive relocation work in the first place,
rather than just tolerating it after the fact.`,
};
