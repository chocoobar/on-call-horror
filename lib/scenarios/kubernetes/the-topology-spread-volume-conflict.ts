import type { Scenario } from "../types";

export const theTopologySpreadVolumeConflict: Scenario = {
  id: "the-topology-spread-volume-conflict",
  title: "The Topology Spread Volume Conflict",
  subtitle: "timeseries-db-2 can never schedule, no matter how much capacity is added to any zone",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "statefulset", "topology-spread"],
  briefing: `"timeseries-db" is a 3-replica StatefulSet with a hard topology spread
constraint keeping one replica per zone for resilience, and zonal storage
volumes per the usual pattern for this database. \`timeseries-db-2\` has
been permanently Pending for two days. Adding more nodes to every zone
hasn't helped at all - it's not a capacity problem, but nobody can figure
out what it actually is.`,
  constraints: [
    "Every zone has ample free node capacity right now - this has been independently verified and is not the issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "timeseries-db", namespace: "metrics-store", labels: { app: "timeseries-db" } },
        spec: {
          replicas: 3,
          serviceName: "timeseries-db",
          template: {
            spec: {
              topologySpreadConstraints: [{ maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "DoNotSchedule", labelSelector: { matchLabels: { app: "timeseries-db" } } }],
              containers: [{ name: "timeseries-db", image: "registry.internal/timeseries-db:6.0.0" }],
            },
          },
          volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { storageClassName: "ebs-gp3-zonal", accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "200Gi" } } } }],
        },
        status: { readyReplicas: 2, updatedReplicas: 3, currentReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "timeseries-db-2", namespace: "metrics-store", labels: { app: "timeseries-db" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "5m", message: "0/9 nodes are available: 3 node(s) had volume node affinity conflict, 6 node(s) didn't satisfy existing pods topology spread constraints (missing required label)" },
        ],
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "data-timeseries-db-2", namespace: "metrics-store" },
        spec: { storageClassName: "ebs-gp3-zonal", accessModes: ["ReadWriteOnce"] },
        status: { phase: "Bound" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "timeseries-db-scheduling-notes", namespace: "metrics-store" },
        spec: {
          data: {
            "notes.md":
              "timeseries-db-2's PVC (`data-timeseries-db-2`) was originally bound to\na zonal EBS volume in us-east-1c a year ago. But us-east-1c's nodes were\nfully decommissioned 3 days ago as part of an AZ consolidation - the\ncluster now only spans us-east-1a and us-east-1b, with 3 nodes each.\ntimeseries-db-2's volume is permanently pinned to a now-nonexistent\nzone: no node anywhere can satisfy the PV's zone node-affinity. On top\nof that, the *other* 6 nodes across the 2 remaining zones already each\nhold a timeseries-db-0 or timeseries-db-1 pod (one per zone, per the\nhard topology spread constraint) - so even setting the volume issue\naside entirely, no remaining node is topology-spread-eligible for a\nthird replica of the same app without exceeding maxSkew: 1 relative to\nthe other two zones now being the *only* two zones. This pod is doubly\nunschedulable: its volume wants a zone that no longer exists, and even a\nbrand-new volume in an existing zone would immediately collide with the\ntopology spread constraint once two zones already each have one replica\nand there's no third zone left to be the one and only home for a third.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod timeseries-db-2 -n metrics-store` - read the FailedScheduling message closely, it actually names *two* separate, independent problems.",
    "`kubectl get configmap timeseries-db-scheduling-notes -n metrics-store -o yaml` - what zone was this pod's volume created in, and does that zone's node pool still exist?",
    "Even setting the volume aside - with only 2 zones left and a hard `maxSkew: 1` spread constraint across 3 replicas, is there any valid zone left for the pod to land in at all?",
  ],
  options: [
    {
      id: "zone-removed-plus-topology-spread-impossible-with-3-zones-gone-to-2",
      label:
        "timeseries-db-2's volume is permanently pinned to us-east-1c, which was fully decommissioned 3 days ago during an AZ consolidation - so no node anywhere can satisfy its volume's zone affinity at all. Even setting that aside, the StatefulSet's hard topology spread constraint (`maxSkew: 1`, one replica per zone) was designed around 3 zones for 3 replicas, and with only 2 zones now existing and each already hosting one of the other two replicas, there's no valid zone left for a third replica to land in without violating the spread constraint either - the pod is unschedulable for two independent, compounding reasons, and neither adding nodes nor freeing capacity in any existing zone touches either one.",
      explanation:
        "The scheduling event actually names both problems in one message: \"volume node affinity conflict\" (the zonal-volume issue) and \"didn't satisfy existing pods topology spread constraints\" (the zone-count issue) on different subsets of nodes. `timeseries-db-scheduling-notes` confirms both mechanisms independently: the pod's volume is pinned to a zone that no longer has any nodes at all, and separately, the topology spread constraint - built for a 3-zone world - has no valid target zone left now that the cluster only spans 2 zones, each already occupied by one of the other replicas. Capacity additions to existing zones can never fix either problem, which is exactly why the obvious fix (add nodes) had zero effect.",
    },
    {
      id: "only-volume-issue-matters",
      label: "The only problem is the volume being pinned to a decommissioned zone - once that's fixed, scheduling will succeed.",
      explanation:
        "Even a hypothetical fresh volume created in an existing zone wouldn't solve this alone - the scheduling event's second clause, about topology spread constraints, is a distinct and separate blocker: with only 2 zones remaining and each already hosting one of the other two replicas, there's structurally no valid zone left for a third replica under a hard `maxSkew: 1` constraint originally designed for 3 zones.",
    },
    {
      id: "only-topology-spread-issue-matters",
      label: "The only problem is the topology spread constraint no longer fitting a 2-zone cluster - the volume is fine.",
      explanation:
        "The scheduling event's first clause is explicit about a genuine \"volume node affinity conflict\" on 3 of the 9 nodes - the pod's PVC really is bound to a zone with zero remaining nodes, an entirely separate and real blocker from the topology spread issue, not something that can be dismissed.",
    },
    {
      id: "resource-requests-too-high",
      label: "timeseries-db-2's resource requests are too high for the remaining nodes to accommodate.",
      explanation:
        "The scenario confirms ample free node capacity in every zone, and the scheduling event's actual wording cites volume affinity and topology spread constraints specifically, with no mention of insufficient CPU or memory - resource sizing isn't a factor in this failure at all.",
    },
  ],
  correctOptionId: "zone-removed-plus-topology-spread-impossible-with-3-zones-gone-to-2",
  resolution: `The scheduling event names both problems at once, on different subsets
of the 9 nodes checked: "volume node affinity conflict" on 3 nodes, and
"didn't satisfy existing pods topology spread constraints" on the other
6. \`timeseries-db-scheduling-notes\` confirms both are real, independent,
and compounding. First: timeseries-db-2's zonal volume is permanently
pinned to us-east-1c, which was fully decommissioned three days ago - no
node anywhere can ever satisfy that volume's zone affinity again.
Second, and easy to miss even after noticing the first: the StatefulSet's
hard topology spread constraint (\`maxSkew: 1\`, one replica per zone) was
designed around a 3-zone cluster for 3 replicas - with only 2 zones left,
and each already hosting one of the other two replicas, there is no
valid zone remaining for a third replica at all, regardless of the
volume issue. Adding node capacity to existing zones can never fix
either problem, which explains why that obvious first attempt did
nothing.

This needs a deliberate architectural decision, not a scheduling tweak.
Given the cluster has permanently moved to 2 zones, the topology spread
constraint needs to reflect that reality - most likely accepting 2
zones with an uneven split, or moving to a different distribution
strategy entirely:

\`\`\`yaml
topologySpreadConstraints:
  - maxSkew: 2   # allow up to 2 replicas in one zone given only 2 zones exist
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector: { matchLabels: { app: timeseries-db } }
\`\`\`

And separately, timeseries-db-2's specific PVC needs to be deleted and
recreated so a fresh zonal volume gets provisioned in one of the two
*remaining* zones - since a StatefulSet's existing PVC won't relocate on
its own, this requires deleting \`data-timeseries-db-2\` explicitly
(accepting the data loss for that one replica, restored via the
database's own replication/resync from the two healthy replicas) before
the pod can bind a usable volume. Any AZ consolidation affecting nodes
needs to be checked against every zonal-storage StatefulSet and every
zone-count-dependent topology constraint in the cluster beforehand - both
failure modes here are entirely invisible until a pod actually needs to
reschedule.`,
};
