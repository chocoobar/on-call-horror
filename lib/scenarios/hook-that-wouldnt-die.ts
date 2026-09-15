import type { Scenario } from "./types";

export const hookThatWouldntDie: Scenario = {
  id: "hook-that-wouldnt-die",
  title: "The Hook That Wouldn't Die",
  subtitle: "reports-api has been \"Progressing\" for way too long",
  difficulty: "medium",
  type: "fix",
  timeMinutes: 20,
  tags: ["argocd", "hooks", "sync"],
  briefing: `The "reports-api" Application has been stuck in "Progressing" for an
unreasonable amount of time. Nothing in the "reports" namespace ever
actually shows up - no Deployment, no web pods, nothing but a single Job.

This app runs a PreSync hook (a one-off migration Job) before its main
Deployment is allowed to sync. Hooks have to actually finish for the rest
of the sync to proceed.`,
  constraints: [
    "A sync operation is still \"in progress\" from ArgoCD's point of view - that matters for how you'd unstick it for real, even though this console is read-only.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "reports-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/reports-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "reports" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Progressing" },
          operationState: {
            phase: "Running",
            message: "waiting for healthy state of batch/Job/reports/reports-api-migrate (2m elapsed)",
          },
        },
        age: "22m",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: "reports-api-migrate",
          namespace: "reports",
          annotations: {
            "argocd.argoproj.io/hook": "PreSync",
            "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
          },
        },
        spec: { completions: 1 },
        status: { succeeded: 0, active: 1 },
        events: [
          { type: "Normal", reason: "SuccessfulCreate", age: "22m", message: "Created pod: reports-api-migrate-h8x2q" },
        ],
        age: "22m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "reports-api-migrate-h8x2q", namespace: "reports", labels: { "job-name": "reports-api-migrate" } },
        status: { phase: "Running", containerStatuses: [{ name: "migrate", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: { migrate: ["running schema migration..."] },
        age: "22m",
      },
    ],
  },
  hints: [
    "`kubectl get application reports-api -n argocd -o yaml` - look at `status.operationState`. It's still Running, and it says exactly what it's waiting on.",
    "`kubectl get jobs,pods -n reports` - one Job, no Deployment. Notice the Job has been \"active\" the entire time the app has existed.",
    "`kubectl logs reports-api-migrate-h8x2q -n reports` - the migration says it's running, and never reports finishing. A PreSync hook has to complete before the rest of the sync (including the main Deployment) is allowed to proceed.",
  ],
  options: [
    {
      id: "bad-image-deployment",
      label: "The main Deployment has an invalid image tag.",
      explanation:
        "The Deployment doesn't even exist yet - `kubectl get deployment -n reports` would come back empty. Nothing about images is at play here; the sync never got past the PreSync hook.",
    },
    {
      id: "hook-hangs",
      label: "A PreSync hook Job never completes, so ArgoCD never proceeds to sync the main Deployment.",
      explanation:
        "The Job's `status.active` is 1 and `succeeded` is 0 - it's been running the entire 22 minutes the app has existed, and its logs show the migration starting but never finishing. Because it's annotated as a PreSync hook, ArgoCD holds the rest of the sync (the Deployment) until this Job reports success.",
    },
    {
      id: "sync-timeout-low",
      label: "ArgoCD's sync timeout is configured too low, so it's aborting again and again.",
      explanation:
        "There's no evidence of repeated sync attempts or a timeout-triggered abort here - `status.operationState.phase` is `Running`, a single ongoing sync, not a series of failures. The Job is simply still going.",
    },
    {
      id: "hook-deletes-deployment",
      label: "The hook's delete policy is misconfigured and is deleting the Deployment before it can start.",
      explanation:
        "`hook-delete-policy: BeforeHookCreation` only affects when the hook resource (the Job) itself gets cleaned up on a future sync - it has no effect on the main Deployment, which hasn't even been reached yet.",
    },
  ],
  correctOptionId: "hook-hangs",
  resolution: `\`reports-api-migrate\` is a \`PreSync\` hook Job that's been \`active: 1\`,
\`succeeded: 0\` for the entire lifetime of the Application - its logs show
the migration starting and then just... never finishing. Because PreSync
hooks must complete before ArgoCD proceeds to sync the rest of the
resources, the whole Application has been stuck \`Progressing\` and the
main Deployment was never even created.

In a real cluster: fix the hook's command in the GitOps source so it
actually completes, commit, then clear the stuck operation and start a
fresh sync -

\`\`\`
argocd app terminate-op reports-api
argocd app sync reports-api
\`\`\`

Because the hook Job has \`hook-delete-policy: BeforeHookCreation\`, the new
sync replaces the old hung Job with a fresh one that completes, unblocking
the Deployment.`,
};
