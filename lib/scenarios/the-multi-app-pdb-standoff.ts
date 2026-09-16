import type { Scenario } from "./types";

export const theMultiAppPdbStandoff: Scenario = {
  id: "the-multi-app-pdb-standoff",
  title: "The Multi-App PDB Standoff",
  subtitle: "a node drain is blocked, but neither of the two apps on it has a PDB that alone should block anything",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "poddisruptionbudget", "nodes"],
  briefing: `A node drain for a kernel patch has been stuck for hours. Two unrelated
services, "auth-cache" and "session-store", share the node. Each has its
own PodDisruptionBudget, and both look individually reasonable -
\`minAvailable: 50%\` with several replicas each. Neither PDB alone looks
like it should be a problem.`,
  constraints: [
    "Both services are otherwise completely healthy - every replica of both is Running and Ready right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "auth-cache", namespace: "platform", labels: { app: "auth-cache" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: { name: "auth-cache-pdb", namespace: "platform" },
        spec: { minAvailable: "50%", selector: { matchLabels: { app: "auth-cache" } } },
        status: { currentHealthy: 2, desiredHealthy: 1, disruptionsAllowed: 1 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-store", namespace: "platform", labels: { app: "session-store" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: { name: "session-store-pdb", namespace: "platform" },
        spec: { minAvailable: "50%", selector: { matchLabels: { tier: "cache" } } },
        status: { currentHealthy: 2, desiredHealthy: 1, disruptionsAllowed: 1 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "auth-cache-1a2b3c4d5-e6f7g", namespace: "platform", labels: { app: "auth-cache", tier: "cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "auth-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [{ type: "Warning", reason: "FailedEviction", age: "3h", message: "Cannot evict pod as it would violate the pod's disruption budget." }],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "platform-pdb-selector-audit-notes", namespace: "platform" },
        spec: {
          data: {
            "notes.md":
              "auth-cache's pods carry both `app: auth-cache` and `tier: cache`\nlabels (the latter added months ago for a shared dashboard grouping,\nunrelated to PDBs). `session-store-pdb`'s selector was written as\n`tier: cache` instead of `app: session-store` - likely a copy-paste\nerror when it was created from auth-cache-pdb's manifest as a template.\nAs a result, `session-store-pdb` actually also matches auth-cache's\npods (since they carry `tier: cache` too), in addition to session-store's\nown. Each individual auth-cache pod is now counted against *two*\noverlapping PDBs simultaneously (its own correctly-scoped one, plus\nsession-store's mis-scoped one) - an eviction has to satisfy both at\nonce, and the combined effect leaves no disruption allowed for a pod\nthat, from either PDB read in isolation, looked like it should have\nheadroom.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get pdb -n platform -o yaml` - check each PDB's `spec.selector` very carefully against every pod's *actual* labels, not just the app it's named after.",
    "`kubectl get pods -n platform --show-labels` - does any pod carry labels that could match more than one PDB's selector?",
    "A pod can be covered by more than one PodDisruptionBudget at once if their selectors overlap - an eviction then has to satisfy all of them simultaneously, not just the one that shares its app name.",
  ],
  options: [
    {
      id: "session-store-pdb-selector-also-matches-auth-cache",
      label:
        "`session-store-pdb`'s selector was mistakenly written as `tier: cache` (likely copy-pasted while creating it from another PDB's manifest) instead of `app: session-store` - since auth-cache's pods also carry a `tier: cache` label from an unrelated dashboard-grouping effort, they're now covered by *two* PDBs simultaneously, and an eviction has to satisfy both at once, which combined leaves no actual disruption headroom for auth-cache's pods even though each PDB read individually looks perfectly reasonable.",
      explanation:
        "`platform-pdb-selector-audit-notes` spells out the overlap directly: `session-store-pdb`'s selector accidentally matches auth-cache's pods too, because both PDBs' selector labels happen to intersect on `tier: cache`. Each PDB's own status shows `disruptionsAllowed: 1` in isolation, which looks fine - the real constraint only appears once you realize a single auth-cache pod eviction has to simultaneously satisfy *both* PDBs' `minAvailable` requirements, and the combination is stricter than either alone, exactly matching the FailedEviction event on an auth-cache pod despite session-store not obviously being involved at all.",
    },
    {
      id: "node-itself-has-issue",
      label: "The node undergoing the drain has an unrelated issue preventing eviction.",
      explanation:
        "The FailedEviction event specifically cites a disruption budget violation, the standard, well-defined error for exactly this PDB mechanism - not a node-health or connectivity issue, and both services are confirmed fully healthy, which is consistent with a PDB-driven block rather than any node-side problem.",
    },
    {
      id: "both-pdbs-individually-too-strict",
      label: "Both PDBs individually have `minAvailable` set too high for their own replica counts.",
      explanation:
        "Each PDB's own status shows `disruptionsAllowed: 1` when considered on its own - neither one alone is actually blocking anything, which is exactly why this looked confusing at first. The block only emerges from the *combination* of both PDBs applying to the same pod due to a selector overlap, not from either being individually miscalibrated.",
    },
    {
      id: "pdb-status-stale-not-recalculated",
      label: "The PDBs' `disruptionsAllowed` status is stale and hasn't been recalculated recently.",
      explanation:
        "There's no indication either PDB's status is out of date - both show current, internally consistent numbers (`currentHealthy: 2`, `desiredHealthy: 1`, `disruptionsAllowed: 1`) that accurately reflect their own selectors. The actual issue is that one selector matches pods it wasn't intended to, not that any status value is stale.",
    },
  ],
  correctOptionId: "session-store-pdb-selector-also-matches-auth-cache",
  resolution: `\`platform-pdb-selector-audit-notes\` uncovers the actual overlap:
\`session-store-pdb\`'s selector is \`tier: cache\` rather than the intended
\`app: session-store\` - very likely a copy-paste error from when it was
created using another PDB's manifest as a starting template. Because
auth-cache's pods also happen to carry a \`tier: cache\` label (added
separately, months ago, purely for an unrelated shared dashboard
grouping), they now fall under *two* PodDisruptionBudgets at once: their
own correctly-scoped \`auth-cache-pdb\`, and the mis-scoped
\`session-store-pdb\`. Each PDB's status looks completely reasonable in
isolation (\`disruptionsAllowed: 1\`), which is exactly why checking either
one individually didn't reveal the problem - an eviction of an
auth-cache pod has to satisfy *both* PDBs' \`minAvailable\` requirements
simultaneously, and the combined constraint leaves no actual room, even
though neither PDB alone would.

The fix is correcting the mis-scoped selector to match its intended
target only:

\`\`\`yaml
spec:
  minAvailable: 50%
  selector:
    matchLabels:
      app: session-store   # was: tier: cache
\`\`\`

Once corrected, session-store-pdb no longer accidentally covers
auth-cache's pods, and the drain can proceed against each service
independently as intended. It's worth auditing every other PDB in this
namespace (and generally, cluster-wide) for the same class of mistake -
using a broad, shared label like `tier: cache` in a PDB selector, rather
than something guaranteed unique to one Deployment, is exactly how two
otherwise-unrelated services end up silently entangled in each other's
disruption budgets.`,
};
