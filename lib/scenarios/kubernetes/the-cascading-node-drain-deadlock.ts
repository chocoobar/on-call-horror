import type { Scenario } from "../types";

export const theCascadingNodeDrainDeadlock: Scenario = {
  id: "the-cascading-node-drain-deadlock",
  title: "The Cascading Node Drain Deadlock",
  subtitle: "a cluster upgrade has drained 2 of 6 nodes and then simply stopped making progress",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "poddisruptionbudget", "nodes"],
  briefing: `A rolling cluster upgrade drains and replaces one node at a time. It got
through the first two nodes in about ten minutes each, as expected. The
third node has been "draining" for over three hours, and unlike the
earlier two, this one genuinely looks stuck - no obvious single culprit,
just... nothing moving.`,
  constraints: [
    "Every pod on the stuck node is currently healthy and Ready - nothing is crashing or failing readiness checks anywhere.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-indexer", namespace: "search", labels: { app: "search-indexer" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: { name: "search-indexer-pdb", namespace: "search" },
        spec: { minAvailable: 2, selector: { matchLabels: { app: "search-indexer" } } },
        status: { currentHealthy: 2, desiredHealthy: 2, disruptionsAllowed: 0 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "search-indexer-2m3n4o5p6", namespace: "search", labels: { app: "search-indexer" } },
        status: { phase: "Running", containerStatuses: [{ name: "search-indexer", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [{ type: "Warning", reason: "FailedEviction", age: "3h", message: "Cannot evict pod as it would violate the pod's disruption budget." }],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "upgrade-cascade-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "search-indexer normally runs 3/3 healthy replicas with `minAvailable: 2`\n- comfortably drainable one at a time under normal conditions. But the\nfirst two nodes drained by this upgrade *each* happened to be running one\nreplica of search-indexer, and each drain's replacement pod landed on a\n*different new* node successfully - except the very last one, whose\nreplacement pod has been stuck Pending for an unrelated reason (a\nseparate, still-unresolved resource-fragmentation issue on the newest\nnodes from this same upgrade). So of the original 3 replicas, one was\nsuccessfully evicted and rescheduled from node 1, one was successfully\nevicted and rescheduled from node 2, and the third (on the node\ncurrently being drained) can't be evicted at all, because doing so would\ndrop healthy count to 1, below the PDB's `minAvailable: 2` - a\nconsequence of the *replacement* pod for one of the earlier evictions\nnever having actually come up cleanly, not of anything about the current\nnode itself.\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n search -l app=search-indexer -o wide` - are all 3 replicas actually healthy right now, or does the count not add up?",
    "`kubectl get pdb search-indexer-pdb -n search` - `disruptionsAllowed: 0` with only 2 of 3 replicas healthy. Why is a replica missing if nothing's currently failing?",
    "This upgrade already drained two other nodes successfully - did every pod that was evicted from them actually come back up cleanly afterward?",
  ],
  options: [
    {
      id: "earlier-replacement-pod-never-recovered-eating-pdb-headroom",
      label:
        "One of search-indexer's 3 replicas was evicted cleanly during an earlier node's drain in this same upgrade, but its replacement pod never came up successfully afterward (stuck Pending for an unrelated resource-fragmentation issue on the newer nodes) - so the Deployment has been quietly running at 2/3 healthy ever since, well before today's drain even reached this third node, and with `minAvailable: 2` already consuming all the PDB's disruption headroom, evicting the pod on the currently-draining node would drop healthy count to 1, which the PDB correctly refuses regardless of anything specific to this node.",
      explanation:
        "`upgrade-cascade-notes` traces the full chain: this isn't a problem with the currently-draining node at all, it's residual damage from an earlier step in the same upgrade, where a replacement pod for a previously-evicted replica never actually came up. The PDB's own status - `currentHealthy: 2`, `disruptionsAllowed: 0` - confirms the Deployment has been running below its full replica count for a while, consuming all its disruption budget before this node's drain even started, which is why this drain (unlike the two before it) has no room to evict anything at all.",
    },
    {
      id: "pdb-minavailable-too-strict-generally",
      label: "search-indexer-pdb's `minAvailable: 2` is simply too strict for a 3-replica Deployment during any rolling upgrade.",
      explanation:
        "`minAvailable: 2` out of 3 replicas is a completely standard, drainable configuration under normal conditions - and indeed the first two nodes drained just fine under this exact same PDB. The block here is specifically because the Deployment is currently running at only 2/3 healthy (due to a separate, earlier problem), not because the PDB's threshold itself is unreasonable.",
    },
    {
      id: "current-node-hardware-issue",
      label: "The currently-draining node itself has a hardware or connectivity issue preventing eviction.",
      explanation:
        "The pod on the currently-draining node is confirmed healthy and Ready, and the blocking event is specifically a PDB violation (`FailedEviction`), not any node-health or connectivity-related failure - the current node is not itself the source of the problem, it's simply the one that happened to run out of PDB headroom to drain into.",
    },
    {
      id: "three-separate-unrelated-drain-issues",
      label: "Each of the three drained nodes has hit a completely separate, unrelated problem.",
      explanation:
        "`upgrade-cascade-notes` shows these are directly connected, not separate incidents - the third node's block is a direct, causal consequence of a replacement pod from the *first* node's drain never successfully coming up, which quietly consumed the PDB's entire remaining disruption budget well before the third drain even began.",
    },
  ],
  correctOptionId: "earlier-replacement-pod-never-recovered-eating-pdb-headroom",
  resolution: `\`upgrade-cascade-notes\` reveals this isn't really about the currently-draining
node at all - it's a delayed consequence of something that happened
during an earlier step of the same upgrade. One of search-indexer's 3
replicas was evicted cleanly when an earlier node drained, exactly as
intended, but its replacement pod never actually came up successfully
afterward, stuck Pending due to a separate, still-unresolved resource
fragmentation issue on the newer nodes this upgrade has been creating.
So for a while now, well before this third drain even started, the
Deployment has quietly been running at 2 of 3 healthy replicas -
confirmed by the PDB's own status, \`currentHealthy: 2\`. With
\`minAvailable: 2\`, that already consumes the entire disruption budget:
evicting the pod on the currently-draining node would drop healthy count
to 1, which the PDB correctly and accurately refuses, regardless of the
current node's own health.

The fix isn't about this drain or this node specifically - it's about
recovering the actually-missing replica first. Investigating and
resolving why that earlier replacement pod is stuck Pending (the
resource-fragmentation issue on newer nodes) restores the third healthy
replica, which immediately restores the PDB's disruption headroom and
lets the current drain proceed normally:

\`\`\`bash
kubectl describe pod <the-stuck-pending-replacement-pod> -n search
# diagnose and resolve the underlying scheduling/fragmentation issue
\`\`\`

More broadly, this is a good argument for treating a rolling
cluster-wide operation like a multi-node upgrade as something to
actively monitor step-by-step, not just kick off and check back on -
each drain's *downstream* health (did every evicted pod's replacement
actually come back healthy?) matters just as much as whether the drain
itself completed, since a quiet, un-investigated gap from step one can
silently consume the safety margin a later step depends on, several
steps and hours later, in a way that looks - at first glance - like an
unrelated, isolated problem with the node currently being drained.`,
};
