import type { Scenario } from "../types";

export const theOrphanNobodyPruned: Scenario = {
  id: "the-orphan-nobody-pruned",
  title: "The Orphan Nobody Pruned",
  subtitle: "a ConfigMap that shouldn't exist is still quietly backing prod traffic",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "prune", "drift"],
  briefing: `Two weeks ago, "feature-flags-api" removed an old ConfigMap from its
GitOps manifests as part of a cleanup. The Application has shown Synced
the entire time since, with no OutOfSync warnings - but the old ConfigMap
is still sitting in the cluster, and a new engineer is confused about
which config is actually authoritative.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-orphan-nobody-pruned", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/feature-flags-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "flags" },
          syncPolicy: { automated: { prune: false, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "b7c8d9e" }, health: { status: "Healthy" } },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: "feature-flags-legacy-defaults",
          namespace: "flags",
          labels: { "app.kubernetes.io/instance": "the-orphan-nobody-pruned" },
          annotations: { "argocd.argoproj.io/tracking-id": "the-orphan-nobody-pruned:/ConfigMap:flags/feature-flags-legacy-defaults" },
        },
        spec: { data: { "flags.json": "{\"legacy_checkout_flow\": true}" } },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get application the-orphan-nobody-pruned -n argocd -o yaml` - check `spec.syncPolicy.automated` for the `prune` field specifically.",
    "Synced only means live state matches everything currently declared in git - it says nothing about resources that used to be declared and were later removed.",
    "`argocd app resources the-orphan-nobody-pruned` (or diff) would flag this ConfigMap as no longer in git, if prune were on.",
  ],
  options: [
    {
      id: "prune-disabled-orphan",
      label:
        "This Application has `prune: false`, so when the ConfigMap was removed from git two weeks ago, ArgoCD stopped managing it but never deleted it - it's a harmless-looking Synced status hiding a resource that no longer has any git declaration behind it.",
      explanation:
        "`spec.syncPolicy.automated.prune` is explicitly `false`. With pruning off, removing a resource from git only stops ArgoCD from tracking/updating it going forward - it does not delete the live object. The ConfigMap's tracking-id annotation still shows it as historically owned by this Application, confirming it's a leftover from before the manifest removal, not something else.",
    },
    {
      id: "different-app-owns-it",
      label: "A different Application actually owns and manages this ConfigMap now.",
      explanation:
        "The ConfigMap's own tracking-id annotation names this exact Application (the-orphan-nobody-pruned), not a different one - there's no evidence of a second owner here, just an old resource this Application stopped declaring in git.",
    },
    {
      id: "selfheal-recreating-it",
      label: "selfHeal is recreating the ConfigMap every time someone tries to delete it.",
      explanation:
        "selfHeal reverts drift *against what's currently in git* - since the ConfigMap isn't in git at all anymore, selfHeal has no declared state to revert it back to, so it wouldn't recreate a deleted resource that isn't declared anywhere.",
    },
    {
      id: "finalizer-blocking-deletion-orphan",
      label: "A finalizer on the ConfigMap is blocking its deletion.",
      explanation:
        "Nobody has actually attempted to delete this ConfigMap yet - it's simply still present because nothing ever asked Kubernetes to remove it. A finalizer would only matter once a delete request was issued and got stuck, which isn't what's happening here.",
    },
  ],
  correctOptionId: "prune-disabled-orphan",
  resolution: `\`spec.syncPolicy.automated.prune\` on this Application is \`false\`. Pruning
is what makes ArgoCD delete live resources that used to be declared in
git and no longer are - with it off, removing something from the GitOps
manifests only stops ArgoCD from managing/updating that resource, it
doesn't touch the live object at all. The ConfigMap's own tracking-id
annotation confirms it was historically owned by this Application, which
lines up with it being the exact thing removed from manifests two weeks
ago.

Two ways to actually clean it up: turn pruning on so this kind of leftover
gets caught automatically going forward,

\`\`\`yaml
spec:
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
\`\`\`

and delete this specific orphan by hand once (turning on prune alone
won't retroactively clean up something that's already untracked/no longer
matches a tracking-id in the current git state - a sync afterward will
pick it up as prune-eligible):

\`\`\`
kubectl delete configmap feature-flags-legacy-defaults -n flags
\`\`\`

Worth a quick audit of any other Application running with prune off for
"safety" - it also quietly accumulates exactly this kind of drift.`,
};
