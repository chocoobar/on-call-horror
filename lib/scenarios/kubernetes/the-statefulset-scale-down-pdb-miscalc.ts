import type { Scenario } from "../types";

export const theStatefulsetScaleDownPdbMiscalc: Scenario = {
  id: "the-statefulset-scale-down-pdb-miscalc",
  title: "The StatefulSet Scale-Down PDB Miscalc",
  subtitle: "scaling zookeeper-ensemble down from 5 to 3 for a cost review has been \"in progress\" for an hour",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "statefulset", "poddisruptionbudget"],
  briefing: `As part of a cost-review exercise, "zookeeper-ensemble" was scaled down
from 5 replicas to 3. The two highest-ordinal pods should have terminated
within a minute or two. An hour later, both are still Running, apparently
untouched, and the StatefulSet still shows 5 pods total.`,
  constraints: [
    "All 5 pods are currently healthy and Ready - nothing is crashing or unhealthy anywhere in the ensemble right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "zookeeper-ensemble", namespace: "coordination", labels: { app: "zookeeper-ensemble" } },
        spec: { replicas: 3, serviceName: "zookeeper-ensemble" },
        status: { readyReplicas: 5, updatedReplicas: 5, currentReplicas: 5 },
        age: "1y",
      },
      {
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: { name: "zookeeper-ensemble-pdb", namespace: "coordination" },
        spec: { minAvailable: 5, selector: { matchLabels: { app: "zookeeper-ensemble" } } },
        status: { currentHealthy: 5, desiredHealthy: 5, disruptionsAllowed: 0 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "zookeeper-ensemble-4", namespace: "coordination", labels: { app: "zookeeper-ensemble" } },
        status: { phase: "Running", containerStatuses: [{ name: "zookeeper-ensemble", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "FailedEviction", age: "55m", message: "Cannot evict pod as it would violate the pod's disruption budget." },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "zookeeper-scaledown-notes", namespace: "coordination" },
        spec: {
          data: {
            "notes.md":
              "zookeeper-ensemble-pdb's `minAvailable: 5` was set to match the\nensemble's original 5-replica size, on the reasoning that a quorum-based\nsystem should never lose a member involuntarily. However, a StatefulSet\nscale-down is a *voluntary*, explicit, desired-state change - the\nStatefulSet controller still uses the standard eviction API to remove\nthe now-excess pods one at a time (rather than force-deleting them), and\nthat eviction request is subject to the same PDB check as any other\nvoluntary disruption. With `minAvailable` hard-set to the *original*\nreplica count rather than something that tracks the *current* desired\ncount, the PDB now permanently forbids evicting anything at all, since\ndoing so would (on paper) drop healthy count below 5 - even though the\nactual intent is to reduce to 3 permanently, not to protect 5 as some\nfixed floor forever.\n",
          },
        },
        age: "55m",
      },
    ],
  },
  hints: [
    "`kubectl get statefulset zookeeper-ensemble -n coordination` - `spec.replicas` says 3, but how many pods actually still exist?",
    "`kubectl get pdb zookeeper-ensemble-pdb -n coordination -o yaml` - compare `minAvailable` against the *new* desired replica count, not the old one.",
    "A StatefulSet scale-down still goes through the eviction API for removing excess pods, one at a time - what happens when a PDB's `minAvailable` was hardcoded to the *old* size?",
  ],
  options: [
    {
      id: "pdb-minavailable-still-matches-old-replica-count",
      label:
        "zookeeper-ensemble-pdb's `minAvailable` is hardcoded to 5, matching the ensemble's *original* size - but the StatefulSet still uses the standard eviction API (not a force-delete) to remove excess pods during a scale-down, and with `minAvailable: 5` unchanged, evicting even one of the two excess pods would drop healthy count below 5, which the PDB correctly and permanently refuses, blocking the scale-down from ever proceeding until the PDB itself is updated to reflect the new target size.",
      explanation:
        "The excess pod's own event is explicit: \"Cannot evict pod as it would violate the pod's disruption budget,\" and the PDB's status shows `disruptionsAllowed: 0` with `minAvailable: 5`. `zookeeper-scaledown-notes` explains the root cause directly: the PDB was set to protect the *original* 5-replica size as an absolute floor, without anyone updating it to reflect the new, smaller desired count when the StatefulSet itself was scaled down - so a completely intentional, voluntary scale-down collides with a PDB that (correctly, per its own outdated configuration) refuses to ever let healthy count drop below 5.",
    },
    {
      id: "statefulset-controller-bug",
      label: "There's a bug in the StatefulSet controller preventing it from processing the scale-down.",
      explanation:
        "The StatefulSet controller is behaving correctly - it's attempting to remove the excess pods via the standard eviction API exactly as designed, and that eviction is being legitimately blocked by the PDB's own configuration, not failing due to any controller malfunction.",
    },
    {
      id: "ordinal-pods-stuck-terminating",
      label: "The two excess pods are stuck in a Terminating state and won't fully shut down.",
      explanation:
        "Both excess pods show `phase: Running`, not `Terminating` - they haven't even begun the termination process, because the eviction request needed to initiate it is being rejected upfront by the PDB check, before termination would ever start.",
    },
    {
      id: "quorum-requirement-blocking-scaledown",
      label: "Zookeeper's own internal quorum protocol is refusing to let members leave.",
      explanation:
        "The blocking event is a Kubernetes-level `FailedEviction` citing a PodDisruptionBudget, not any application-level quorum rejection from Zookeeper itself - this is entirely a Kubernetes eviction-API/PDB interaction, occurring before Zookeeper's own process would even be asked to leave the ensemble.",
    },
  ],
  correctOptionId: "pdb-minavailable-still-matches-old-replica-count",
  resolution: `The excess pod's own event names the mechanism directly: "Cannot evict
pod as it would violate the pod's disruption budget," backed by the
PDB's own status showing \`disruptionsAllowed: 0\`. \`zookeeper-scaledown-notes\`
explains why: \`zookeeper-ensemble-pdb\`'s \`minAvailable\` was set to 5 to
match the ensemble's *original* size, under the reasoning that a
quorum-based system shouldn't involuntarily lose a member - a reasonable
goal, but it was never revisited when the StatefulSet's own desired
replica count changed. A StatefulSet scale-down still removes excess
pods through the standard eviction API rather than force-deleting them,
so it's subject to the exact same PDB check any other voluntary
disruption would face - and with \`minAvailable\` frozen at the old count,
the PDB permanently (not just temporarily) refuses to let healthy count
drop below 5, directly conflicting with the now-desired target of 3.

The fix is updating the PDB to match the new intended size before the
scale-down can proceed:

\`\`\`yaml
spec:
  minAvailable: 3   # or minAvailable: 2, if occasional single-pod
                     # disruption during future maintenance matters too
  selector:
    matchLabels: { app: zookeeper-ensemble }
\`\`\`

Once updated, the StatefulSet's pending scale-down should proceed
immediately, since the two excess pods no longer represent a disruption-budget
violation. The broader lesson: a PDB's \`minAvailable\`/\`maxUnavailable\`
should be treated as a constraint that tracks a workload's *current*
desired size, not a fixed historical number - any deliberate,
permanent replica-count change (up or down) is worth pairing with a
check of whether an associated PDB still makes sense at the new size,
rather than discovering the mismatch only when the next scale operation
mysteriously refuses to complete.`,
};
