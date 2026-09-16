import type { Scenario } from "../types";

export const movingTargetRevisionTypo: Scenario = {
  id: "moving-target-revision-typo",
  title: "Moving Target Revision Typo",
  subtitle: "notification-service has been stuck on last month's code for weeks",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "targetrevision", "gitops"],
  briefing: `Someone renamed "notification-service"'s default branch from "master" to
"main" a few weeks ago as part of a repo cleanup. Ever since, every commit
merged to main has simply never shown up in the cluster - the Application
reports Synced the whole time, which is what's throwing everyone off.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "moving-target-revision-typo", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/notification-service.git",
            targetRevision: "master",
            path: "manifests",
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "notifications" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "aa11bb22cc33" },
          health: { status: "Healthy" },
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "repo-branch-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "Repo cleanup 3 weeks ago renamed the default branch from `master` to\n`main` and deleted `master` outright - GitHub redirects browser traffic\nfor the deleted branch, but a git client asking for `master` by name\ngets a 'branch not found' style resolution failure, not a redirect. The\nApplication's `targetRevision` is still pinned to the literal string\n`master`.\n",
            "recent-commits.txt": "17 commits merged to main since the rename, none deployed.",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get application moving-target-revision-typo -n argocd -o yaml` - check `spec.source.targetRevision` specifically.",
    "`kubectl get configmap repo-branch-notes -n argocd -o yaml` for background on the repo's recent history.",
    "Synced doesn't always mean 'synced to what you think it is' - it means synced to whatever `targetRevision` actually resolves to right now.",
  ],
  options: [
    {
      id: "targetrevision-stale-branch-name",
      label:
        "The Application's `targetRevision` is still pinned to the old branch name `master`, which no longer exists after the rename to `main` - so it's stuck resolving to whatever `master` last pointed at before deletion, reporting Synced against that dead reference the whole time.",
      explanation:
        "`repo-branch-notes` confirms the branch rename and deletion 3 weeks ago, matching exactly when deployments stopped reflecting new commits. `spec.source.targetRevision` is literally the string `master` - ArgoCD is faithfully synced to that revision, it's just that the revision itself stopped being the team's active branch.",
    },
    {
      id: "webhook-broken-typo",
      label: "The GitHub webhook to ArgoCD is broken, so it isn't picking up new commits.",
      explanation:
        "Even without a webhook, ArgoCD's default reconciliation loop polls the repo periodically - and either way it would still be polling the same (now-nonexistent) `master` revision. The actual problem is which revision is being asked for, not whether ArgoCD hears about changes to it.",
    },
    {
      id: "repo-credentials-expired-typo",
      label: "ArgoCD's git credentials for this repo expired.",
      explanation:
        "The Application is successfully reporting Synced with a real revision hash - if credentials had failed, ArgoCD would show a comparison error instead of a clean Synced/Healthy status.",
    },
    {
      id: "automated-sync-disabled-typo",
      label: "Automated sync was turned off on this Application.",
      explanation:
        "`spec.syncPolicy.automated` is present with `prune: true, selfHeal: true` - automated sync is on. The Application really is syncing automatically, just to a branch name that no longer means what everyone assumes it means.",
    },
  ],
  correctOptionId: "targetrevision-stale-branch-name",
  resolution: `\`repo-branch-notes\` lays out the timeline: the default branch was renamed
from \`master\` to \`main\` and the old \`master\` branch was deleted, three
weeks ago - exactly when new commits stopped showing up in the cluster.
The Application's \`spec.source.targetRevision\` is still the literal
string \`master\`. ArgoCD isn't broken; it's accurately synced to whatever
\`master\` resolves to, which after the rename is nothing new at all -
depending on the git provider this either fails outright or silently
pins to the last commit that existed on that ref before it vanished,
which is exactly why "Synced" looked reassuring while being 17 commits
behind.

Fix the pinned revision to track the actual active branch:

\`\`\`yaml
spec:
  source:
    targetRevision: main
\`\`\`

After that, ArgoCD's next comparison picks up the real HEAD of \`main\` and
syncs the 17 missing commits in one shot. Worth a quick audit of any other
Application still referencing \`master\` from before the rename.`,
};
