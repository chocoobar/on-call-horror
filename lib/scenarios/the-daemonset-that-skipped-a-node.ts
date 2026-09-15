import type { Scenario } from "./types";

export const theDaemonsetThatSkippedANode: Scenario = {
  id: "the-daemonset-that-skipped-a-node",
  title: "The DaemonSet That Skipped a Node",
  subtitle: "node-metrics-agent is missing from exactly the three newest nodes in the cluster",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "daemonset", "taints"],
  briefing: `A batch of three new nodes was added to the cluster yesterday to handle a
GPU workload. Everything scheduled onto them fine except one thing:
"node-metrics-agent", the DaemonSet that's supposed to run on every node
without exception, never showed up on any of the three.`,
  constraints: [
    "node-metrics-agent is running correctly on every pre-existing node in the cluster - this is isolated to the three new nodes.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        metadata: { name: "node-metrics-agent", namespace: "observability", labels: { app: "node-metrics-agent" } },
        spec: {
          template: {
            spec: {
              tolerations: [{ key: "node-role.kubernetes.io/control-plane", operator: "Exists", effect: "NoSchedule" }],
              containers: [{ name: "node-metrics-agent", image: "registry.internal/node-metrics-agent:1.1.0" }],
            },
          },
        },
        status: { desiredNumberScheduled: 20, currentNumberScheduled: 17, numberReady: 17 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "gpu-node-01", labels: { "kubernetes.io/hostname": "gpu-node-01", "workload-type": "gpu" } },
        spec: { taints: [{ key: "nvidia.com/gpu", value: "true", effect: "NoSchedule" }] },
        status: { conditions: [{ type: "Ready", status: "True" }] },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gpu-nodepool-provisioning-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "All 3 new GPU nodes were provisioned with a `nvidia.com/gpu=true:NoSchedule`\ntaint to keep general workloads off them, reserving them for the GPU\nDeployment that explicitly tolerates that taint. node-metrics-agent's\nDaemonSet tolerations were last updated over a year ago and only cover\n`node-role.kubernetes.io/control-plane` - there's no toleration for\n`nvidia.com/gpu` at all.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get daemonset node-metrics-agent -n observability` - `desiredNumberScheduled` vs `currentNumberScheduled` tells you it's intentionally not counting all nodes as targets, not that it's failing on them.",
    "`kubectl describe node gpu-node-01` - check `Taints`.",
    "`kubectl get daemonset node-metrics-agent -n observability -o yaml` - compare its `tolerations` list against every taint the new nodes actually carry.",
  ],
  options: [
    {
      id: "daemonset-missing-gpu-taint-toleration",
      label:
        "All three new GPU nodes were provisioned with a `nvidia.com/gpu=true:NoSchedule` taint to reserve them for GPU workloads, but node-metrics-agent's DaemonSet only tolerates the control-plane taint - with no toleration for the GPU taint, the scheduler correctly excludes those three nodes from the DaemonSet's target set entirely, which is why `desiredNumberScheduled` (17) doesn't even count them, let alone show them as failing.",
      explanation:
        "`gpu-nodepool-provisioning-notes` confirms the new nodes carry a `nvidia.com/gpu=true:NoSchedule` taint by design, and the DaemonSet's own tolerations list only covers `node-role.kubernetes.io/control-plane` - nothing for the GPU taint. A DaemonSet without a matching toleration for a `NoSchedule` taint doesn't fail or error on that node; the scheduler simply never considers it a target at all, which is exactly why `desiredNumberScheduled` sits at 17 instead of 20 rather than showing 3 pending/failed pods.",
    },
    {
      id: "resource-requests-too-high",
      label: "node-metrics-agent's resource requests exceed what's available on the new GPU nodes.",
      explanation:
        "There's no indication of a resource shortfall on the new nodes, and more fundamentally, `desiredNumberScheduled` staying at 17 means the DaemonSet controller never even attempted to schedule a pod on the new nodes - a resource shortage would instead show up as a Pending pod that was attempted and failed, not as a node excluded from the desired count entirely.",
    },
    {
      id: "daemonset-selector-mismatch",
      label: "The DaemonSet's node selector doesn't match labels on the new nodes.",
      explanation:
        "A DaemonSet with no `nodeSelector`/`nodeAffinity` configured targets all nodes by default, and nothing here shows a selector being added or changed - the exclusion mechanism at play is a taint without a matching toleration, which behaves differently (and produces the exact `desiredNumberScheduled` gap seen here) from a selector mismatch.",
    },
    {
      id: "gpu-nodes-not-joined-cluster",
      label: "The three new GPU nodes haven't actually joined the cluster yet.",
      explanation:
        "`gpu-node-01`'s own status shows `Ready: True`, and the briefing confirms other workloads (the GPU Deployment) scheduled onto these nodes successfully - they're fully joined and functional, just intentionally excluded from this one DaemonSet's target set by its taint.",
    },
  ],
  correctOptionId: "daemonset-missing-gpu-taint-toleration",
  resolution: `\`gpu-nodepool-provisioning-notes\` explains the new nodes' taint
directly: \`nvidia.com/gpu=true:NoSchedule\`, applied on purpose to keep
general workloads off GPU hardware. node-metrics-agent's DaemonSet
tolerations were last updated over a year ago and only cover
\`node-role.kubernetes.io/control-plane\` - there's simply no toleration
for the GPU taint. That's why this doesn't look like a failure at all in
\`kubectl get daemonset\`: \`desiredNumberScheduled\` sits at 17, meaning the
scheduler never even counted the 3 GPU nodes as valid targets, rather
than attempting and failing to place a pod on them.

A DaemonSet that's genuinely meant to run on every node - including
specialized ones - needs an explicit toleration for every taint that
could otherwise exclude it:

\`\`\`yaml
spec:
  template:
    spec:
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
\`\`\`

After applying, \`desiredNumberScheduled\` should jump to 20 and the agent
should appear on all three GPU nodes shortly after. This is a common gap
whenever a new specialized nodepool (GPU, high-memory, spot instances,
whatever) is introduced with its own taint - every cluster-wide DaemonSet
needs its tolerations revisited at the same time, or it silently stops
being cluster-wide.`,
};
