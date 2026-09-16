import type { Scenario } from "../types";

export const thePruneThatWasnt: Scenario = {
  id: "the-prune-that-wasnt",
  title: "The Prune That Wasn't",
  subtitle: "traffic is still hitting a Service that was deleted from git two weeks ago",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "prune", "gitops"],
  briefing: `A security review found that "legacy-search", a Service supposedly
decommissioned two weeks ago, is still live and still receiving real
traffic. The manifest was deleted from git as part of the
decommissioning - ArgoCD shows the Application as Synced.`,
  constraints: [
    "The Application's sync has completed with no errors reported - this isn't a failed or stuck sync.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "search-platform", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/search-platform.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "search" },
          syncPolicy: { automated: { selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "9f8e7d6c5b4a" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "legacy-search", namespace: "search", labels: { app: "legacy-search" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.55.66", selector: { app: "legacy-search" }, ports: [{ port: 80 }] },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "legacy-search", namespace: "search", labels: { app: "legacy-search" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "decommission-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "legacy-search's Deployment and Service manifests were removed from\ngit two weeks ago as part of decommissioning it in favor of the new\nsearch-v2 stack. The `search-platform` Application's `syncPolicy` has\n`automated.selfHeal: true` but no `prune` field set.\n",
          },
        },
        age: "14d",
      },
    ],
  },
  hints: [
    "`kubectl get application search-platform -n argocd -o yaml` - look specifically at `spec.syncPolicy.automated`. Is `prune` mentioned at all?",
    "ArgoCD's automated sync only deletes live resources that no longer exist in git when `prune: true` is explicitly set - without it, `selfHeal` will keep resources that *are* in git in their desired state, but resources *removed* from git are simply left alone, live, forever.",
    "`kubectl get configmap decommission-notes -n search -o yaml` - when were `legacy-search`'s manifests actually removed from git, and does the Application's sync policy account for that?",
  ],
  options: [
    {
      id: "prune-not-enabled",
      label:
        "`search-platform`'s `syncPolicy.automated` has `selfHeal: true` but no `prune: true` - ArgoCD's automated sync happily keeps resources that are still in git converged, but it never deletes a live resource just because its manifest was removed from git unless pruning is explicitly enabled, so `legacy-search` has stayed live and untouched since its manifest was deleted two weeks ago.",
      explanation:
        "`decommission-notes` confirms `legacy-search`'s manifests were deleted from git two weeks ago, and the Application's `syncPolicy.automated` block has no `prune` field at all. `selfHeal` and `prune` are separate, independent settings: `selfHeal` corrects drift on resources that *are* in git, while `prune` is what actually deletes a live resource once its manifest disappears from git. Without `prune: true`, ArgoCD reports `Synced` (accurately - there's no live resource associated with git-declared-but-missing-in-cluster) while leaving `legacy-search` running indefinitely, orphaned from git but never cleaned up.",
    },
    {
      id: "wrong-target-revision",
      label: "The Application is still pointed at an old git revision that predates the deletion.",
      explanation:
        "The Application's `status.sync.revision` reflects a current commit, and `targetRevision: main` tracks the branch's latest state, not a pinned old commit - the Application is syncing against current git, which genuinely no longer contains `legacy-search`'s manifests.",
    },
    {
      id: "resource-finalizer-blocking-deletion",
      label: "A Kubernetes finalizer on the Service is blocking its deletion.",
      explanation:
        "There's no indication ArgoCD ever attempted to delete `legacy-search` at all - a finalizer would show up as a resource stuck `Terminating` after a deletion was requested, not a resource sitting in a completely normal, untouched `Running`/ready state with no deletion timestamp.",
    },
    {
      id: "namespace-not-managed",
      label: "The `search` namespace isn't actually managed by this Application.",
      explanation:
        "The Application's `spec.destination.namespace` is `search`, matching where both the current search-v2 stack and the orphaned `legacy-search` resources live - the namespace is correctly in scope, ArgoCD is just never instructed to remove things from it that fall out of git.",
    },
  ],
  correctOptionId: "prune-not-enabled",
  resolution: `\`decommission-notes\` confirms \`legacy-search\`'s manifests were deleted
from git two weeks ago, and \`search-platform\`'s \`syncPolicy.automated\`
block has \`selfHeal: true\` but no \`prune\` field. Those two settings do
genuinely different jobs: \`selfHeal\` corrects live resources back toward
whatever git currently says they should look like - it has no opinion at
all about a resource whose manifest simply isn't in git anymore. Deleting
a live resource once its manifest disappears from git is specifically
\`prune\`'s job, and it's opt-in by design (accidentally deleting live
infrastructure is a scarier default than accidentally leaving something
running). Without it, \`legacy-search\` becomes exactly what's observed: an
orphan that ArgoCD is aware doesn't correspond to anything in git, but has
no instruction to ever remove.

This also explains why the Application still reports \`Synced\` -
correctly. Sync status measures whether every resource git *does*
declare matches live state, which it does; it was never designed to flag
orphaned resources as a form of drift by itself.

The fix is enabling pruning:

\`\`\`yaml
spec:
  syncPolicy:
    automated:
      selfHeal: true
      prune: true
\`\`\`

with the usual caution that comes with it - \`prune: true\` means any future
manifest deletion from git will now actually remove the live resource on
the next automated sync, so it's worth confirming nothing else is relying
on a resource whose git manifest happens to be temporarily missing (e.g.
mid-refactor) before turning it on for a given Application.`,
};
