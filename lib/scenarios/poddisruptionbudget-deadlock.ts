import type { Scenario } from "./types";

export const poddisruptionbudgetDeadlock: Scenario = {
  id: "poddisruptionbudget-deadlock",
  title: "The Drain That Wouldn't Finish",
  subtitle: "a routine node upgrade has been \"in progress\" for six hours",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "poddisruptionbudget", "nodes"],
  briefing: `Platform kicked off a routine node upgrade last night - drain a node,
replace it, move to the next one. The very first node has been "draining"
for six hours and hasn't finished. Nothing else looks broken; the
workload on that node is healthy and serving traffic normally.`,
  constraints: [
    "There are no failing pods, no crashes, nothing unhealthy anywhere in this namespace - this is purely about eviction being unable to proceed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-cache", namespace: "pricing", labels: { app: "pricing-cache" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-cache-4d5e6f7g8-h9i0j", namespace: "pricing", labels: { app: "pricing-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "pricing-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "FailedEviction", age: "5h", message: "Cannot evict pod as it would violate the pod's disruption budget." },
        ],
        age: "1y",
      },
      {
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: { name: "pricing-cache-pdb", namespace: "pricing" },
        spec: { minAvailable: 3, selector: { matchLabels: { app: "pricing-cache" } } },
        status: { currentHealthy: 3, desiredHealthy: 3, disruptionsAllowed: 0 },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get pod pricing-cache-4d5e6f7g8-h9i0j -n pricing` - the FailedEviction event names the exact mechanism blocking the drain.",
    "`kubectl get poddisruptionbudget pricing-cache-pdb -n pricing -o yaml` - compare `spec.minAvailable` against the Deployment's total replica count.",
    "A PodDisruptionBudget's `disruptionsAllowed` field says how many pods could be voluntarily evicted right now without violating it. What does `0` mean for a node drain trying to evict even one pod?",
  ],
  options: [
    {
      id: "pdb-min-available-equals-replicas",
      label:
        "`pricing-cache-pdb` sets `minAvailable: 3` for a Deployment that only has 3 replicas total - mathematically, zero pods can ever be voluntarily evicted without dropping below the minimum, so `disruptionsAllowed` is permanently 0 and the drain can never evict a single pod from this Deployment, no matter how long it waits.",
      explanation:
        "The PDB's own status confirms it: `disruptionsAllowed: 0`, with `minAvailable: 3` matching the Deployment's full replica count exactly. A PodDisruptionBudget that requires *all* replicas to stay available at all times doesn't tolerate even a single voluntary eviction - which is exactly the mechanism a node drain relies on. The FailedEviction event names this directly. This isn't a transient issue that resolves with more waiting; it's a permanent, structural block for as long as the PDB and replica count stay as they are.",
    },
    {
      id: "node-hardware-failing",
      label: "The node itself is failing and can't complete the drain process.",
      explanation:
        "There's no indication of node-level hardware or kubelet trouble - the workload on the node is healthy and serving traffic normally. The FailedEviction event points specifically at a disruption budget check blocking the eviction, not a node-side failure.",
    },
    {
      id: "pod-stuck-terminating",
      label: "A pod on the node is stuck Terminating and blocking the drain from proceeding.",
      explanation:
        "`pricing-cache-4d5e6f7g8-h9i0j` is `Running` and healthy, not `Terminating` - the drain hasn't managed to start evicting it at all, because the eviction request itself is being actively rejected by the PDB check before any termination begins.",
    },
    {
      id: "deployment-min-ready-seconds",
      label: "The Deployment's `minReadySeconds` is set too high, slowing down replacement pods becoming available.",
      explanation:
        "No replacement pod has even been created yet - the original pod hasn't been evicted, so there's nothing for a new pod to replace. `minReadySeconds` affects how long a *new* pod must stay ready before being counted, which isn't relevant to a pod that hasn't been touched at all.",
    },
  ],
  correctOptionId: "pdb-min-available-equals-replicas",
  resolution: `\`pricing-cache-pdb\`'s status makes the deadlock explicit:
\`disruptionsAllowed: 0\`. Its \`spec.minAvailable\` is set to 3 - the same
number as the Deployment's total replica count. That means the PDB
requires all three pods to stay available at all times; evicting even one
would drop availability to 2, below the minimum, so the eviction API
rejects every attempt with exactly the "would violate the pod's
disruption budget" error seen in the pod's events. This isn't a slow
drain or a flaky node - it's a mathematically permanent block. No amount
of waiting fixes a PDB that structurally allows zero disruptions.

This is a common trap when a PDB is set with good intentions ("never let
availability drop") without accounting for how draining and rolling
upgrades actually work - they rely on being able to evict *one* pod at a
time while the others cover for it. The fix is loosening the PDB just
enough to allow that:

\`\`\`yaml
spec:
  minAvailable: 2   # or: maxUnavailable: 1
  selector:
    matchLabels: { app: pricing-cache }
\`\`\`

With \`minAvailable: 2\` (or equivalently \`maxUnavailable: 1\`), one pod can
always be evicted at a time - drains and rolling upgrades can proceed pod
by pod, while the Deployment still guarantees at least 2 of 3 replicas
stay up throughout. A PDB that leaves zero room for voluntary disruption
doesn't make a workload more available - it just makes it impossible to
ever safely maintain the nodes underneath it.`,
};
