import type { Scenario } from "./types";

export const theNodePressureCascade: Scenario = {
  id: "the-node-pressure-cascade",
  title: "The Node Pressure Cascade",
  subtitle: "three unrelated services all had pods evicted within the same two minutes",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "eviction", "kubelet"],
  briefing: `Three completely unrelated teams are asking why their pods got evicted
around 03:14 this morning - "media-transcoder", "report-generator", and
"cache-warmer", none of which share code, a namespace, or an owner. All
three happened to be running on the same node.`,
  constraints: [
    "None of the three affected pods individually exceeded their own memory limits - none show `OOMKilled`.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "media-transcoder-8k9l0m1n2", namespace: "media", labels: { app: "media-transcoder" } },
        status: { phase: "Failed", reason: "Evicted", message: "The node had condition: [MemoryPressure]." },
        events: [{ type: "Warning", reason: "Evicted", age: "6h", message: "The node had condition: [MemoryPressure]." }],
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-generator-2n3o4p5q6", namespace: "reporting", labels: { app: "report-generator" } },
        status: { phase: "Failed", reason: "Evicted", message: "The node had condition: [MemoryPressure]." },
        events: [{ type: "Warning", reason: "Evicted", age: "6h", message: "The node had condition: [MemoryPressure]." }],
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "shared-worker-09", labels: { "kubernetes.io/hostname": "shared-worker-09" } },
        status: {
          conditions: [{ type: "Ready", status: "True" }, { type: "MemoryPressure", status: "False" }],
          allocatable: { memory: "64Gi", cpu: "16" },
        },
        events: [
          { type: "Warning", reason: "EvictionThresholdMet", age: "6h", message: "Attempting to reclaim memory" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "cache-warmer-5t6u7v8w9", namespace: "platform", labels: { app: "cache-warmer" } },
        status: { phase: "Failed", reason: "Evicted", message: "The node had condition: [MemoryPressure]." },
        events: [{ type: "Warning", reason: "Evicted", age: "6h", message: "The node had condition: [MemoryPressure]." }],
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shared-worker-09-postmortem-notes", namespace: "platform" },
        spec: {
          data: {
            "notes.md":
              "At 03:12, a fourth, unrelated pod on shared-worker-09 - `ml-batch-scorer`\n(a Job pod, now completed and gone) - had a genuine memory leak that\nconsumed memory far beyond its own request, well past what the\nscheduler had accounted for when packing this node. That single pod's\nrunaway growth pushed the *node's overall* memory usage past the\nkubelet's eviction threshold, triggering `MemoryPressure`. Once that\nhappens, the kubelet's eviction manager reclaims memory by evicting\npods based on QoS class and usage-above-request, regardless of which\nspecific pod caused the pressure - `media-transcoder`, `report-generator`,\nand `cache-warmer` were simply the next-worst offenders relative to\ntheir own requests, chosen by the eviction manager to free up space,\nnot because anything was wrong with them individually.\n",
          },
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "`kubectl describe pod media-transcoder-8k9l0m1n2 -n media` - the eviction reason names a node *condition*, not anything specific to this pod.",
    "All three evicted pods were on the same node - `kubectl describe node shared-worker-09` and check its recent Events around 03:14.",
    "Node-level `MemoryPressure` eviction doesn't only evict whatever caused the pressure - it evicts based on QoS class and usage-vs-request across *every* pod on the node, to reclaim memory quickly.",
  ],
  options: [
    {
      id: "one-leaking-job-triggered-node-wide-eviction",
      label:
        "A completely unrelated Job pod (`ml-batch-scorer`) on the same node had a genuine memory leak that pushed the node's overall memory usage past the kubelet's eviction threshold at 03:12 - once `MemoryPressure` triggers, the kubelet's eviction manager reclaims memory across the whole node based on QoS class and usage-over-request, which is why three unrelated, individually well-behaved pods got evicted together: they weren't the cause, they were just the next pods in line to be reclaimed from once the real offender pushed the node over the edge.",
      explanation:
        "All three evicted pods share the identical event: \"The node had condition: [MemoryPressure]\" - a node-level condition, not anything specific to each pod (and none show `OOMKilled`, confirming none individually exceeded their own limits). `shared-worker-09-postmortem-notes` identifies the actual trigger: a fourth pod's genuine memory leak at 03:12, which had already completed and disappeared by the time anyone investigated, making it invisible unless something recorded it - explaining why three unrelated teams' pods all got hit at once despite no fault of their own.",
    },
    {
      id: "coincidental-independent-failures",
      label: "The three services independently had memory issues at the same time, purely by coincidence.",
      explanation:
        "All three pods show the identical eviction reason tied to a shared *node* condition, not three separate memory failures - and none of the three show `OOMKilled` (which would indicate their own limit was exceeded). A shared node-level trigger explaining a shared node-level symptom is a far more consistent explanation than three unrelated services all independently misbehaving in the same two-minute window.",
    },
    {
      id: "node-had-hardware-failure",
      label: "shared-worker-09 itself suffered a hardware memory failure.",
      explanation:
        "The node shows `Ready: True` with `MemoryPressure: False` now (the pressure condition cleared after eviction reclaimed enough memory, exactly as designed) and there's a clear, ordinary software-level explanation - a leaking pod - rather than any indication of a hardware fault.",
    },
    {
      id: "cluster-wide-oom-killer-bug",
      label: "A bug in the cluster's OOM killer configuration caused it to evict healthy pods indiscriminately.",
      explanation:
        "This isn't the Linux OOM killer acting indiscriminately - it's the kubelet's own eviction manager, which deliberately targets specific pods by QoS class and usage-over-request precisely to reclaim memory in a controlled way once a real, identified pressure condition (from the leaking pod) is present, not a malfunction of the eviction mechanism itself.",
    },
  ],
  correctOptionId: "one-leaking-job-triggered-node-wide-eviction",
  resolution: `All three pods share the exact same eviction reason: "The node had
condition: [MemoryPressure]" - a node-wide condition, not anything
individually wrong with media-transcoder, report-generator, or
cache-warmer (none show \`OOMKilled\`, ruling out each hitting its own
limit). \`shared-worker-09-postmortem-notes\` names the actual trigger: a
fourth, unrelated Job pod, \`ml-batch-scorer\`, had a genuine memory leak
at 03:12 that pushed the node's total memory usage past the kubelet's
eviction threshold - and because it was a Job pod that ran to completion
and vanished shortly after, it left no trace for anyone investigating
after the fact to spot without a node-level postmortem. Once
\`MemoryPressure\` triggers, the kubelet's eviction manager reclaims
memory node-wide, picking pods by QoS class and how far over their own
request they're running - which is why three innocent, unrelated pods
got caught in the reclaim while the actual cause had already exited.

There's no live fix from this read-only console for the historical
incident, but the durable fixes are: give \`ml-batch-scorer\` (or whatever
future workload resembles it) a memory limit that actually bounds it
instead of letting it grow unchecked, so a single leaking pod can't take
down unrelated neighbors -

\`\`\`yaml
resources:
  requests: { memory: 2Gi }
  limits: { memory: 2Gi }   # hard ceiling, OOMKilled contains the leak locally
\`\`\`

- and consider isolating known-risky batch/ML workloads onto their own
node pool, separate from steady-state services, so a memory-hungry Job
can't cause collateral eviction of unrelated pods sharing its node. Node-level
\`MemoryPressure\` eviction is a blunt instrument by design - it protects
the node as a whole, not any individual tenant on it.`,
};
