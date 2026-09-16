import type { Scenario } from "./types";

export const theGpuSchedulingGap: Scenario = {
  id: "the-gpu-scheduling-gap",
  title: "The GPU Scheduling Gap",
  subtitle: "vision-inference's pods sit Pending while three GPU nodes report as idle in the dashboard",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "gpu", "scheduling"],
  briefing: `"vision-inference" requests one GPU per pod. Three replicas have been
Pending for over an hour. The infra dashboard shows three GPU nodes with
0% utilization sitting right there, apparently idle and available.`,
  constraints: [
    "The three GPU nodes in question are confirmed `Ready` and otherwise healthy - they're accepting other, non-GPU workloads normally.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "vision-inference", namespace: "ml", labels: { app: "vision-inference" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "vision-inference", image: "registry.internal/vision-inference:2.0.0", resources: { limits: { "nvidia.com/gpu": "1" } } }] } },
        },
        status: { readyReplicas: 0, updatedReplicas: 3, availableReplicas: 0 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "vision-inference-7v8w9x0y1-z2a3b", namespace: "ml", labels: { app: "vision-inference" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "1m", message: "0/3 nodes are available: 3 Insufficient nvidia.com/gpu." },
        ],
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gpu-nodepool-device-plugin-notes", namespace: "ml" },
        spec: {
          data: {
            "notes.md":
              "The 3 GPU nodes physically have GPUs attached and show as idle in the\ninfra dashboard (which reads raw GPU utilization telemetry, independent\nof Kubernetes). But the NVIDIA device plugin DaemonSet responsible for\nadvertising `nvidia.com/gpu` as an allocatable resource to the\nKubernetes scheduler was never deployed to this new node pool - it only\nhas a nodeSelector matching the *original* GPU node pool's label\n(`gpu-pool: legacy`), which these 3 new nodes don't carry\n(`gpu-pool: v2`). Without the device plugin running on a node, the\nscheduler has no idea it has any GPUs to offer at all, regardless of\nwhat's physically installed or how idle it looks externally.\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl describe pod vision-inference-7v8w9x0y1-z2a3b -n ml` - `Insufficient nvidia.com/gpu` means the scheduler doesn't see any GPU capacity on these nodes, at all.",
    "`kubectl describe node <one of the GPU nodes>` - check `status.allocatable` for `nvidia.com/gpu`. Does it show up as a resource at all, even at 0?",
    "The device plugin DaemonSet is what tells Kubernetes a node has GPUs to schedule against - a GPU can be physically present and completely invisible to the scheduler without it running there.",
  ],
  options: [
    {
      id: "device-plugin-daemonset-missing-on-new-nodepool",
      label:
        "The NVIDIA device plugin DaemonSet - the thing that actually advertises `nvidia.com/gpu` as a schedulable resource to Kubernetes - only targets the original GPU node pool via a `nodeSelector` for `gpu-pool: legacy`, but the three new nodes carry `gpu-pool: v2` instead, so the plugin was never scheduled onto them: the GPUs are physically present and idle (which is what the infra dashboard's raw telemetry shows) but completely invisible to the Kubernetes scheduler, which is exactly what `Insufficient nvidia.com/gpu` on all 3 nodes means.",
      explanation:
        "The scheduling event - \"0/3 nodes are available: 3 Insufficient nvidia.com/gpu\" - means the scheduler sees zero allocatable GPU resource on all three nodes, not that the resource is fully consumed. `gpu-nodepool-device-plugin-notes` explains the disconnect directly: the infra dashboard reads raw hardware telemetry independent of Kubernetes, while the device plugin DaemonSet - whose job is specifically to advertise `nvidia.com/gpu` to the scheduler - never landed on these nodes because its nodeSelector only matches the old node pool's label, not the new one's.",
    },
    {
      id: "resource-quota-blocking-gpu-pods",
      label: "A ResourceQuota on `nvidia.com/gpu` in the `ml` namespace is blocking these pods.",
      explanation:
        "A quota rejection would show up as the pod failing to even be admitted/created with a quota-specific error, rather than being created successfully and sitting `Pending` with a `FailedScheduling` event about node-level GPU insufficiency - this is a scheduling problem about node-advertised capacity, not a namespace-level quota rejection.",
    },
    {
      id: "gpu-drivers-not-installed",
      label: "The GPU nodes are missing the NVIDIA drivers needed to use the hardware at all.",
      explanation:
        "The infra dashboard's raw utilization telemetry reading the GPUs as idle (rather than absent/errored) suggests the hardware and drivers are functioning at the OS level - the specific gap is between the hardware being usable and Kubernetes' scheduler *knowing about* it, which is exactly the device plugin's job, and it's confirmed absent from this node pool.",
    },
    {
      id: "pod-requesting-wrong-resource-name",
      label: "vision-inference's Deployment requests the wrong resource name for GPU allocation.",
      explanation:
        "`nvidia.com/gpu` is the standard, correct resource name for NVIDIA GPU scheduling via the device plugin - if it were misnamed, the scheduling error would be different (likely just ignoring the unrecognized resource rather than reporting it as specifically insufficient), and `gpu-nodepool-device-plugin-notes` directly attributes the gap to the plugin's own node targeting, not the pod's resource request.",
    },
  ],
  correctOptionId: "device-plugin-daemonset-missing-on-new-nodepool",
  resolution: `The scheduling event - "0/3 nodes are available: 3 Insufficient
nvidia.com/gpu" - means the scheduler sees *zero* allocatable GPU
capacity on all three nodes, a very different situation from the GPUs
being busy or fully consumed. \`gpu-nodepool-device-plugin-notes\`
explains the disconnect: the infra dashboard reads raw hardware
telemetry directly, completely independent of what Kubernetes itself
knows about - and what Kubernetes knows about GPU capacity comes
entirely from the NVIDIA device plugin DaemonSet, which advertises
\`nvidia.com/gpu\` as an allocatable resource on any node it runs on. That
DaemonSet's nodeSelector only matches the original node pool's label
(\`gpu-pool: legacy\`), and the three new nodes carry \`gpu-pool: v2\`
instead - so the plugin never got scheduled there, leaving genuinely
idle, physically-present GPUs completely invisible to the scheduler.

The fix is extending the device plugin's node targeting to cover the new
pool:

\`\`\`yaml
spec:
  template:
    spec:
      nodeSelector:
        gpu-pool: v2   # or drop the selector's pool-specific value entirely
                        # and match on a general "has-gpu: true" label instead
\`\`\`

The more durable version of this fix is decoupling the device plugin's
targeting from a specific node pool name/version entirely - labeling any
GPU-equipped node with a stable, generic marker (like \`nvidia.com/gpu:
present\`) at provisioning time, and having the device plugin DaemonSet
select on that instead, so the next new GPU node pool doesn't require a
manual selector update to actually become usable by the scheduler.`,
};
