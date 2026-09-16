import type { Scenario } from "../types";

export const theOvercommittedNode: Scenario = {
  id: "the-overcommitted-node",
  title: "The Overcommitted Node",
  subtitle: "random pods on node-worker-07 keep getting evicted, not always the same ones",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "scheduling", "resources"],
  briefing: `Over the last day, pods on "node-worker-07" have been getting evicted at
random - different apps each time, no obvious pattern by team or
deployment. The node shows as Ready the whole time. Nobody scheduled a
drain or maintenance window.`,
  constraints: [
    "Every affected pod was healthy and passing its probes right up until the moment it was evicted - none of them crashed on their own.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-builder-3c4d5e6f7-g8h9i", namespace: "analytics", labels: { app: "report-builder" } },
        status: {
          phase: "Failed",
          reason: "Evicted",
          message: "The node was low on resource: memory. Container report-builder was using 340140Ki, which exceeds its request of 64Mi.",
        },
        events: [
          { type: "Warning", reason: "Evicted", age: "40m", message: "The node was low on resource: memory. Container report-builder was using 340140Ki, which exceeds its request of 64Mi." },
        ],
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "email-sender-8i9j0k1l2-m3n4o", namespace: "notifications", labels: { app: "email-sender" } },
        status: {
          phase: "Failed",
          reason: "Evicted",
          message: "The node was low on resource: memory. Container email-sender was using 210020Ki, which exceeds its request of 32Mi.",
        },
        events: [
          { type: "Warning", reason: "Evicted", age: "1h5m", message: "The node was low on resource: memory. Container email-sender was using 210020Ki, which exceeds its request of 32Mi." },
        ],
        age: "1h5m",
      },
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "node-worker-07", labels: { "kubernetes.io/hostname": "node-worker-07" } },
        status: {
          conditions: [{ type: "Ready", status: "True" }, { type: "MemoryPressure", status: "True" }],
          allocatable: { cpu: "8", memory: "32Gi" },
        },
        events: [
          { type: "Warning", reason: "EvictionThresholdMet", age: "1h10m", message: "Attempting to reclaim memory" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "node-worker-07-scheduling-notes", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "node-worker-07 is currently scheduled with 140 pods, almost all of which\nrequest 32-64Mi of memory regardless of what they actually use day to\nday - several teams standardized on a low placeholder request years ago\nand never revisited it. Summed *requests* leave plenty of headroom under\nthe node's 32Gi allocatable, which is why the scheduler keeps happily\npacking more pods on. Summed *actual usage* under normal load is much\ncloser to the real ceiling, and any pod whose real usage spikes pushes\nthe node over the edge - the kubelet then evicts whichever pods look\nlike the worst offenders relative to their own tiny requests, which\nvaries run to run.",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl describe node node-worker-07` - check `MemoryPressure` condition and how many pods are actually scheduled there versus allocatable capacity.",
    "The eviction messages themselves show each pod's real memory usage right next to its `request` - look at how large that gap is for both evicted pods.",
    "The scheduler places pods based on *requested* resources, not actual usage - what happens when requests are set far below what pods really consume, and a lot of them are packed onto one node?",
  ],
  options: [
    {
      id: "requests-too-low-overcommit",
      label:
        "Pods on node-worker-07 have memory requests set far below their real usage (report-builder requests 64Mi but uses ~332Mi, email-sender requests 32Mi but uses ~205Mi) - the scheduler happily packs 140 such pods onto the node based on those tiny requests, but real aggregate usage pushes the node into MemoryPressure, and the kubelet evicts whichever pods are furthest over their request to reclaim memory, which varies by whatever's spiking at the time.",
      explanation:
        "Both eviction messages show the same pattern: actual usage many times larger than the declared request (report-builder: 340140Ki used vs 64Mi requested; email-sender: 210020Ki used vs 32Mi requested). The node shows `MemoryPressure: True` while still `Ready`. `node-worker-07-scheduling-notes` explains why: the scheduler only looks at requests when deciding how many pods fit, so 140 pods with tiny placeholder requests get packed on regardless of what they actually use - and once real usage exceeds the node's real capacity, the kubelet evicts based on usage-vs-request overage, which lands on a different pod each time depending on what's busy that moment.",
    },
    {
      id: "node-hardware-failing",
      label: "node-worker-07's physical memory hardware is failing intermittently.",
      explanation:
        "The node reports `Ready: True` throughout with a clean, expected kubelet-driven `MemoryPressure` condition and standard eviction messages - there's no indication of hardware failure, just memory demand exceeding what the node actually has despite requests suggesting otherwise.",
    },
    {
      id: "specific-apps-have-memory-leaks",
      label: "report-builder and email-sender both have memory leaks that are causing the evictions.",
      explanation:
        "The evictions hit different, unrelated apps each time (per the briefing) - a memory leak in one or two specific apps wouldn't explain evictions rotating across many different teams' workloads on the same node, which instead points at the node's overall capacity being oversubscribed relative to real usage.",
    },
    {
      id: "too-many-pods-limit",
      label: "The node has hit its maximum pod count limit and is evicting the oldest pods to make room.",
      explanation:
        "Kubernetes doesn't evict running pods just to enforce a pod-count ceiling - new pods would simply fail to schedule instead. The eviction messages here are explicitly about memory pressure and per-pod usage-versus-request overage, not a pod count limit.",
    },
  ],
  correctOptionId: "requests-too-low-overcommit",
  resolution: `Both eviction messages show the same signature: real memory usage many
times the declared request (report-builder: ~332Mi used against a 64Mi
request; email-sender: ~205Mi used against 32Mi). The node itself is
healthy - \`Ready: True\` with \`MemoryPressure: True\` - it's simply out of
real memory it can give out, even though the scheduler thought there was
plenty of room. \`node-worker-07-scheduling-notes\` explains the root cause:
requests were standardized at a low placeholder years ago and never
matched to real usage, so the scheduler - which only reasons about
requested resources - packed 140 pods onto the node based on numbers that
don't reflect reality. Once aggregate real usage exceeds the node's
actual capacity, the kubelet reclaims memory by evicting whichever pods
are furthest over their request, which is a different pod each time
depending on what happens to be busy.

The durable fix is setting requests that reflect real usage (ideally
informed by a VPA recommendation or historical metrics) so the scheduler
stops overcommitting the node in the first place:

\`\`\`yaml
resources:
  requests: { memory: 384Mi, cpu: 100m }
  limits: { memory: 512Mi, cpu: 250m }
\`\`\`

applied cluster-wide to the chronically under-requested workloads, plus
a cluster-level policy (a \`LimitRange\` default, or a VPA in
recommendation mode) so future services don't repeat the same
placeholder-request pattern.`,
};
