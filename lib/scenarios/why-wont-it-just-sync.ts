import type { Scenario } from "./types";

export const whyWontItJustSync: Scenario = {
  id: "why-wont-it-just-sync",
  title: "Why Won't It Just Sync",
  subtitle: "billing-exporter never auto-deploys, and everyone's tired of syncing it by hand",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 10,
  tags: ["argocd", "sync-policy", "automation"],
  briefing: `"billing-exporter" has been deployed exclusively via manual "argocd app
sync" clicks for months. Every other Application on the team's project
auto-deploys the moment a commit lands on main. Nobody remembers setting
this one up differently, and the on-call rotation is sick of having to
notice and manually sync it after every merge.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "why-wont-it-just-sync", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/billing-exporter.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "billing" },
        },
        status: { sync: { status: "OutOfSync", revision: "e1f2a3b" }, health: { status: "Healthy" } },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get application why-wont-it-just-sync -n argocd -o yaml` - look for a `spec.syncPolicy` field at all.",
    "Compare this Application's spec against a working, auto-syncing one on the same team.",
    "ArgoCD only auto-syncs an Application whose spec explicitly opts into it.",
  ],
  options: [
    {
      id: "no-automated-block",
      label:
        "The Application's spec has no `syncPolicy.automated` block at all, so it defaults to manual-only sync - nothing is broken, it was simply never configured for automated sync in the first place.",
      explanation:
        "`spec.syncPolicy` is entirely absent from this Application's manifest. ArgoCD's default behavior without an explicit `automated` policy is manual sync only - every commit lands in git and shows as OutOfSync, but nothing triggers a sync on its own. This isn't a bug being fixed, it's a missing opt-in.",
    },
    {
      id: "webhook-missing-sync",
      label: "The GitHub webhook for this repo was never configured, so ArgoCD doesn't know about new commits.",
      explanation:
        "The Application correctly shows OutOfSync with the new revision - it does know about the commit (via webhook or its normal polling loop). The gap is that nothing is configured to act on that knowledge automatically, not that it's unaware of new commits.",
    },
    {
      id: "appproject-blocks-auto-sync",
      label: "The AppProject disables automated sync for all Applications in it.",
      explanation:
        "AppProjects don't have a project-wide toggle to disable automated sync on their member Applications - automated sync is opted into (or out of) per-Application, via that Application's own `syncPolicy`.",
    },
    {
      id: "rbac-blocks-controller-sync",
      label: "ArgoCD's own controller ServiceAccount lacks RBAC to sync automatically.",
      explanation:
        "Manual syncs from the same ArgoCD instance work fine, using the same controller identity - there's no separate, more restricted identity used specifically for automated sync versus manual sync, so an RBAC gap wouldn't distinguish between the two.",
    },
  ],
  correctOptionId: "no-automated-block",
  resolution: `\`spec.syncPolicy\` is missing entirely from this Application - there's no
\`automated\` block at all. Without it, ArgoCD defaults to manual-only
sync: it will happily detect and report drift (OutOfSync) against new
commits, but nothing tells it to act on that drift by itself. Every other
Application on the team auto-deploys because each of them has an explicit
\`syncPolicy.automated\` block; this one simply never got one.

Fix:

\`\`\`yaml
spec:
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
\`\`\`

Once that's added and applied (via a sync, ironically the last manual one
needed), every future commit to main triggers an automatic sync just like
its siblings.`,
};
