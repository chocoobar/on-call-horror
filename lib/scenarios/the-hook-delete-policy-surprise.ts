import type { Scenario } from "./types";

export const theHookDeletePolicySurprise: Scenario = {
  id: "the-hook-delete-policy-surprise",
  title: "The Hook Delete Policy Surprise",
  subtitle: "the migration logs everyone needs for the audit are just gone",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "sync-hooks", "hook-delete-policy"],
  briefing: `Compliance asked for the logs from "ledger-service"'s last database
migration, which ran as a PreSync hook Job during this week's deploy. The
Job completed successfully according to the deploy history - but
"kubectl get pods -n ledger" shows no trace of it at all, and the logs are
unrecoverable.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-hook-delete-policy-surprise", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/ledger-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "ledger" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "4d5e6f7" }, health: { status: "Healthy" } },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "migration-job-manifest-notes", namespace: "ledger" },
        spec: {
          data: {
            "migrate-job.yaml.excerpt":
              "apiVersion: batch/v1\nkind: Job\nmetadata:\n  name: ledger-migrate\n  annotations:\n    argocd.argoproj.io/hook: PreSync\n    argocd.argoproj.io/hook-delete-policy: HookSucceeded\n",
            "notes.md":
              "`hook-delete-policy: HookSucceeded` tells ArgoCD to delete this hook\nresource immediately once it completes successfully - by design, this\nis meant to keep the namespace tidy between deploys so completed\nmigration Jobs don't pile up forever. It does not preserve logs or\nresults anywhere first; the Job (and its Pods, and their logs) are\nsimply deleted the moment it succeeds. The deploy history / ArgoCD sync\noperation log records only that the hook ran and succeeded, not its\noutput.",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`argocd app history the-hook-delete-policy-surprise` confirms the migration hook ran and succeeded - but check whether the Job/Pod objects it created still exist anywhere.",
    "`kubectl get configmap migration-job-manifest-notes -n ledger -o yaml` and look closely at the hook Job's annotations, specifically `hook-delete-policy`.",
    "ArgoCD's hook-delete-policy annotation controls whether a hook resource is deleted after it runs, and under which outcome (succeeded, failed, or before the next hook of the same type) - it isn't just cosmetic.",
  ],
  options: [
    {
      id: "hook-delete-policy-removed-job-and-logs",
      label:
        "The migration Job is annotated `hook-delete-policy: HookSucceeded`, which tells ArgoCD to delete the Job (and its Pods, and their logs) immediately after it succeeds - working exactly as configured, but with the side effect that nothing about the migration's actual output survives past the deploy that ran it.",
      explanation:
        "`migration-job-manifest-notes` shows the Job's own annotation is `hook-delete-policy: HookSucceeded` - by design, ArgoCD deletes a hook resource carrying this policy as soon as it completes successfully, specifically to avoid accumulating leftover hook Jobs between deploys. The deploy history correctly recorded that the hook ran and succeeded, but that record never captured the Job's actual log output, and the Job/Pod objects that held it were deleted per policy moments after finishing.",
    },
    {
      id: "log-retention-expired",
      label: "The cluster's log aggregation retention window expired before anyone asked for the logs.",
      explanation:
        "There's no indication a log aggregation system was even in place to capture this Job's output before it was deleted - the actual cause is that the Job and its Pod (the sole source of these particular logs) were removed by ArgoCD's own hook-delete-policy within moments of completing, not a retention window passing on stored logs elsewhere.",
    },
    {
      id: "rbac-blocks-viewing-completed-pods",
      label: "RBAC is blocking visibility into completed/terminated pods in the ledger namespace.",
      explanation:
        "This isn't a visibility/permissions problem - `kubectl get pods -n ledger` shows no trace of the Job's pod because the pod (and the Job that created it) were actually deleted by ArgoCD, per the hook's own delete policy, not merely hidden from view.",
    },
    {
      id: "presync-hook-never-ran",
      label: "The PreSync hook never actually ran during this deploy.",
      explanation:
        "`argocd app history` confirms the hook ran and succeeded as part of this deploy - the problem isn't that it didn't run, it's that its resources (and with them, its logs) were deliberately cleaned up immediately afterward by design.",
    },
  ],
  correctOptionId: "hook-delete-policy-removed-job-and-logs",
  resolution: `\`migration-job-manifest-notes\` shows the migration Job carries
\`argocd.argoproj.io/hook-delete-policy: HookSucceeded\` - which tells
ArgoCD to delete the hook resource (and, as a consequence, its Pods and
their logs) as soon as it completes successfully. This was working
exactly as configured, added to keep the namespace from accumulating a
stale migration Job after every deploy - but nobody considered that it
also silently discards the Job's output the moment it succeeds, with
nothing else capturing it first.

There's no getting these specific logs back - they're genuinely gone.
Going forward, the fix is changing what happens to a successful migration
hook's output before it's cleaned up. Two reasonable options: switch the
delete policy so successful hooks are only cleaned up right before the
*next* hook of the same type runs, giving a window to grab logs after
each deploy,

\`\`\`yaml
metadata:
  annotations:
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
\`\`\`

or, better for anything compliance cares about, have the migration Job
itself ship its output somewhere durable (a log aggregator, or writing a
summary to a ConfigMap/artifact store) before it exits, so the
hook-delete-policy can stay tight without losing anything that matters.`,
};
