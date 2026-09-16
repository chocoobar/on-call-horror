import type { Scenario } from "./types";

export const theNetworkPartitionAttachDeadlock: Scenario = {
  id: "the-network-partition-attach-deadlock",
  title: "The Network Partition Attach Deadlock",
  subtitle: "orders-db-1's replacement pod refuses to start, and the old one refuses to admit it's gone",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "csi", "node-failure"],
  briefing: `A brief network partition isolated "worker-14" from the control plane for
about ninety seconds, then it recovered fully. But "orders-db-1", a
StatefulSet pod that was on that node, has been in a strange limbo ever
since - the old pod object is stuck showing status \`Unknown\`, and its
replacement, scheduled on a different, healthy node, refuses to start at
all.`,
  constraints: [
    "worker-14 itself has been fully healthy, Ready, and rejoined the cluster normally for the last two hours - the original network partition is long over.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "orders-db-1", namespace: "orders", labels: { app: "orders-db" } },
        status: { phase: "Running", conditions: [{ type: "Ready", status: "Unknown" }] },
        spec: { nodeName: "worker-14" },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "orders-db-1", namespace: "orders", labels: { app: "orders-db" }, annotations: { "note.internal/duplicate-name-explainer": "second incarnation, different node, same StatefulSet ordinal" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedAttachVolume", age: "1h50m", message: "Multi-Attach error for volume \"pvc-orders-db-1\": Volume is already exclusively attached to one node and can't be attached to another" },
        ],
        age: "1h55m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "network-partition-postmortem-notes", namespace: "orders" },
        spec: {
          data: {
            "notes.md":
              "During the ~90-second partition, the control plane lost contact with\nworker-14's kubelet and, per standard node-lifecycle behavior, marked\nthe node's pods' Ready condition as `Unknown` after a grace period, and\nstarted a `tolerationSeconds`-based countdown toward eventually deleting\nand rescheduling `orders-db-1` elsewhere - it did get rescheduled after\nthe countdown elapsed. But because the control plane never got explicit\nconfirmation from worker-14's kubelet that the *original* orders-db-1\npod was actually terminated (the node was unreachable at exactly the\nmoment that confirmation would have needed to happen, and by the time it\nreconnected, the automatic reschedule had already moved on), the API\nserver still shows the original pod object in a genuinely ambiguous\nstate rather than fully deleted, and - critically - the underlying CSI\ndriver's volume-attachment record still shows the volume attached to\nworker-14, since a clean `ControllerUnpublishVolume` call was never\nconfirmed to have completed either. The new pod's attach request is\nbeing correctly rejected as a result, even though worker-14 itself has\nbeen fully healthy and reachable again for nearly two hours - nothing\nhas gone back and forced a clean detach now that it's safe to.\n",
          },
        },
        age: "1h55m",
      },
    ],
  },
  hints: [
    "`kubectl get pod orders-db-1 -n orders -o wide` - is the original pod actually confirmed gone, or is its status still ambiguous even now?",
    "worker-14 has been healthy for two hours - but did the *volume attachment* itself ever get a clean, confirmed handoff, or did it just get interrupted mid-way?",
    "`kubectl get configmap network-partition-postmortem-notes -n orders -o yaml` - what specifically never got confirmed during the original partition, even after the node itself recovered?",
  ],
  options: [
    {
      id: "stale-volume-attachment-survived-node-recovery",
      label:
        "During the brief partition, the control plane lost contact with worker-14 at exactly the moment it would have confirmed the original orders-db-1 pod's termination and a clean volume detach, and by the time worker-14 reconnected, the automatic reschedule (triggered by the toleration-seconds countdown) had already moved on - leaving both the original pod's status genuinely ambiguous and, critically, the CSI volume-attachment record still pointing at worker-14, so the new pod's attach request is correctly rejected as a Multi-Attach conflict even though the node itself has been fully healthy for nearly two hours, because nothing has gone back to force a clean detach now that it's actually safe to.",
      explanation:
        "`network-partition-postmortem-notes` walks through exactly why worker-14's own recovery two hours ago didn't resolve this: the specific confirmation the control plane needed (clean pod termination, clean volume detach) had to happen *during* the partition window and never did, and nothing automatically retries that confirmation after the fact just because the node later became healthy again. The result is a genuinely stuck, ambiguous state - not something that resolves itself with more time, since the missing piece isn't node health, it's a specific one-time handoff confirmation that the partition's timing prevented.",
    },
    {
      id: "worker-14-still-partially-unhealthy",
      label: "worker-14 is still partially unhealthy despite appearing recovered.",
      explanation:
        "The scenario explicitly confirms worker-14 has been fully healthy, Ready, and rejoined normally for two hours - the stuck state isn't about the node's current health at all, it's about a one-time confirmation handoff that needed to happen during the original partition window and didn't, which the node's subsequent recovery doesn't retroactively fix.",
    },
    {
      id: "statefulset-controller-confused-by-duplicate-name",
      label: "The StatefulSet controller is confused by having two pod objects with the same name and ordinal.",
      explanation:
        "A StatefulSet never actually has two simultaneously-valid Pod objects sharing the same name in the API - what's shown is the original object still finalizing in an ambiguous state while a genuinely separate reschedule attempt is blocked on volume attachment; the underlying issue is the stale CSI attachment record, not object-naming confusion within the StatefulSet controller itself.",
    },
    {
      id: "pvc-storageclass-misconfigured",
      label: "The PVC's StorageClass is misconfigured in a way that's incompatible with rescheduling across nodes.",
      explanation:
        "There's nothing wrong with the StorageClass configuration itself - `ReadWriteOnce` volumes reschedule across nodes routinely and successfully under normal conditions (as seen with earlier node replacements elsewhere). The specific issue here is a one-time confirmation gap caused by the timing of a network partition, not a structural StorageClass problem.",
    },
  ],
  correctOptionId: "stale-volume-attachment-survived-node-recovery",
  resolution: `\`network-partition-postmortem-notes\` traces the precise sequence of bad
timing that led here: during the roughly 90-second partition, the
control plane lost contact with worker-14's kubelet at exactly the
moment it needed to confirm two things - that the original orders-db-1
pod had actually terminated, and that its volume had been cleanly
detached (a \`ControllerUnpublishVolume\` call the CSI driver needs to
complete and have confirmed). Standard node-lifecycle behavior kicked
in anyway: after a grace period, the pod's Ready condition went to
\`Unknown\`, a toleration-seconds countdown elapsed, and a replacement was
scheduled elsewhere - all before worker-14 reconnected. But because the
specific confirmations needed during the partition window never
happened, they don't happen automatically after the fact just because
the node later recovered: the original pod object stays in an ambiguous
state, and the CSI driver's own attachment record still shows the volume
attached to worker-14, which is exactly why the new pod's attach request
is being correctly rejected as a Multi-Attach conflict two hours later,
despite the node itself being completely healthy this whole time.

There's no live fix from this read-only console, but the operational
recovery is forcing the stale state to resolve explicitly, since nothing
will retry it on its own: force-deleting the original, ambiguous pod
object to let the API server finalize its removal -

\`\`\`bash
kubectl delete pod orders-db-1 -n orders --grace-period=0 --force
\`\`\`

(safe here specifically because worker-14 is confirmed healthy and not
actually still running the old container) - followed by, if the CSI
driver doesn't automatically reconcile its attachment record afterward,
manually triggering a force-detach via the CSI driver's own tooling or
the cloud provider's volume-detach API for the specific volume, so the
new pod's attach request can finally succeed. For the future: this class
of stuck state is a known, if uncommon, edge case of network partitions
interacting with stateful workloads' volume lifecycle - worth having a
documented, tested runbook for "pod status ambiguous after a node
partition, volume won't reattach" rather than working it out from first
principles under pressure, since the fix (forced deletion, forced
detach) is destructive enough to warrant real confidence before running
it.`,
};
