import type { Scenario } from "./types";

export const virtualThreadsRealProblems: Scenario = {
  id: "virtual-threads-real-problems",
  title: "Virtual Threads, Real Problems",
  subtitle: "payments-api crawls to a halt under load, with zero errors anywhere",
  difficulty: "hard",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 30,
  tags: ["java25", "virtual-threads", "concurrency", "containers"],
  briefing: `"payments-api" was migrated to Java 25 last week, and the team flipped on
\`spring.threads.virtual.enabled: true\` expecting it to handle far more
concurrent requests per pod. At low traffic it's fine. During the lunch
rush, p99 latency blows past 10 seconds and requests start timing out - but
there isn't a single error in the logs, no restarts, no OOM, and every
health check still passes. CPU on the pod pins near 100% of its (small)
limit while most requests just sit there.`,
  constraints: [
    "There's no live thread dump command in this console - the JVM was started with `-Djdk.tracePinnedThreads=full` for exactly this kind of investigation, so reason from what that prints to the logs instead.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "payments-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/payments-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "payments" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "b4c5d6e7f8a9" }, health: { status: "Healthy" } },
        age: "5h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payments-api", namespace: "payments", labels: { app: "payments-api" } },
        spec: {
          replicas: 4,
          template: {
            spec: {
              containers: [
                {
                  name: "payments-api",
                  image: "registry.internal/payments-api:3.9.0",
                  env: [
                    { name: "JAVA_TOOL_OPTIONS", value: "-Djdk.tracePinnedThreads=full" },
                    { name: "SPRING_THREADS_VIRTUAL_ENABLED", value: "true" },
                  ],
                  resources: { requests: { cpu: "500m", memory: "512Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
                  ports: [{ containerPort: 8080 }],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "5h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payments-api-5f6e7d8c9-x1a2b", namespace: "payments", labels: { app: "payments-api" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "payments-api", ready: true, restartCount: 0, state: { running: {} } }],
        },
        events: [
          { type: "Normal", reason: "Scheduled", age: "5h", message: "Successfully assigned payments/payments-api-5f6e7d8c9-x1a2b to node-2" },
          { type: "Normal", reason: "Started", age: "5h", message: "Started container payments-api" },
        ],
        logs: {
          "payments-api": [
            "2026-09-15T12:02:01.114Z INFO  c.e.payments.ChargeController - charging order-55210",
            "2026-09-15T12:02:01.119Z WARN  [jdk.tracePinnedThreads] Thread[#87,ForkJoinPool-1-worker-3,5,CarrierThreads]",
            "    java.base/java.lang.VirtualThread$VThreadContinuation.onPinned(VirtualThread.java:183)",
            "    java.base/java.lang.VirtualThread.park(VirtualThread.java:670)",
            "    app//com.example.payments.LegacyCacheClient.get(LegacyCacheClient.java:42) <== monitors:1",
            "    app//com.example.payments.ChargeController.charge(ChargeController.java:58)",
            "2026-09-15T12:02:01.980Z WARN  [jdk.tracePinnedThreads] Thread[#91,ForkJoinPool-1-worker-1,5,CarrierThreads]",
            "    java.base/java.lang.VirtualThread$VThreadContinuation.onPinned(VirtualThread.java:183)",
            "    java.base/java.lang.VirtualThread.park(VirtualThread.java:670)",
            "    app//com.example.payments.LegacyCacheClient.get(LegacyCacheClient.java:42) <== monitors:1",
            "    app//com.example.payments.ChargeController.charge(ChargeController.java:58)",
            "2026-09-15T12:02:02.310Z INFO  c.e.payments.ChargeController - charging order-55214",
          ],
        },
        age: "5h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "payments-api-notes", namespace: "payments" },
        spec: {
          data: {
            "LegacyCacheClient.java.excerpt":
              "public class LegacyCacheClient {\n    private final Map<String, Object> cache = new HashMap<>();\n\n    public synchronized Object get(String key) {\n        // blocking native call into the on-box cache daemon\n        return nativeLookup(key);\n    }\n}\n",
          },
        },
        age: "5h",
      },
    ],
  },
  hints: [
    "`kubectl logs payments-api-5f6e7d8c9-x1a2b -n payments` - the JVM was started with `-Djdk.tracePinnedThreads=full` (see the Deployment's env). Every `[jdk.tracePinnedThreads]` line it prints is the JVM telling you a virtual thread got stuck holding a platform (carrier) thread hostage.",
    "Look at the frame marked `<== monitors:1` in that trace, then check `payments-api-notes` for what that method actually does.",
    "`kubectl describe deployment payments-api -n payments` - note the container's CPU `limits`/`requests`. Virtual threads run on top of a small, fixed pool of \"carrier\" platform threads, sized to the number of CPUs the container can actually see.",
  ],
  options: [
    {
      id: "synchronized-pinning",
      label:
        "`LegacyCacheClient.get()` is `synchronized` around a blocking call, which pins the virtual thread to its carrier thread for the whole call; with only a couple of carrier threads (sized to the container's small CPU limit), a few pinned requests are enough to starve every other virtual thread.",
      explanation:
        "The `-Djdk.tracePinnedThreads=full` output is the direct evidence: every pinned trace points at `LegacyCacheClient.get(LegacyCacheClient.java:42) <== monitors:1`, which the ConfigMap shows is a `synchronized` method wrapping a blocking native call. Virtual threads that block inside a `synchronized` block can't unmount from their carrier thread - they pin it. With `resources.limits.cpu: 500m`, this container only has a couple of carrier threads to begin with, so a handful of pinned calls is enough to stall the whole pod, with no errors, no crashes, and no capacity signal Kubernetes would ever flag.",
    },
    {
      id: "not-enough-cpu",
      label: "The pod simply doesn't have enough CPU allocated to handle lunch-rush traffic.",
      explanation:
        "A tight CPU limit would show up as proportionally worse latency across the board as load rises, not a hard wall where most virtual threads sit idle while CPU pins at 100%. The pinned-thread trace shows the real bottleneck is monitor contention on a tiny number of carrier threads, not raw CPU starvation.",
    },
    {
      id: "connection-pool-too-small",
      label: "The connection pool to the payments database is too small for the concurrent load.",
      explanation:
        "There's no evidence of connection pool exhaustion anywhere - no pool-timeout errors, no waiting-for-connection log lines. Every clue in the logs points at the JVM's own virtual-thread pinning diagnostics, not the database layer.",
    },
    {
      id: "virtual-thread-memory-leak",
      label: "Virtual threads leak memory under sustained load, eventually causing long GC pauses.",
      explanation:
        "There's no memory growth, no GC log noise, and no OOM anywhere in this incident - CPU is pinned and most threads are idle-blocked, which isn't a memory or GC symptom at all.",
    },
  ],
  correctOptionId: "synchronized-pinning",
  resolution: `The Deployment's \`JAVA_TOOL_OPTIONS\` includes
\`-Djdk.tracePinnedThreads=full\`, and the pod's logs are full of exactly the
output that flag exists to produce - virtual threads getting pinned, every
single time, at the same call site: \`LegacyCacheClient.get()\`, marked
\`<== monitors:1\`. \`payments-api-notes\` shows why: that method is
\`synchronized\` around a blocking call into a native cache daemon.

Virtual threads normally "unmount" from their carrier (platform) thread the
moment they block, freeing the carrier to run other virtual threads - that's
the entire point of the feature, and why \`spring.threads.virtual.enabled\`
promised so much more concurrency per pod. But a virtual thread that blocks
*while holding a Java monitor* (i.e. inside a \`synchronized\` block or
method) cannot unmount - the JVM pins it to its carrier thread until it
exits the monitor, exactly as if it were a plain platform thread.

Container CPU limits make this far worse than it would be on a full-core
host: the number of carrier threads is sized to the number of CPUs the
container can see, and \`resources.limits.cpu: 500m\` on \`payments-api\`
leaves it only one or two. It takes just a couple of concurrently pinned
requests to occupy every carrier thread, at which point *every other*
virtual thread in the process - regardless of what it's doing - has nowhere
to run. Nothing crashes, nothing logs an error, and every health check
still passes, because the process itself is alive and technically
responsive; it's just serialized behind a handful of blocked monitors.

The fix is to stop pinning: replace the \`synchronized\` block with a
non-blocking-friendly lock that virtual threads can suspend under, e.g.
\`java.util.concurrent.locks.ReentrantLock\`:

\`\`\`java
private final ReentrantLock lock = new ReentrantLock();

public Object get(String key) {
    lock.lock();
    try {
        return nativeLookup(key);
    } finally {
        lock.unlock();
    }
}
\`\`\`

\`ReentrantLock\` lets a blocked virtual thread unmount from its carrier just
like any other blocking call, so one slow cache lookup no longer holds the
whole pod hostage.`,
};
