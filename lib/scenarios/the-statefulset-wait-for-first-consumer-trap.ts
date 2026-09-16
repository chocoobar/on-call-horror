import type { Scenario } from "./types";

export const theStatefulsetWaitForFirstConsumerTrap: Scenario = {
  id: "the-statefulset-wait-for-first-consumer-trap",
  title: "The Wait-For-First-Consumer Trap",
  subtitle: "a brand-new StatefulSet's first pod and its own PVC seem to be waiting on each other, forever",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "statefulset", "storage"],
  briefing: `A new "audit-log-store" StatefulSet was deployed for the first time an
hour ago. Its first pod, \`audit-log-store-0\`, has been Pending the whole
time. Its PVC shows \`Pending\` too. Neither one is failing with an error -
they both just sit there, and it looks almost like each is waiting on
the other to move first.`,
  constraints: [
    "The StorageClass involved is confirmed to work correctly for other StatefulSets elsewhere in the cluster - it isn't broken in general.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "audit-log-store", namespace: "audit", labels: { app: "audit-log-store" } },
        spec: {
          replicas: 3,
          serviceName: "audit-log-store",
          template: {
            spec: { nodeSelector: { "storage-tier": "high-iops" }, containers: [{ name: "audit-log-store", image: "registry.internal/audit-log-store:1.0.0" }] },
          },
          volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { storageClassName: "ssd-local-wffc", accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "100Gi" } } } }],
        },
        status: { readyReplicas: 0, updatedReplicas: 1, currentReplicas: 0 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "data-audit-log-store-0", namespace: "audit" },
        spec: { storageClassName: "ssd-local-wffc", accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "100Gi" } } },
        status: { phase: "Pending" },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "audit-log-store-0", namespace: "audit", labels: { app: "audit-log-store" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "3m", message: "0/8 nodes are available: 8 node(s) didn't match Pod's node affinity/selector." },
        ],
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "local-storage-provisioning-notes", namespace: "audit" },
        spec: {
          data: {
            "notes.md":
              "`ssd-local-wffc` uses `volumeBindingMode: WaitForFirstConsumer` -\nintentional for local/node-pinned storage, since the volume needs to be\nprovisioned on whichever specific node the pod actually lands on, not\nbound ahead of time to an arbitrary one. This means the PVC deliberately\nstays Pending until the scheduler has chosen a node for the pod - it's\nnot stuck, it's correctly waiting for a scheduling decision to happen\nfirst. The actual, separate problem: the StatefulSet's pod template has\na `nodeSelector` requiring `storage-tier: high-iops`, but no nodes in\nthe cluster currently carry that label at all (the local-SSD node pool\nthis was intended for hasn't finished being provisioned by\ninfrastructure yet, expected to land later this week) - so the pod can\nnever be scheduled anywhere, which means the volume can never be\nprovisioned either, which is why both objects appear stuck waiting on\neach other: the PVC is correctly waiting on pod scheduling, and pod\nscheduling is failing for a completely separate, unrelated reason\n(a node selector matching zero nodes).\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl get pvc data-audit-log-store-0 -n audit -o yaml` - check its StorageClass's `volumeBindingMode`. Is `Pending` actually abnormal for this particular mode, before a pod is scheduled?",
    "`kubectl describe pod audit-log-store-0 -n audit` - the FailedScheduling event is about node affinity/selector, not about the volume at all.",
    "`kubectl get nodes -l storage-tier=high-iops` - does any node in the cluster actually carry the label this pod's nodeSelector requires?",
  ],
  options: [
    {
      id: "wffc-pvc-correctly-waiting-on-pod-with-no-matching-nodes",
      label:
        "`ssd-local-wffc`'s `volumeBindingMode: WaitForFirstConsumer` deliberately keeps the PVC Pending until the scheduler picks a node for the pod - that part is working exactly as intended, not stuck. The real, separate problem is the pod's own `nodeSelector` requiring `storage-tier: high-iops`, a label that doesn't exist on any node yet because the intended local-SSD node pool hasn't finished being provisioned - so the pod can never be scheduled at all, and because the PVC is correctly waiting on that scheduling decision, it never resolves either, making both objects look mutually stuck when only one of them actually has a real problem.",
      explanation:
        "`local-storage-provisioning-notes` untangles the apparent chicken-and-egg situation directly: `WaitForFirstConsumer` PVCs are *designed* to stay Pending until a node is chosen, which is completely normal and not itself a symptom of anything wrong. The pod's own `FailedScheduling` event confirms the real, independent problem - a node-affinity/selector mismatch, because zero nodes currently carry the `storage-tier: high-iops` label the pod requires. The PVC isn't blocking the pod, and the pod isn't blocking the PVC in any unusual way - the PVC is just an innocent bystander correctly waiting on a scheduling decision that has its own, entirely separate reason for never happening.",
    },
    {
      id: "storageclass-broken",
      label: "The `ssd-local-wffc` StorageClass itself is broken or misconfigured.",
      explanation:
        "The scenario confirms this StorageClass works correctly for other StatefulSets elsewhere in the cluster - it isn't broken in general. Its `WaitForFirstConsumer` binding mode producing a Pending PVC before a pod is scheduled is expected, standard behavior for this mode, not evidence of a broken StorageClass.",
    },
    {
      id: "pvc-genuinely-blocking-pod-scheduling",
      label: "The Pending PVC is itself what's preventing the pod from being scheduled.",
      explanation:
        "The pod's own `FailedScheduling` event is specifically about a node affinity/selector mismatch, not about any unresolved volume - with `WaitForFirstConsumer`, the scheduler doesn't wait on volume provisioning before making its scheduling decision at all; it's precisely the reverse causality, volume provisioning waits on the scheduling decision.",
    },
    {
      id: "insufficient-cluster-capacity",
      label: "The cluster doesn't have enough general capacity to schedule this pod.",
      explanation:
        "The scheduling event specifically cites a node affinity/selector mismatch (\"didn't match Pod's node affinity/selector\"), not insufficient CPU/memory capacity - the pod isn't failing to fit on any node, it's failing to find any node that carries the label its selector requires at all.",
    },
  ],
  correctOptionId: "wffc-pvc-correctly-waiting-on-pod-with-no-matching-nodes",
  resolution: `\`local-storage-provisioning-notes\` untangles what looked like a
chicken-and-egg deadlock into one real problem and one complete
non-issue. The PVC's \`Pending\` state is entirely expected: \`ssd-local-wffc\`
uses \`volumeBindingMode: WaitForFirstConsumer\`, which deliberately delays
volume provisioning until the scheduler has actually chosen a node for
the pod - essential for node-pinned local storage, since the volume has
to be created on whichever specific node the pod lands on. That's
working exactly as designed, not stuck. The pod's own \`FailedScheduling\`
event reveals the actual, entirely separate problem: its \`nodeSelector\`
requires \`storage-tier: high-iops\`, and zero nodes in the cluster
currently carry that label, because the local-SSD node pool this
StatefulSet was built for hasn't finished being provisioned by
infrastructure yet. The pod can never be scheduled, which means the
volume - correctly waiting on that scheduling decision - can never be
provisioned either, producing the appearance of mutual deadlock when
only the pod side has a genuine, independent cause.

There's no fix available from this read-only console for a node pool
that hasn't finished provisioning - the resolution is simply waiting for
infrastructure to finish rolling out nodes labeled \`storage-tier:
high-iops\` as planned, at which point the pod schedules normally and the
PVC's provisioning proceeds right behind it, with no further action
needed. If the node pool's timeline slips further, temporarily loosening
the pod's node selector to run on general-purpose storage in the
meantime (accepting reduced IOPS as a tradeoff) is the alternative,
provided that's an acceptable interim state for this workload:

\`\`\`yaml
spec:
  template:
    spec:
      nodeSelector: {}   # temporarily drop storage-tier requirement
\`\`\`

The broader lesson: with \`WaitForFirstConsumer\`, a Pending PVC almost
never has its own independent cause - the actual problem, when there is
one, is almost always upstream, in whether and where the pod itself can
be scheduled at all. Debugging always starts with the pod's own
scheduling events, not the PVC's status.`,
};
