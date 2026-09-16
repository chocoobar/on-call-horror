import type { Scenario } from "../types";

export const heapThatWasntTheProblem: Scenario = {
  id: "heap-that-wasnt-the-problem",
  title: "The Heap That Wasn't the Problem",
  subtitle: "orders-api gets OOMKilled every few hours, but the heap never gets close to full",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "oomkilled", "memory", "containers"],
  briefing: `"orders-api" (Spring Boot on Java 25) keeps getting killed and restarted
every few hours under completely normal load. Out of caution, someone
already turned the max heap size down. Heap usage graphs confirm it never
gets anywhere near that max. And yet the container still dies - not with a
Java exception, just gone, and back a few seconds later with restartCount
one higher.`,
  constraints: [
    "Nothing in the logs mentions an exception of any kind - whatever is killing this container isn't the JVM catching its own error.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "orders-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/orders-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "orders" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "1a2b3c4d5e6f" }, health: { status: "Degraded" } },
        age: "1d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "orders-api", namespace: "orders", labels: { app: "orders-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "orders-api",
                  image: "registry.internal/orders-api:2.7.1",
                  env: [{ name: "JAVA_TOOL_OPTIONS", value: "-Xmx256m" }],
                  resources: { requests: { memory: "512Mi", cpu: "500m" }, limits: { memory: "512Mi", cpu: "1" } },
                  ports: [{ containerPort: 8080 }],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "orders-api-config", namespace: "orders" },
        spec: {
          data: {
            "application.yml":
              "server:\n  tomcat:\n    threads:\n      max: 800\n      min-spare: 800\n  port: 8080\n",
          },
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "orders-api-9e8d7c6b5-m3n4p", namespace: "orders", labels: { app: "orders-api" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "orders-api",
              ready: true,
              restartCount: 4,
              state: { running: { startedAt: "2026-09-15T09:41:02Z" } },
              lastState: {
                terminated: {
                  reason: "OOMKilled",
                  exitCode: 137,
                  startedAt: "2026-09-15T06:58:10Z",
                  finishedAt: "2026-09-15T09:40:59Z",
                },
              },
            },
          ],
        },
        events: [
          { type: "Warning", reason: "BackOff", age: "2m", message: "Back-off restarting failed container orders-api in pod orders-api-9e8d7c6b5-m3n4p_orders" },
        ],
        logs: {
          "orders-api": [
            "2026-09-15T09:40:03.884Z INFO  c.e.orders.OrderController - created order-99213",
            "2026-09-15T09:40:04.011Z INFO  c.e.orders.OrderController - created order-99214",
            "2026-09-15T09:40:04.502Z INFO  c.e.orders.OrderController - created order-99215",
          ],
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get pod orders-api-9e8d7c6b5-m3n4p -n orders -o yaml` - check `lastState.terminated`. `OOMKilled` with exit code 137 means the container was killed from *outside* the JVM - a `java.lang.OutOfMemoryError` would show up as a logged exception, not a silent exit.",
    "`kubectl describe deployment orders-api -n orders` - compare the container's memory `limits` against `-Xmx` in `JAVA_TOOL_OPTIONS`. There's a lot of headroom between them - so what else is using memory inside that container?",
    "`kubectl get configmap orders-api-config -n orders -o yaml` - Tomcat's thread pool is entirely separate from heap. Each thread needs its own stack, on top of whatever else the JVM keeps outside the heap.",
  ],
  options: [
    {
      id: "oversized-thread-pool",
      label:
        "Tomcat's thread pool (`server.tomcat.threads.max: 800`) is wildly oversized for this container - each thread's stack, plus metaspace and other non-heap memory, pushes the container's total memory usage past its 512Mi limit, so the kernel OOM-kills it even though the configured heap itself never fills up.",
      explanation:
        "This fits every clue: `lastState.terminated.reason` is `OOMKilled` with exit code 137 (a kernel/cgroup kill, not a JVM exception - nothing appears in the logs), heap is capped at a modest `-Xmx256m` inside a 512Mi container (plenty of apparent headroom), and `orders-api-config` sets Tomcat's thread pool to 800 threads. Each thread carries its own stack (roughly 1MB by default) plus the JVM's own bookkeeping per thread - 800 of them, largely idle most of the time, is enough non-heap memory to blow straight through the 512Mi cgroup limit regardless of how small the heap is.",
    },
    {
      id: "xmx-too-small",
      label: "`-Xmx256m` is too small for the workload, so the JVM keeps hitting `java.lang.OutOfMemoryError: Java heap space`.",
      explanation:
        "A heap `OutOfMemoryError` is a Java exception - it gets logged, often with a stack trace, and the process usually keeps running (or exits with a distinct message) rather than vanishing silently. Here there's no exception anywhere, and `lastState.terminated.reason: OOMKilled` with exit code 137 is the kernel/cgroup killing the container from outside - the heap was never the constraint that got hit.",
    },
    {
      id: "raise-memory-limit",
      label: "The container's 512Mi memory limit is simply too low for a Java 25 workload and just needs to be raised.",
      explanation:
        "Raising the limit would buy time before the next kill, but it doesn't address the actual waste: a thread pool sized for 800 concurrent requests that this service never sees. Sizing the container's memory limit around 800 mostly-idle threads' worth of stack space isn't a fix, it's just delaying the same problem at a higher number.",
    },
    {
      id: "container-ergonomics-bug",
      label: "Java 25's container-aware heap ergonomics (`-XX:MaxRAMPercentage`) is miscalculating the heap size from the cgroup limit.",
      explanation:
        "Heap usage is fine and stays well under the explicit `-Xmx256m` cap the whole time - this isn't a heap-sizing or ergonomics failure at all. The memory that's overflowing the container's limit is non-heap (thread stacks, JVM per-thread bookkeeping), which heap ergonomics doesn't govern in the first place.",
    },
  ],
  correctOptionId: "oversized-thread-pool",
  resolution: `\`orders-api-9e8d7c6b5-m3n4p\`'s \`lastState.terminated\` shows
\`reason: OOMKilled\`, \`exitCode: 137\` - a kernel-level kill because the
container's cgroup hit its memory limit, not a JVM \`OutOfMemoryError\`
(there's no exception anywhere in the logs; the process just stops mid
request). The container's memory limit is 512Mi, and \`-Xmx256m\` leaves what
looks like generous headroom - so the heap was never really the risk.

\`orders-api-config\` tells the other half of the story:
\`server.tomcat.threads.max: 800\` - a setting almost certainly copied from a
non-containerized deployment "just to be safe." Every one of those threads
needs its own stack (roughly 1MB by default, via \`-Xss\`) plus per-thread JVM
bookkeeping, whether or not it's actually handling a request. 800 threads'
worth of stacks alone can easily add several hundred MiB of memory *outside*
the heap - memory that a container's cgroup limit counts just as much as
heap usage, but that Java's container-aware heap ergonomics
(\`-XX:MaxRAMPercentage\`) has no say over at all, because it only sizes the
heap.

Add that non-heap overhead to the JVM's baseline metaspace/code-cache
footprint and a 256MB heap, and total memory usage comfortably exceeds the
512Mi limit under normal traffic - with no error to log, because it's the
kernel, not the JVM, doing the killing.

The fix is to right-size the thread pool to what this service actually
needs, not the container's memory budget:

\`\`\`yaml
server:
  tomcat:
    threads:
      max: 50
      min-spare: 10
\`\`\`

In a container, the real memory budget is heap + metaspace + (thread count
× stack size) + code cache + native/direct buffers - all of it has to fit
under the cgroup limit, or the kernel kills the process outright, invisible
to anything the JVM itself can catch or log.`,
};
