import type { Scenario } from "../types";

export const theCpuQuotaInvisibleToTheJvm: Scenario = {
  id: "the-cpu-quota-invisible-to-the-jvm",
  title: "The CPU Quota Invisible to the JVM",
  subtitle: "risk-model-api's GC pauses got much worse after moving to a newer, 'more efficient' base image",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "gc", "containers"],
  briefing: `"risk-model-api" moved to a slimmer, newer base image last week as part
of a routine security-patching cycle. CPU limits and everything else in
the Deployment spec stayed identical. Since the switch, GC pause times
have roughly tripled under the same load, and nobody can find anything
in the JVM flags or heap settings that changed.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "risk-model-api", namespace: "risk", labels: { app: "risk-model-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "risk-model-api", image: "registry.internal/risk-model-api:6.0.0-slim", env: [{ name: "JAVA_TOOL_OPTIONS", value: "-XX:+UseG1GC -Xmx4g" }], resources: { requests: { cpu: "2000m" }, limits: { cpu: "2000m" } } },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "risk-model-api-8d9e0f1g2-h3i4j", namespace: "risk", labels: { app: "risk-model-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "risk-model-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "risk-model-api": [
            "2026-09-15T09:00:00.010Z INFO  [os,cpu] active_processor_count: 16 (detected via /proc/cpuinfo, cgroup v1 cpu.cfs_quota_us not read on this base image's JDK build)",
            "2026-09-15T09:10:04.884Z INFO  [gc] GC(88) Pause Young (Normal) (G1 Evacuation Pause) 1024M->480M(4096M) 1340.884ms",
          ],
        },
        age: "6d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "risk-model-api-notes", namespace: "risk" },
        spec: {
          data: {
            "notes.md":
              "The old base image included a JDK build with cgroup v2 support and\ncorrectly detected this container's `cpu.max` quota (2 cores), sizing\n`active_processor_count` - and therefore G1's default worker thread\ncount - accordingly. The new slim base image bundles a minimal JDK\nvariant that, on this particular cluster's cgroup driver configuration,\nfalls back to reading the host's raw `/proc/cpuinfo` (16 cores) instead\nof the container's actual cgroup CPU quota, because the specific\ncgroup filesystem path it expects isn't mounted the same way in this\nslimmer image. G1 now plans and schedules its collection work assuming\n16 available CPUs, while the container is still only ever guaranteed 2.",
          },
        },
        age: "6d",
      },
    ],
  },
  hints: [
    "`kubectl logs risk-model-api-8d9e0f1g2-h3i4j -n risk` - `active_processor_count: 16`. The container's own CPU limit is 2 cores. Where does the JVM think it's getting 16 from, and what does the log line itself say about *how* it detected that?",
    "The Deployment's `resources.limits.cpu` didn't change at all between the old and new base image - so what about the new image itself could change how many CPUs the JVM believes it has?",
    "`kubectl get configmap risk-model-api-notes -n risk -o yaml` - does the new base image's JDK build correctly read this cluster's cgroup CPU quota, or does it fall back to something else?",
  ],
  options: [
    {
      id: "new-base-image-jdk-falls-back-to-host-cpu-count",
      label:
        "The new slim base image bundles a JDK build that, on this cluster's specific cgroup filesystem layout, fails to read the container's actual `cpu.max` quota and falls back to the host's raw `/proc/cpuinfo` core count (16) instead - so `active_processor_count`, and with it G1's default worker thread sizing, is now based on 16 phantom CPUs rather than the container's real 2-core limit, producing exactly the same 'too many GC threads for too little real CPU' pause-time blowup as an explicit misconfiguration, just introduced silently by a base image swap that nobody thought to check against GC behavior.",
      explanation:
        "The log states the detection mechanism and its result directly: `active_processor_count: 16 (detected via /proc/cpuinfo, cgroup v1 cpu.cfs_quota_us not read on this base image's JDK build)` - a JVM believing it has 16 CPUs on a container whose own `resources.limits.cpu` is 2000m (2 cores). `risk-model-api-notes` confirms the old base image's JDK correctly read the container's real cgroup quota, while the new slim image's JDK build falls back to the host's total core count on this cluster's specific cgroup configuration - explaining why nothing in the Deployment spec or JVM flags needed to change for GC pause times to roughly triple: G1 is now sizing its parallel work for 16 threads that the container was never actually granted.",
    },
    {
      id: "heap-size-too-large-for-new-image",
      label: "The 4GB heap (`-Xmx4g`) is simply too large for the new base image's footprint.",
      explanation:
        "`-Xmx4g` and the container's memory limits didn't change between the old and new base image - the specific evidence here (`active_processor_count: 16` on a 2-core container) points at CPU detection, not heap sizing, as what actually changed and is driving the worse GC pause times.",
    },
    {
      id: "new-base-image-has-slower-disk-io",
      label: "The new, slimmer base image has slower disk I/O, indirectly slowing garbage collection.",
      explanation:
        "G1's young generation evacuation pauses are CPU-bound, in-memory operations with no direct disk I/O involved - the log's own explicit evidence points at CPU count detection changing, not at any I/O-related slowdown, as the specific mechanism behind the longer pauses.",
    },
    {
      id: "three-replicas-now-competing-for-node-cpu",
      label: "Three replicas are now competing more heavily for the same node's CPU after the image swap.",
      explanation:
        "Nothing about replica count or scheduling changed between the old and new base image - the log's own CPU-count detection log line, unique to this new image's JDK build, is a much more direct and specific explanation for the change in behavior than a hypothesized shift in node-level scheduling contention.",
    },
  ],
  correctOptionId: "new-base-image-jdk-falls-back-to-host-cpu-count",
  resolution: `The log states both the detected value and the reason for it in one
line: \`active_processor_count: 16 (detected via /proc/cpuinfo, cgroup v1
cpu.cfs_quota_us not read on this base image's JDK build)\` - on a
container whose own \`resources.limits.cpu\` is \`2000m\`, exactly 2 cores.
The very next log entry shows a G1 young generation pause taking
\`1340.884ms\`, roughly in line with the reported tripling.

\`risk-model-api-notes\` explains what changed: the old base image's JDK
build correctly read this cluster's cgroup CPU quota and sized
\`active_processor_count\` (and, through it, G1's default worker thread
count) to the container's real 2-core limit. The new, slimmer base image
bundles a minimal JDK variant that, on this specific cluster's cgroup
filesystem layout, fails to locate the expected cgroup path and silently
falls back to reading the *host's* raw \`/proc/cpuinfo\` core count instead
- 16 cores, the underlying node's total, not the container's actual
allotment. G1 now plans and schedules its parallel collection work
assuming 16 available worker threads, while the container is still only
ever guaranteed 2 CPUs of real scheduling time - the same "too many
threads competing for too little real CPU" mechanism as an explicit
misconfiguration, just introduced silently by a base image swap that
nobody thought to check against GC behavior, since nothing in the
Deployment spec or JVM flags changed at all.

The fix is pinning the JVM's own CPU-count belief explicitly, independent
of whatever the base image's cgroup detection does or doesn't get right:

\`\`\`yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-XX:+UseG1GC -Xmx4g -XX:ActiveProcessorCount=2"
\`\`\`

and separately, filing this as a defect against the new base image (or
reverting it) since silently misdetecting CPU count is a correctness
problem well beyond just this one service. Any base image swap for a JVM
workload is worth verifying \`active_processor_count\` against the
container's actual CPU limit before and after - it's exactly the kind of
"unrelated" infrastructure change that can silently alter GC behavior
with nothing in the application's own configuration ever changing at all.`,
};
