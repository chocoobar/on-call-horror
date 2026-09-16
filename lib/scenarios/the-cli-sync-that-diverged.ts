import type { Scenario } from "./types";

export const theCliSyncThatDiverged: Scenario = {
  id: "the-cli-sync-that-diverged",
  title: "The CLI Sync That Diverged",
  subtitle: "the UI and the CLI disagree about whether onboarding-service is even automated",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "sync-policy", "cli"],
  briefing: `An engineer ran "argocd app set onboarding-service --sync-policy none"
last week to pause automation during a risky migration, fully intending
to turn it back on afterward. The migration finished days ago - but
nobody remembers to re-enable automated sync, and three merged commits
since then have just been sitting there, OutOfSync, with nobody noticing
because the Application still looks otherwise fine in every dashboard.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-cli-sync-that-diverged", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/onboarding-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "onboarding" },
        },
        status: { sync: { status: "OutOfSync", revision: "b3c4d5e" }, health: { status: "Healthy" } },
        age: "6d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sync-policy-change-notes", namespace: "onboarding" },
        spec: {
          data: {
            "notes.md":
              "`argocd app set --sync-policy none` (or the UI equivalent, unchecking\n'Auto-Sync') removes the entire `spec.syncPolicy.automated` block from\nthe Application - it doesn't set a flag to 'paused', it deletes the\nblock outright. Re-enabling it later requires deliberately adding the\nblock back (`argocd app set --sync-policy automated` or the UI toggle) -\nit does not restore itself after any kind of timeout or on its own once\nwhatever prompted disabling it is resolved. Three commits have merged to\nmain in the six days since, none of them applied.",
          },
        },
        age: "6d",
      },
    ],
  },
  hints: [
    "`kubectl get application the-cli-sync-that-diverged -n argocd -o yaml` - is `spec.syncPolicy.automated` present at all?",
    "`argocd app set --sync-policy none` is a one-way toggle - it doesn't come back on its own after any amount of time, or once whatever prompted it is resolved.",
    "`kubectl get configmap sync-policy-change-notes -n onboarding -o yaml` for exactly what happened and when.",
  ],
  options: [
    {
      id: "sync-policy-none-never-re-enabled",
      label:
        "An engineer disabled automated sync via the CLI to safely pause deploys during a risky migration, which removed spec.syncPolicy.automated entirely - the migration finished days ago, but nobody remembered to explicitly turn automated sync back on, so three merged commits since then have simply sat OutOfSync with no automatic correction and no alert calling attention to it.",
      explanation:
        "`spec.syncPolicy` has no `automated` block at all on this Application - confirming automated sync was explicitly disabled. `sync-policy-change-notes` traces it to a deliberate, temporary CLI change during a migration that was never reverted afterward. Since disabling automated sync is a one-way toggle with no self-restoring timeout, the Application has simply sat OutOfSync since, correctly reflecting three un-synced commits, with nothing wrong other than automation being off.",
    },
    {
      id: "appproject-blocks-automated-cli",
      label: "The AppProject was updated to block automated sync for this Application.",
      explanation:
        "AppProjects don't have a project-wide mechanism to disable automated sync on a per-Application basis - automated sync is purely a property of the Application's own `spec.syncPolicy`, and it's genuinely absent here, not blocked by a project-level policy.",
    },
    {
      id: "repo-webhook-broken-cli-diverged",
      label: "The GitHub webhook for this repo stopped delivering events.",
      explanation:
        "The Application correctly shows OutOfSync against the new revision - meaning ArgoCD does know about the new commits, whether via webhook or its normal polling. The gap is that nothing is configured to act on that known drift automatically, since automated sync itself was turned off.",
    },
    {
      id: "migration-left-app-broken-cli",
      label: "The migration itself left the Application in a broken state that's blocking sync.",
      explanation:
        "The Application reports Healthy, and there's no error condition or failed operation state anywhere - it's cleanly OutOfSync simply because nothing has attempted to sync it, not because something is broken or blocking a sync attempt.",
    },
  ],
  correctOptionId: "sync-policy-none-never-re-enabled",
  resolution: `\`spec.syncPolicy\` on this Application has no \`automated\` block at all.
\`sync-policy-change-notes\` traces this to a deliberate CLI change,
\`argocd app set onboarding-service --sync-policy none\`, made six days ago
to safely pause deploys during a risky migration - a reasonable, careful
thing to do at the time. The catch: disabling automated sync this way is
a one-way toggle. It doesn't come back on its own after the migration
finishes, on a timer, or via any other automatic mechanism - someone has
to deliberately re-enable it. Nobody did, so three merged commits since
have simply sat un-synced, with the Application otherwise looking
perfectly normal (Healthy, no errors) in every dashboard that doesn't
specifically surface sync policy state.

Fix by re-enabling automated sync:

\`\`\`
argocd app set the-cli-sync-that-diverged --sync-policy automated --auto-prune --self-heal
\`\`\`

or directly in the Application's spec:

\`\`\`yaml
spec:
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
\`\`\`

Once re-enabled, the three pending commits sync immediately. Worth a
process note for the team: a temporary "pause automation for a
migration" step needs an equally explicit, tracked "re-enable it
afterward" step in the same runbook - otherwise it's exactly this kind
of change that's easy to make deliberately and just as easy to forget to
undo.`,
};
