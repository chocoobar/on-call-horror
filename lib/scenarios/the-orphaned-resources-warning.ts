import type { Scenario } from "./types";

export const theOrphanedResourcesWarning: Scenario = {
  id: "the-orphaned-resources-warning",
  title: "The Orphaned Resources Warning",
  subtitle: "the UI keeps flagging a Service that everyone agrees belongs to admin-console",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "orphaned-resources", "appproject"],
  briefing: `"admin-console"'s Application keeps showing an "orphaned resources"
warning for its own metrics-exporter Service - a resource everyone agrees
is legitimately part of admin-console, sitting in admin-console's own
namespace, created by admin-console's own team. Nobody understands why
ArgoCD considers it "orphaned" when it's clearly in active use.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-orphaned-resources-warning", namespace: "argocd" },
        spec: {
          project: "admin-console-project",
          source: { repoURL: "https://github.com/example/admin-console.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "admin-console" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
          conditions: [
            { type: "OrphanedResourceWarning", message: "Service admin-console/admin-console-metrics-exporter is not managed by any Application, consider adding it to source control or removing it" },
          ],
        },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "admin-console-metrics-exporter", namespace: "admin-console" },
        spec: { selector: { app: "admin-console" } },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "metrics-exporter-history-notes", namespace: "admin-console" },
        spec: {
          data: {
            "notes.md":
              "`admin-console-metrics-exporter` was created manually via kubectl, 3\nmonths ago, by the admin-console team as a quick way to expose\nPrometheus scrape metrics - it was intentionally never added to the\nGitOps repo, on the theory that 'it's just a metrics sidecar Service,\nnot really part of the deployable app.' ArgoCD's orphaned-resources\nfeature (enabled on this AppProject) flags exactly this pattern: any\nresource sitting in an Application's destination namespace that isn't\ndeclared by *any* Application ArgoCD knows about, regardless of who\ncreated it or how legitimate its purpose is - the warning is accurate,\nnot a false positive, it's just surfacing a resource that was\ndeliberately kept out of GitOps.",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get service admin-console-metrics-exporter -n admin-console -o yaml` - does it have an ArgoCD tracking annotation/label at all?",
    "`kubectl get configmap metrics-exporter-history-notes -n admin-console -o yaml` for how this Service actually came to exist.",
    "ArgoCD's orphaned-resources warning isn't about a resource being unused or abandoned - it's about a resource sitting in a managed namespace that no Application actually declares in git.",
  ],
  options: [
    {
      id: "manually-created-never-in-gitops",
      label:
        "The Service was created manually via kubectl three months ago and was deliberately never added to the GitOps repo, on the assumption it didn't need to be - ArgoCD's orphaned-resources check is correctly flagging exactly this: a resource sitting in a managed namespace that no Application actually declares, regardless of how legitimate or actively used it is.",
      explanation:
        "`metrics-exporter-history-notes` confirms the Service was intentionally created outside GitOps and never added to admin-console's manifests. The orphaned-resources warning isn't a false positive or a bug - by design, it flags any resource in a managed namespace that no known Application declares in git, which this Service genuinely is, despite being legitimate and actively used.",
    },
    {
      id: "tracking-label-wrong-orphan",
      label: "The Service has the wrong ArgoCD tracking label/annotation value, causing it to appear unowned.",
      explanation:
        "The Service has no ArgoCD tracking annotation or label at all - it was never applied through ArgoCD in the first place, so there's no mismatched value to correct. The gap isn't a wrong tracking value, it's the complete absence of a git declaration for this resource anywhere.",
    },
    {
      id: "appproject-orphan-check-misconfigured",
      label: "The AppProject's orphaned-resources feature is misconfigured and shouldn't be enabled at all.",
      explanation:
        "The orphaned-resources feature is working exactly as designed here - correctly identifying a real gap between what's declared in git and what's running in the namespace. Disabling the feature would just hide a legitimate signal rather than fix the underlying gap it's pointing at.",
    },
    {
      id: "two-applications-namespace-conflict-orphan",
      label: "A second Application also targets the admin-console namespace and should own this Service.",
      explanation:
        "There's no second Application involved here - `admin-console-metrics-exporter` isn't declared by any Application at all, not competed over by two. The notes are explicit that it was created manually and kept out of GitOps entirely, by design (if arguably a mistaken design choice).",
    },
  ],
  correctOptionId: "manually-created-never-in-gitops",
  resolution: `\`metrics-exporter-history-notes\` confirms the Service was created manually
via kubectl three months ago, deliberately kept out of the GitOps repo on
the reasoning that "it's just a metrics sidecar, not really part of the
deployable app." ArgoCD's orphaned-resources check, enabled on this
AppProject, is working exactly as designed: it flags any resource sitting
in an Application's managed namespace that no Application actually
declares in git - which this Service genuinely is, regardless of how
legitimate or actively-used it happens to be. The warning isn't wrong;
it's surfacing a real gap between what's declared and what's running.

The fix is bringing the Service into GitOps, matching how everything else
in this namespace is managed:

\`\`\`yaml
# manifests/metrics-exporter-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: admin-console-metrics-exporter
  namespace: admin-console
spec:
  selector:
    app: admin-console
  ports:
    - port: 9090
      name: metrics
\`\`\`

Commit it, matching the live Service's spec exactly so the next sync is a
no-op rather than an unexpected change. Once it's declared in git and
tracked by the Application, the orphaned-resources warning clears - and
the Service gets the same review-before-change discipline as everything
else the team deploys, instead of being a manually-managed exception
nobody remembers exists.`,
};
