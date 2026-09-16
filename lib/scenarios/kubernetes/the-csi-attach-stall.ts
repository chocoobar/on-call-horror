import type { Scenario } from "../types";

export const theCsiAttachStall: Scenario = {
  id: "the-csi-attach-stall",
  title: "The CSI Attach Stall",
  subtitle: "ledger-db's replacement pod has been ContainerCreating for twenty-five minutes",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "csi", "storage"],
  briefing: `A node running "ledger-db" was replaced during routine autoscaling. The
new pod scheduled onto a healthy node almost instantly and has been stuck
in \`ContainerCreating\` ever since - going on twenty-five minutes now for
what's normally a few-second volume attach.`,
  constraints: [
    "The new node the pod landed on is healthy with no resource pressure - this isn't a node-side problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ledger-db-0", namespace: "ledger", labels: { app: "ledger-db" } },
        status: { phase: "Pending", containerStatuses: [{ name: "ledger-db", ready: false, restartCount: 0, state: { waiting: { reason: "ContainerCreating" } } }] },
        events: [
          { type: "Warning", reason: "FailedAttachVolume", age: "2m", message: "Multi-Attach error for volume \"pvc-8f2a1c\": Volume is already exclusively attached to one node and can't be attached to another" },
          { type: "Warning", reason: "FailedMount", age: "1m", message: "Unable to attach or mount volumes: unmounted volumes=[data]: timed out waiting for the condition" },
        ],
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "data-ledger-db-0", namespace: "ledger" },
        spec: { storageClassName: "ebs-gp3", accessModes: ["ReadWriteOnce"] },
        status: { phase: "Bound" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ledger-db-attach-diagnostics", namespace: "ledger" },
        spec: {
          data: {
            "notes.md":
              "The old node (terminated during autoscaling 25 minutes ago) was killed\nabruptly rather than gracefully drained - the EBS CSI driver's\nControllerUnpublishVolume call for the old attachment never ran, because\nthere was no graceful shutdown to trigger it. The cloud provider's EBS\nAPI still considers the volume attached to the now-nonexistent old node.\nThe CSI attach/detach controller has to notice the stale attachment,\nforce-detach it (which requires a timeout to elapse - by default around\n6 minutes, though it can take longer depending on provider API\nbehavior), and only then can it attach the volume to the new node. This\nis progressing, just very slowly relative to what a graceful\nreplacement would have taken.\n",
          },
        },
        age: "25m",
      },
    ],
  },
  hints: [
    "`kubectl describe pod ledger-db-0 -n ledger` - the events name a specific, well-known CSI error: `Multi-Attach error`.",
    "A `ReadWriteOnce` volume can only be attached to one node at a time - what happens to that attachment when the node it was on disappears abruptly instead of being drained first?",
    "`kubectl get configmap ledger-db-attach-diagnostics -n ledger -o yaml` - is this actually stuck forever, or is it a slow, bounded recovery already in progress?",
  ],
  options: [
    {
      id: "stale-attachment-from-abrupt-node-termination",
      label:
        "The old node was terminated abruptly during autoscaling rather than gracefully drained, so the CSI driver never got to cleanly detach `pvc-8f2a1c` before the node disappeared - the cloud provider's storage API still considers the volume attached to a node that no longer exists, and the CSI attach/detach controller has to detect the stale attachment and force-detach it (a process with its own timeout, commonly several minutes) before it can attach the volume to the new pod's node, which is exactly the slow-but-bounded recovery already in progress here, not a permanent stuck state.",
      explanation:
        "The `Multi-Attach error` event is the specific, well-known symptom of a `ReadWriteOnce` volume that the storage backend still considers attached elsewhere. `ledger-db-attach-diagnostics` explains why: an abrupt node termination skips the graceful `ControllerUnpublishVolume` call that would normally clean up the attachment immediately, leaving the cloud provider's own volume-attachment record stale until the CSI controller's force-detach timeout elapses on its own. This is consistent with the timeline (25 minutes, past a roughly 6-minute typical force-detach window plus provider API delay) and explains why the new node is otherwise completely healthy - it's waiting on the *old* attachment to clear, not failing to attach for any reason of its own.",
    },
    {
      id: "pvc-never-bound",
      label: "The PersistentVolumeClaim never actually bound to a volume.",
      explanation:
        "`data-ledger-db-0` shows `status.phase: Bound` - it's already bound to an existing volume. The problem is attaching that already-provisioned volume to the pod's new node, not creating or binding a new one.",
    },
    {
      id: "csi-driver-crashed",
      label: "The CSI driver's own controller pod has crashed and isn't processing attach requests at all.",
      explanation:
        "There's no indication the CSI controller itself is down - the events show it actively attempting the attach and reporting a specific, meaningful error (`Multi-Attach`), which requires the controller to be running and processing the request, just blocked on a stale prior attachment rather than being non-functional.",
    },
    {
      id: "wrong-storageclass-for-multiattach",
      label: "The PVC's storage class doesn't support the access mode the pod needs.",
      explanation:
        "`accessModes: [ReadWriteOnce]` is exactly the access mode ledger-db needs (one node at a time) and is exactly what `ebs-gp3` supports - the error isn't about an unsupported access mode, it's about the *same* access mode already being honored by a stale attachment to a node that no longer exists.",
    },
  ],
  correctOptionId: "stale-attachment-from-abrupt-node-termination",
  resolution: `The \`Multi-Attach error\` event is the CSI driver's specific signal that
\`pvc-8f2a1c\` is still considered attached elsewhere by the storage
backend. \`ledger-db-attach-diagnostics\` explains why: the old node was
terminated abruptly during autoscaling rather than drained gracefully,
which skips the clean \`ControllerUnpublishVolume\` call that would
normally release the attachment immediately. The cloud provider's own
volume-attachment record is left stale, pointing at a node that no
longer exists, and the CSI attach/detach controller has to detect that
and force-detach it - a process with its own timeout - before it can
attach the volume to ledger-db-0's new node. Twenty-five minutes is slow
but consistent with that recovery path actually working, just much
slower than the few-second attach a graceful node drain would have
produced.

There's no live fix to speed this up from this read-only console - it
typically does resolve on its own once the force-detach timeout elapses,
and the pod becomes Running shortly after. To prevent this recurring on
future node replacements, the durable fix is making sure autoscaling
node replacements drain gracefully rather than terminating nodes
abruptly:

\`\`\`yaml
# cluster-autoscaler / node group config
scaleDownGracePeriod: 10m   # or equivalent for the provider in use
\`\`\`
\`\`\`

ensuring pods (and their volumes) get a clean, orderly handoff instead
of leaving the CSI driver to detect and recover from a stale attachment
after the fact. For genuinely stateful, single-attach workloads like a
database, it's also worth confirming the node group's scale-down policy
respects a PodDisruptionBudget or similar signal so these nodes aren't
reclaimed mid-use in the first place.`,
};
