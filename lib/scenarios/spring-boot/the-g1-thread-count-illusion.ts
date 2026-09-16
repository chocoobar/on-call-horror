import type { Scenario } from "../types";

export const theG1ThreadCountIllusion: Scenario = {
  id: "the-g1-thread-count-illusion",
  title: "The G1 Thread Count Illusion",
  subtitle: "fraud-scoring-api's GC pauses got dramatically worse after 'right-sizing' its CPU limit down",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "gc", "containers"],
  briefing: `As part of a cost-optimization pass, "fraud-scoring-api"'s CPU limit was
reduced from 4 cores to 1.5, based on average utilization graphs that
showed plenty of headroom. Since then, p99 latency during traffic bursts
has gotten noticeably worse, and GC pause times specifically have grown
several times longer than before - even though average CPU usage still
looks fine.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fraud-scoring-api", namespace: "risk", labels: { app: "fraud-scoring-api" } },
        spec: {
          replicas: 4,
          template: {
            spec: {
              containers: [
                { name: "fraud-scoring-api", image: "registry.internal/fraud-scoring-api:4.3.0", env: [{ name: "JAVA_TOOL_OPTIONS", value: "-XX:+UseG1GC -Xmx2g" }], resources: { requests: { cpu: "1500m" }, limits: { cpu: "1500m" } } },
              ],
            },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "fraud-scoring-api-3o4p5q6r7-s8t9u", namespace: "risk", labels: { app: "fraud-scoring-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "fraud-scoring-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "fraud-scoring-api": [
            "2026-09-15T11:00:00.010Z INFO  [gc,init] GC(0) Using 8 workers of 8 for full compaction",
            "2026-09-15T11:00:01.114Z INFO  c.e.risk.ScoringController - handling burst of 400 concurrent scoring requests",
            "2026-09-15T11:00:02.884Z INFO  [gc] GC(214) Pause Young (Normal) (G1 Evacuation Pause) 512M->210M(2048M) 890.221ms",
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fraud-scoring-api-notes", namespace: "risk" },
        spec: {
          data: {
            "notes.md":
              "G1's `-XX:ParallelGCThreads` and `-XX:ConcGCThreads` default to a\ncount derived from `Runtime.availableProcessors()`, which on older JDK\ncontainer-awareness logic (and even on some correctly cgroup-aware\nsetups) can be based on the *host's* total core count rather than the\ncontainer's actual `cpu.limit` if the limit isn't an exact whole-core\nvalue. This node has 8 physical cores. G1 planned its parallel GC work\nassuming 8 worker threads, but the container is only ever guaranteed\n1.5 CPU's worth of actual scheduling time - those 8 GC worker threads\nnow have to take turns on far less CPU than G1 assumed when it sized\nits own pause-time model around them.",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl logs fraud-scoring-api-3o4p5q6r7-s8t9u -n risk` - `Using 8 workers of 8 for full compaction`. The container's own CPU limit is 1.5 cores. Where does 8 come from?",
    "G1 sizes its own worker thread count based on the number of CPUs it detects as available - and picks its pause-time targets and work distribution assuming those threads can actually run roughly in parallel.",
    "`kubectl get configmap fraud-scoring-api-notes -n risk -o yaml` - what happens to G1's pause times when it tries to run 8 threads' worth of planned parallel work on a container only guaranteed 1.5 CPUs of actual scheduling time?",
  ],
  options: [
    {
      id: "g1-worker-threads-sized-to-node-cores-not-cgroup-limit",
      label:
        "G1's GC worker thread count was sized based on 8 detected CPUs (the underlying node's physical core count), not the container's actual 1.5-CPU cgroup limit - so G1 plans and schedules its parallel collection work assuming 8 threads can run roughly simultaneously, but the container is only ever guaranteed 1.5 CPUs of real scheduling time for all of them combined, turning what should be a short parallel pause into a much longer one as those 8 threads compete for a small fraction of the CPU G1 assumed it had.",
      explanation:
        "The GC init log states it directly: `Using 8 workers of 8 for full compaction` - eight threads, on a container whose own `resources.limits.cpu` is 1500m (1.5 cores). `fraud-scoring-api-notes` explains the mismatch: G1's default worker thread count derives from detected CPU count, which here reflects the node's 8 physical cores rather than the container's actual cgroup CPU quota. G1's pause-time targeting assumes its worker threads can run close to concurrently - when 8 threads instead have to share 1.5 CPUs of real scheduling time, each pause takes proportionally longer than G1's own model expected, exactly matching the 890ms pause observed under burst load, well beyond what a properly-sized worker count for 1.5 CPUs would produce.",
    },
    {
      id: "heap-too-large-for-cpu-budget",
      label: "The 2GB heap (`-Xmx2g`) is simply too large for a 1.5 CPU container to collect efficiently.",
      explanation:
        "Heap size affects how much work a collection has to do, but the specific evidence here - `Using 8 workers of 8` on a 1.5-CPU container - points at the *worker thread count* being mis-sized relative to available CPU, not at the heap being oversized on its own; a correctly-sized worker count would still show elevated pauses on an oversized heap, but wouldn't show this particular 8-vs-1.5 mismatch.",
    },
    {
      id: "cpu-limit-reduction-was-simply-wrong",
      label: "The CPU limit reduction from 4 to 1.5 cores was simply a mistake and should be reverted outright.",
      explanation:
        "Reverting the CPU reduction would mask the symptom, but the underlying issue - G1 sizing its worker thread count off the wrong CPU count entirely - would still be present and would resurface the next time CPU limits are tuned; the actual fix is making G1's thread count match whatever the container's real CPU budget is, at any limit.",
    },
    {
      id: "not-enough-replicas-after-cpu-cut",
      label: "Four replicas isn't enough total capacity after the per-pod CPU limit was cut.",
      explanation:
        "Replica count affects the fleet's total request-handling capacity, not the length of an individual pod's GC pause - the 890ms pause and the 8-workers-on-1.5-CPUs mismatch are both per-pod phenomena that more replicas wouldn't change at all.",
    },
  ],
  correctOptionId: "g1-worker-threads-sized-to-node-cores-not-cgroup-limit",
  resolution: `The GC initialization log states the worker count directly: \`Using 8
workers of 8 for full compaction\`. The container's own CPU limit,
meanwhile, is \`1500m\` - 1.5 cores. Eight GC worker threads on a container
guaranteed only 1.5 CPUs of scheduling time is a significant mismatch,
and the pause time under burst load - \`890.221ms\` for a young generation
evacuation pause - reflects exactly that: work planned for near-parallel
execution across 8 threads, actually running mostly serialized across a
much smaller real CPU budget.

\`fraud-scoring-api-notes\` explains where the 8 comes from: G1's default
\`ParallelGCThreads\`/\`ConcGCThreads\` sizing derives from
\`Runtime.availableProcessors()\`, and on this node - with 8 physical cores
- that detection reflects the node's total core count rather than the
container's actual cgroup CPU quota, since 1.5 isn't a clean whole-core
value the container-awareness logic maps cleanly onto a reduced worker
count. G1's own pause-time model assumes its worker threads can run
roughly concurrently; when the container's real scheduling budget is far
smaller than the thread count implies, each collection simply takes
proportionally longer, since those 8 threads are now taking turns on a
fraction of the CPU G1 planned around.

The fix is sizing G1's worker thread count to the container's actual CPU
budget explicitly, rather than trusting automatic detection on a
fractional-core limit:

\`\`\`yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-XX:+UseG1GC -Xmx2g -XX:ParallelGCThreads=2 -XX:ConcGCThreads=1 -XX:ActiveProcessorCount=2"
\`\`\`

\`-XX:ActiveProcessorCount\` pins what the JVM (and everything that reads
\`availableProcessors()\`, G1 included) believes its CPU budget is,
independent of whatever the underlying node happens to have - it's worth
setting explicitly any time a container's CPU limit is a fractional or
otherwise non-obvious value relative to the node it's scheduled on.`,
};
