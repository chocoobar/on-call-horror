import type { Scenario } from "./types";

export const theHealthCheckThatSaidHealthy: Scenario = {
  id: "the-health-check-that-said-healthy",
  title: "The Health Check That Said Healthy",
  subtitle: "a Job that failed outright is still showing green across the board",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "health-check", "jobs"],
  briefing: `"data-export-nightly" runs a batch export Job as its main workload every
night, deployed and managed entirely through ArgoCD. Last night's export
Job failed outright (the container exited non-zero, no output file was
produced) - but the Application has shown Healthy the entire time, and
nobody caught the failure until a downstream report was missing this
morning.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-health-check-that-said-healthy", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/data-export-nightly.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "exports" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "c1d2e3f" }, health: { status: "Healthy" } },
        age: "12h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "data-export-nightly", namespace: "exports" },
        spec: { backoffLimit: 0 },
        status: { active: 0, succeeded: 0, failed: 1 },
        events: [
          { type: "Warning", reason: "BackoffLimitExceeded", age: "8h", message: "Job has reached the specified backoff limit" },
        ],
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-cm", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "This cluster does not have a `resource.customizations.health.batch_Job`\nentry configured in argocd-cm - no custom health check for Jobs at all.\nWithout one, ArgoCD's built-in default health assessment logic for a\nJob only evaluates it as Degraded once `status.failed` exceeds the\nJob's `spec.backoffLimit`... in versions/configurations where a\nbuilt-in Job health check is present at all; on this particular older\nArgoCD instance, resource kinds without an explicit built-in or custom\nLua health check simply have no health status of their own and are\ntreated as always healthy/have no negative bearing on the owning\nApplication's overall health, regardless of their actual\nstatus.failed count.",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get job data-export-nightly -n exports -o yaml` - `status.failed` and the BackoffLimitExceeded event both confirm a real, complete failure.",
    "`kubectl get configmap argocd-cm -n argocd -o yaml` - does this ArgoCD instance have a custom health check configured for Job resources (`resource.customizations.health.batch_Job`)?",
    "A resource kind with no health check logic (built-in or custom) attached in ArgoCD doesn't automatically drag the owning Application's health down when it fails - it's simply not being evaluated for health at all.",
  ],
  options: [
    {
      id: "no-health-check-for-job-kind",
      label:
        "This ArgoCD instance has no custom health check configured for the Job resource kind, and the version in use doesn't have a meaningful built-in one either - so a Job's own failure status never factors into the owning Application's overall health at all, no matter how clearly the Job itself failed (BackoffLimitExceeded and status.failed: 1 included).",
      explanation:
        "The Job's own status and events are unambiguous: `status.failed: 1` and a `BackoffLimitExceeded` event confirm a real, complete, terminal failure. But `argocd-cm`'s notes confirm there's no `resource.customizations.health.batch_Job` entry, and this instance's built-in handling doesn't meaningfully evaluate Job health either - so the Application's overall health calculation simply never accounts for this Job's failure, reporting Healthy regardless of what actually happened inside it.",
    },
    {
      id: "job-selfheal-should-retry",
      label: "selfHeal should have automatically retried the failed Job.",
      explanation:
        "selfHeal reconciles live state against what's declared in git - it has no mechanism to detect or react to a Job's own internal success/failure outcome; that's specifically what a health check is for, and this cluster doesn't have one configured for Jobs. selfHeal wouldn't retry a Job regardless of its health-check configuration.",
    },
    {
      id: "backofflimit-set-wrong",
      label: "backoffLimit: 0 is misconfigured and should be higher to allow retries.",
      explanation:
        "backoffLimit governs how many times Kubernetes itself retries the Job's pod on failure before giving up - that's a legitimate, separate design choice (0 meaning 'fail fast, no automatic retries', reasonable for some export jobs) and isn't what's causing the Application to misreport health. Even with retries, an eventual failure would still not be reflected without a health check for the kind.",
    },
    {
      id: "prune-removed-job-status",
      label: "Pruning removed the Job's status before ArgoCD could evaluate it.",
      explanation:
        "The Job object and its status are both still present and readable (status.failed: 1, the BackoffLimitExceeded event) - nothing has been pruned. The Application's health status is simply not being computed from this Job's status at all, due to the missing health check configuration.",
    },
  ],
  correctOptionId: "no-health-check-for-job-kind",
  resolution: `The Job's own status leaves no ambiguity: \`status.failed: 1\` and a
\`BackoffLimitExceeded\` event, a clean, terminal failure. But
\`argocd-cm\`'s notes confirm this ArgoCD instance has no
\`resource.customizations.health.batch_Job\` entry configured, and its
built-in handling for Jobs doesn't meaningfully factor failure into
Application health either. Without a health check attached to the Job
kind, ArgoCD's health aggregation for the Application simply never looks
at this resource's outcome at all - "Healthy" reflects an absence of
negative signal, not a genuine assessment that everything actually
worked.

Fix by adding an explicit Lua health check for Jobs to argocd-cm:

\`\`\`yaml
resource.customizations.health.batch_Job: |
  hs = {}
  if obj.status ~= nil then
    if obj.status.succeeded ~= nil and obj.status.succeeded > 0 then
      hs.status = "Healthy"
      hs.message = "Job succeeded"
      return hs
    end
    if obj.status.failed ~= nil and obj.status.failed > 0 then
      hs.status = "Degraded"
      hs.message = "Job failed"
      return hs
    end
  end
  hs.status = "Progressing"
  hs.message = "Job running"
  return hs
\`\`\`

Once this is in place, a failed Job correctly drags its owning
Application to Degraded, and (combined with the notification setup from
elsewhere in the org, if wired to on-health-degraded) actually pages
someone the next time an export fails, instead of relying on a missing
downstream report to notice hours later.`,
};
