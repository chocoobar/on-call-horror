import type { Scenario } from "../types";

export const thePercentageThatWasntEnough: Scenario = {
  id: "the-percentage-that-wasnt-enough",
  title: "The Percentage That Wasn't Enough",
  subtitle: "batch-import-api gets OOMKilled only during its own busiest hour, despite MaxRAMPercentage being 'correctly' configured",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "containers", "memory"],
  briefing: `"batch-import-api" was tuned months ago with \`-XX:MaxRAMPercentage=70.0\`
after the last memory incident, and it's been solid ever since - except
during its own daily peak import window, when concurrent request volume
spikes 10x for about twenty minutes and the pod occasionally gets
OOMKilled anyway, despite heap usage reportedly staying well under
control the whole time.`,
  constraints: [
    "Heap usage graphs (from a monitoring tool outside this console) are confirmed to stay comfortably under the configured heap ceiling throughout the incident.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "batch-import-api", namespace: "data-platform", labels: { app: "batch-import-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "batch-import-api",
                  image: "registry.internal/batch-import-api:3.4.0",
                  env: [{ name: "JAVA_TOOL_OPTIONS", value: "-XX:MaxRAMPercentage=70.0" }],
                  resources: { requests: { memory: "1Gi" }, limits: { memory: "1Gi" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "batch-import-api-9k0l1m2n3-o4p5q", namespace: "data-platform", labels: { app: "batch-import-api" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "batch-import-api",
              ready: true,
              restartCount: 3,
              state: { running: {} },
              lastState: { terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-14T09:00:00Z", finishedAt: "2026-09-15T09:14:02Z" } },
            },
          ],
        },
        events: [
          { type: "Warning", reason: "OOMKilling", age: "20m", message: "Memory cgroup out of memory: Killed process (java) total-vm:1180212kB, anon-rss:1019340kB" },
        ],
        logs: {
          "batch-import-api": [
            "2026-09-15T09:13:50.114Z INFO  c.e.dataplatform.ImportController - handling burst of 240 concurrent import requests (peak window)",
            "2026-09-15T09:14:01.220Z INFO  c.e.dataplatform.ImportController - heap after last import: used=520M committed=700M max=716M",
            "2026-09-15T09:14:02.010Z WARN  o.a.tomcat.util.threads.ThreadPoolExecutor - request queue growing, active worker threads: 200",
          ],
        },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "batch-import-api-notes", namespace: "data-platform" },
        spec: {
          data: {
            "notes.md":
              "`MaxRAMPercentage=70.0` on a 1Gi container bounds heap around ~716M,\nwhich the logs confirm is being respected. Tomcat's `server.tomcat.threads.max`\nis left at its default of 200. Each of Tomcat's worker threads gets its\nown fixed-size thread stack (`-Xss`, defaulting to roughly 1MB on this\nplatform) allocated *outside* the heap. During the peak window, request\nvolume is high enough to actually spin up close to the full 200-thread\npool concurrently, rather than the handful of threads typically active\nthe rest of the day.",
          },
        },
        age: "40d",
      },
    ],
  },
  hints: [
    "`kubectl logs batch-import-api-9k0l1m2n3-o4p5q -n data-platform` - heap usage is confirmed well under its own ceiling (`used=520M ... max=716M`) right before the kill. If heap isn't the problem, what else is using memory in this container?",
    "`kubectl describe pod batch-import-api-9k0l1m2n3-o4p5q -n data-platform` - the OOM event's `anon-rss` is very close to the full 1Gi container limit, not just the ~716M heap ceiling.",
    "`kubectl get configmap batch-import-api-notes -n data-platform -o yaml` - how many Tomcat worker threads are actually active during the peak window, and how much memory does each one cost outside the heap?",
  ],
  options: [
    {
      id: "thread-stacks-under-peak-concurrency-push-past-limit",
      label:
        "`MaxRAMPercentage=70.0` correctly bounds the *heap* to ~716M and heap usage stays well under that the whole time - but Tomcat's default 200-thread pool, with each thread's stack allocated outside the heap, only ever approaches its full size during the daily peak window's 10x concurrency spike; that many simultaneous thread stacks, on top of an already-near-full heap allocation, is enough non-heap memory to push total container usage past the 1Gi limit and trigger an OOMKill that heap metrics alone never explain.",
      explanation:
        "The application's own log confirms heap is fine right up to the kill: `used=520M committed=700M max=716M`, comfortably under its ceiling. But the OOM event's `anon-rss:1019340kB` is right at the full 1Gi container limit - meaning something outside heap accounts for the gap. `batch-import-api-notes` shows what: nearly 200 concurrently active Tomcat worker threads during the peak burst, each with its own ~1MB stack allocated outside the heap - a cost that's negligible most of the day at low concurrency, but adds up to hundreds of megabytes exactly when the peak window's 10x request volume actually uses most of that thread pool at once.",
    },
    {
      id: "max-ram-percentage-not-applied",
      label: "`MaxRAMPercentage` isn't actually being applied, so the JVM is using more heap than intended.",
      explanation:
        "The application's own log confirms heap is capped correctly at `max=716M`, matching what `MaxRAMPercentage=70.0` on a 1Gi container should produce - the flag is working exactly as configured, and heap usage never gets close to that ceiling during the incident.",
    },
    {
      id: "connection-pool-exhaustion-during-peak",
      label: "The database connection pool is being exhausted during the peak import window, causing memory buildup.",
      explanation:
        "There's no connection pool error, warning, or exhaustion signal anywhere in the logs - the only warning present is about Tomcat's thread pool queue growing under load, which is a request-handling capacity signal, not evidence of a database connection leak or buildup.",
    },
    {
      id: "not-enough-replicas-for-peak-load",
      label: "Two replicas isn't enough capacity to absorb the daily 10x peak load.",
      explanation:
        "Replica count affects overall throughput capacity, not whether an individual pod's container memory limit gets exceeded - the OOM event's RSS figure landing right at this single container's own 1Gi limit points at a per-pod memory accounting problem, not a fleet-wide capacity shortfall.",
    },
  ],
  correctOptionId: "thread-stacks-under-peak-concurrency-push-past-limit",
  resolution: `The application's own log confirms heap is exactly where it should be:
\`used=520M committed=700M max=716M\`, comfortably under the ceiling
\`MaxRAMPercentage=70.0\` produces on a 1Gi container. And yet the OOM
event's \`anon-rss:1019340kB\` sits almost exactly at the full 1Gi
container limit - meaning roughly 300MB of memory beyond heap's own
ceiling was in use at the moment of the kill.

\`batch-import-api-notes\` accounts for the gap: Tomcat's worker thread pool
is left at its default \`server.tomcat.threads.max: 200\`, and each worker
thread's stack (\`-Xss\`, roughly 1MB by default on this platform) is
allocated entirely outside the JVM heap - invisible to \`MaxRAMPercentage\`
and to heap usage graphs alike. For most of the day, only a handful of
threads are ever active at once and this overhead is negligible. But
during the daily peak window, request volume spikes enough to actually
use close to the full 200-thread pool concurrently - and 200 threads'
worth of stacks, on top of an already near-ceiling heap, is enough
non-heap memory to push the container past its 1Gi limit.

The fix is accounting for thread stack overhead when sizing both the
heap percentage and the thread pool together, rather than tuning heap in
isolation:

\`\`\`yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-XX:MaxRAMPercentage=55.0 -Xss512k"
\`\`\`

\`\`\`yaml
server:
  tomcat:
    threads:
      max: 120
resources:
  limits:
    memory: 1536Mi
\`\`\`

\`MaxRAMPercentage\` only ever bounds the heap - the rest of a container's
memory budget (thread stacks, Metaspace, JIT code cache, direct buffers)
needs its own explicit headroom, and that headroom has to be sized for
worst-case concurrency, not average-case, since thread stack count scales
directly with how many requests are actually in flight at once.`,
};
