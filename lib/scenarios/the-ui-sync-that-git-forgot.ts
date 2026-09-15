import type { Scenario } from "./types";

export const theUiSyncThatGitForgot: Scenario = {
  id: "the-ui-sync-that-git-forgot",
  title: "The UI Sync That Git Forgot",
  subtitle: "someone clicked 'Sync with prune' from the wrong branch dropdown",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "cli", "sync-policy"],
  briefing: `"promo-banner-service" is meant to always track "main". This afternoon,
someone used the ArgoCD UI's manual sync dialog and, in the revision
field, typed in a personal feature branch instead of leaving it on HEAD -
without changing the Application's actual spec.targetRevision at all. The
Application now shows a revision nobody recognizes from a normal git log
of main.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-ui-sync-that-git-forgot", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/promo-banner-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "promo" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "f00dcafe1234" },
          health: { status: "Healthy" },
          operationState: {
            phase: "Succeeded",
            syncResult: { revision: "f00dcafe1234", source: { targetRevision: "wip/carol/new-banner-copy" } },
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "`kubectl get application the-ui-sync-that-git-forgot -n argocd -o yaml` - compare `spec.source.targetRevision` against `status.operationState.syncResult.source.targetRevision`.",
    "A one-off manual sync in the UI or CLI can target a specific revision without touching the Application's own declared spec at all.",
    "Because this Application has automated sync enabled, its next scheduled reconciliation will re-sync against whatever spec.targetRevision actually says.",
  ],
  options: [
    {
      id: "manual-sync-overrode-revision-once",
      label:
        "A one-off manual sync was pointed at a personal feature branch via the sync dialog's revision override, which deployed that branch's content without ever changing `spec.targetRevision` - the Application's declared source is still correctly `main`, so its next automated sync will simply revert back to main's actual HEAD.",
      explanation:
        "`status.operationState.syncResult.source.targetRevision` shows the actual sync that ran used `wip/carol/new-banner-copy` - a one-time override - while `spec.source.targetRevision` on the Application itself is still plainly `main`. A manual sync's revision override is a single operation, not a spec change; it doesn't persist.",
    },
    {
      id: "targetrevision-changed-in-git",
      label: "Someone committed a change to targetRevision in the Application's own manifest in git.",
      explanation:
        "`spec.source.targetRevision` on the live Application object is `main` - if a git change had actually updated the tracked value, that field itself would show the feature branch, not just the most recent sync operation's result.",
    },
    {
      id: "wrong-repo-connected",
      label: "ArgoCD is connected to a fork of the repo instead of the canonical one.",
      explanation:
        "`spec.source.repoURL` points at the correct canonical repo - the discrepancy is entirely about which revision within that same repo got synced, via a one-off manual override, not about which repository is configured.",
    },
    {
      id: "selfheal-syncing-feature-branch",
      label: "selfHeal is repeatedly re-syncing the feature branch on its own.",
      explanation:
        "selfHeal reconciles live state against `spec.source.targetRevision`, which is still `main` - it has no reason to keep syncing a feature branch that was only ever used as a one-time manual override and isn't declared anywhere in the Application's own spec.",
    },
  ],
  correctOptionId: "manual-sync-overrode-revision-once",
  resolution: `\`status.operationState.syncResult.source.targetRevision\` shows the most
recent sync operation actually ran against \`wip/carol/new-banner-copy\` -
a personal feature branch, entered as a one-off override in the manual
sync dialog's revision field. Critically, \`spec.source.targetRevision\` on
the Application itself was never touched and still correctly reads
\`main\`. A manual sync's revision override applies to that single
operation only; it isn't a persistent change to what the Application
tracks going forward.

Because this Application has \`syncPolicy.automated\` enabled, the fix is
almost self-correcting - the next scheduled automated sync will compare
live state against \`spec.source.targetRevision\` (\`main\`) again and
revert to main's actual HEAD on its own. To force it immediately rather
than wait:

\`\`\`
argocd app sync the-ui-sync-that-git-forgot --revision main
\`\`\`

Worth a reminder for the team: a manual sync's revision field is meant
for "preview/rollback to a specific SHA one time," not for pointing an
Application at a different branch long-term - that always belongs in the
Application's own \`spec.source.targetRevision\` in git.`,
};
