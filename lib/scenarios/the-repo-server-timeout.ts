import type { Scenario } from "./types";

export const theRepoServerTimeout: Scenario = {
  id: "the-repo-server-timeout",
  title: "The Repo Server Timeout",
  subtitle: "catalog-service has shown \"Unknown\" health for three hours and never syncs",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "helm", "repo-server"],
  briefing: `"catalog-service"'s Application has shown sync status "Unknown" since
this morning's change - a new Helm chart dependency was added with a
values file that generates a resource per product category. It never
progresses to Synced or shows any specific manifest error.`,
  constraints: [
    "No other Application in the cluster is affected - every other Application using the same shared ArgoCD instance is syncing normally.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "catalog-service", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/catalog-service.git",
            targetRevision: "main",
            path: "chart",
            helm: { valueFiles: ["values-prod.yaml"] },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "catalog" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message: "rpc error: code = DeadlineExceeded desc = context deadline exceeded",
            },
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "argocd-repo-server", namespace: "argocd", labels: { app: "argocd-repo-server" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "argocd-repo-server", resources: { limits: { cpu: "1", memory: "1Gi" } } }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "catalog-chart-notes", namespace: "catalog" },
        spec: {
          data: {
            "notes.md":
              "This morning's change added a `{{ range .Values.categories }}`\ntemplate loop that generates a full Deployment+Service+ConfigMap set per\nentry in `values-prod.yaml`'s `categories` list. That list grew from 12\nentries to just over 900 in this change, following a product-catalog\nrestructure - meaning this one chart now renders several thousand\nKubernetes objects on every manifest generation.\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get application catalog-service -n argocd -o yaml` - read the `status.conditions` message closely. `DeadlineExceeded` on a `context` is a timeout, not a manifest syntax error.",
    "Rendering a chart's manifests and diffing them against the live cluster is `argocd-repo-server`'s job, and it happens fresh on every comparison. What would make that take a lot longer than usual for one specific Application, without affecting any other Application sharing the same repo-server?",
    "`kubectl get configmap catalog-chart-notes -n catalog -o yaml` - how many objects does this chart actually render now, compared to before this morning's change?",
  ],
  options: [
    {
      id: "helm-template-explosion-times-out-repo-server",
      label:
        "This morning's chart change turned a 12-entry loop into a 900+-entry one, so a single manifest generation for catalog-service now renders several thousand Kubernetes objects - rendering and diffing that many objects takes long enough to exceed argocd-repo-server's comparison timeout, which shows up as an Unknown/DeadlineExceeded status rather than any specific manifest error, and only affects this one unusually large Application.",
      explanation:
        "The Application's own condition is a `DeadlineExceeded` on a `context` - a timeout, not a syntax or validation error, which rules out anything wrong with the manifests' actual content. `catalog-chart-notes` confirms the chart went from rendering roughly a dozen objects to several thousand in this morning's change. Generating and diffing that volume of manifests from a single chart takes meaningfully longer than a normal comparison; argocd-repo-server is shared across every Application, but only this one now asks it to do dramatically more work per comparison, which is exactly why every other Application keeps syncing normally while this one alone times out.",
    },
    {
      id: "values-file-syntax-error",
      label: "`values-prod.yaml` has a YAML syntax error from this morning's edit.",
      explanation:
        "A syntax error in the values file would surface as a specific parsing or template-rendering error naming the problem, not a generic `context deadline exceeded` - the manifests are apparently valid enough to attempt rendering, it's simply taking too long to finish within the comparison's time budget.",
    },
    {
      id: "git-repo-unreachable",
      label: "ArgoCD can't reach the git repository at all.",
      explanation:
        "Every other Application shares the same ArgoCD instance and repo connectivity and is syncing without issue - a repository-reachability problem would be a cluster-wide or repo-wide symptom, not isolated to one Application's manifest generation.",
    },
    {
      id: "destination-cluster-unreachable",
      label: "The destination Kubernetes cluster is unreachable from ArgoCD.",
      explanation:
        "Every other Application targets the same destination cluster and syncs normally - if the destination cluster itself were unreachable, it would affect every Application pointed at it, not just this one.",
    },
  ],
  correctOptionId: "helm-template-explosion-times-out-repo-server",
  resolution: `The Application's own condition names the mechanism directly: a
\`DeadlineExceeded\` on a \`context\` - a timeout, not a manifest or syntax
error. \`catalog-chart-notes\` explains why: this morning's change grew a
templated loop from about a dozen entries to over 900, meaning a single
manifest generation for this chart now produces several thousand
Kubernetes objects instead of a few dozen. \`argocd-repo-server\` has to
render the full chart and diff every rendered object against live cluster
state on every comparison - work that scales with object count, and at
this new scale, comfortably exceeds the time budget a comparison is
normally given. Every other Application sharing the same repo-server
keeps syncing fine because none of them suddenly asked it to do
thousands of times more work per comparison.

A few ways to actually fix it, not just paper over the timeout: split the
chart so each product category isn't a full Deployment+Service+ConfigMap
triplet if that's more than the use case needs, use Helm's
\`--set-json\`/data-driven patterns more efficiently, or - if the object
count is genuinely necessary - increase \`argocd-repo-server\`'s comparison
timeout and give it more CPU/memory to keep up:

\`\`\`yaml
# argocd-cmd-params-cm ConfigMap
data:
  reposerver.parallelism.limit: "2"
  server.repo.server.timeout.seconds: "180"   # up from the default 60s
\`\`\`

Raising the timeout is a legitimate stopgap for this specific case, but
it's worth treating "one chart now renders several thousand objects" as
the actual thing to reconsider - it's expensive for more than just
ArgoCD's comparison step (kubectl diffs, \`git diff\` review size, and
plain human reviewability all suffer at that scale too).`,
};
