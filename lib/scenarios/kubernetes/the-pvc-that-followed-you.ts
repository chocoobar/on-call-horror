import type { Scenario } from "../types";

export const thePvcThatFollowedYou: Scenario = {
  id: "the-pvc-that-followed-you",
  title: "The PVC That Followed You",
  subtitle: "metrics-db-1 has been Pending since the node it lived on got drained",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "storage", "statefulset"],
  briefing: `A routine node drain for maintenance evicted "metrics-db-1", one pod in a
3-node StatefulSet. The other two pods rescheduled fine within seconds.
This one has been stuck Pending for twenty minutes.`,
  constraints: [
    "The cluster has plenty of free CPU and memory capacity across all remaining nodes - this isn't a resource shortage.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "metrics-db", namespace: "metrics", labels: { app: "metrics-db" } },
        spec: { replicas: 3, serviceName: "metrics-db" },
        status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "metrics-db-1", namespace: "metrics", labels: { app: "metrics-db" } },
        status: { phase: "Pending" },
        events: [
          {
            type: "Warning",
            reason: "FailedScheduling",
            age: "1m",
            message:
              "0/6 nodes are available: 4 node(s) had volume node affinity conflict, 2 node(s) didn't match Pod's node affinity/selector.",
          },
        ],
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "data-metrics-db-1", namespace: "metrics", labels: { app: "metrics-db" } },
        spec: { storageClassName: "ebs-gp3-zonal", accessModes: ["ReadWriteOnce"] },
        status: { phase: "Bound" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cluster-topology-notes", namespace: "metrics" },
        spec: {
          data: {
            "notes.md":
              "`ebs-gp3-zonal` is a zonal (single-AZ) EBS storage class - a volume\nprovisioned from it is physically pinned to one AZ and can only ever be\nattached to nodes in that same AZ.\n\nNode inventory after today's drain:\n- 4 nodes remaining in us-east-1a\n- 2 nodes remaining in us-east-1b\n\n`data-metrics-db-1`'s underlying EBS volume was provisioned in\nus-east-1b when metrics-db-1 first started, over a year ago.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl describe pod metrics-db-1 -n metrics` - read the `FailedScheduling` event closely: 'volume node affinity conflict' is a very specific phrase.",
    "`kubectl get pvc data-metrics-db-1 -n metrics -o yaml` - what storage class backs this volume, and what does that storage class imply about where the volume can physically live?",
    "`kubectl get configmap cluster-topology-notes -n metrics -o yaml` - compare the AZ the volume was created in against which AZs still have nodes after today's drain.",
  ],
  options: [
    {
      id: "zonal-volume-az-mismatch",
      label:
        "metrics-db-1's PersistentVolumeClaim is backed by a zonal EBS volume permanently pinned to us-east-1b, but today's drain removed the last node(s) it could actually land on in that AZ from consideration for other reasons (taints/labels), leaving no eligible node in the one AZ this specific volume can attach to - the pod can't schedule anywhere the volume can follow it to.",
      explanation:
        "The `FailedScheduling` event's exact wording - 'volume node affinity conflict' - is Kubernetes' specific error for a pod that can only run on nodes matching its PV's zone, with no such node available. `cluster-topology-notes` confirms `data-metrics-db-1`'s volume lives in us-east-1b and was provisioned over a year ago, and that today's remaining node inventory doesn't give it anywhere eligible to attach in that same AZ. A StatefulSet pod is tied to the same PVC (and therefore the same physical volume location) across reschedules by design - it can't just spin up fresh storage in a different AZ the way a stateless pod could.",
    },
    {
      id: "not-enough-capacity",
      label: "There isn't enough free CPU/memory on the remaining nodes to schedule the pod.",
      explanation:
        "The cluster has ample free compute capacity across all remaining nodes - the scheduling failure message is specifically about volume/node affinity, not resource requests exceeding what's available.",
    },
    {
      id: "statefulset-misconfigured",
      label: "The StatefulSet's pod template has an invalid configuration that only affects this one replica.",
      explanation:
        "All three replicas share the exact same pod template - a StatefulSet doesn't have per-replica configuration that could make one instance's template invalid while the other two work. The other two pods rescheduling successfully rules out a template problem.",
    },
    {
      id: "pvc-not-bound",
      label: "The PersistentVolumeClaim never actually bound to a volume.",
      explanation:
        "`data-metrics-db-1` shows `status.phase: Bound` - it's already successfully bound to an existing volume. The problem isn't binding a new volume, it's that the pod can't be scheduled onto a node that can reach the volume it's already bound to.",
    },
  ],
  correctOptionId: "zonal-volume-az-mismatch",
  resolution: `The scheduling event's exact phrase - "volume node affinity conflict" -
is Kubernetes' dedicated error for exactly this situation. Zonal storage
classes like \`ebs-gp3-zonal\` provision a volume physically tied to one
availability zone; the resulting PersistentVolume carries a node affinity
requirement that only matches nodes in that same AZ. \`data-metrics-db-1\`'s
volume was created in us-east-1b when the pod first started over a year
ago, and StatefulSet pods keep the same PVC (and therefore the same
physical volume) across every reschedule - unlike a stateless Deployment,
it can't just provision fresh storage wherever there's room. Today's
drain left this pod with nowhere in us-east-1b it's eligible to run,
so it can never re-attach to its own data.

There's no live fix from this read-only console - the underlying issue is
infrastructure topology, not application config, and needs one of:

- Bring a node back up in us-east-1b (even temporarily) so the existing
  pod and volume can reunite, or
- Migrate to a storage class that isn't zone-locked (e.g. a
  multi-attach-capable or replicated backend) if this StatefulSet needs
  to tolerate losing an entire AZ's worth of nodes, or
- Restore from backup onto a freshly provisioned volume in an AZ that
  still has capacity, accepting the data between the last backup and now
  as lost.

Any StatefulSet backed by zonal storage inherits a hard constraint: it can
only ever be rescheduled within nodes in the same AZ its volume was born
in - worth knowing before a maintenance drain takes out the last node in
that zone.`,
};
