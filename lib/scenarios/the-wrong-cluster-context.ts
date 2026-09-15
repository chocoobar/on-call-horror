import type { Scenario } from "./types";

export const theWrongClusterContext: Scenario = {
  id: "the-wrong-cluster-context",
  title: "The Wrong Cluster Context",
  subtitle: "staging got a production-sized deploy nobody meant to send it",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "multi-cluster", "destination"],
  briefing: `A new Application, "reporting-jobs", was supposed to be created for the
"staging" cluster. It was accidentally created pointing at the production
cluster's API server address instead, copy-pasted from a prod Application
template. Production now has an extra, unreviewed workload running that
nobody intended to put there.`,
  constraints: [
    "Don't just delete the Application outright - the underlying workload was already synced into production and needs to be cleanly removed as part of the fix, not abandoned.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-wrong-cluster-context", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/reporting-jobs.git", targetRevision: "main", path: "manifests/staging" },
          destination: { server: "https://prod-cluster.example.com:6443", namespace: "reporting-jobs" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "c2b3a4d" }, health: { status: "Healthy" } },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cluster-registry-notes", namespace: "argocd" },
        spec: {
          data: {
            "clusters.md":
              "Registered destination clusters in this ArgoCD instance:\n  https://kubernetes.default.svc          (in-cluster, used for staging apps)\n  https://prod-cluster.example.com:6443    (production)\n\nreporting-jobs' Application was created by copy-pasting an existing\nprod Application as a starting template, and the destination.server\nfield was never changed from the copied value - meanwhile\nspec.source.path was correctly updated to manifests/staging, so the\nApplication is deploying staging-intended manifests onto the production\ncluster.",
          },
        },
        age: "25m",
      },
    ],
  },
  hints: [
    "`kubectl get application the-wrong-cluster-context -n argocd -o yaml` - check `spec.destination.server` against the list of registered clusters.",
    "`kubectl get configmap cluster-registry-notes -n argocd -o yaml` for the registered destinations and what actually happened when this Application was created.",
    "Notice that `spec.source.path` correctly says 'staging' while `spec.destination.server` says something else entirely - the two were edited independently and only one got updated.",
  ],
  options: [
    {
      id: "destination-server-copied-from-prod-template",
      label:
        "The Application was created from a copied prod template, and while its source path was correctly updated to point at staging manifests, `spec.destination.server` was never changed off the copied production cluster address - so staging-intended workloads are now live in production.",
      explanation:
        "`cluster-registry-notes` confirms exactly this: the Application's source path was correctly updated to `manifests/staging`, but `spec.destination.server` still points at `prod-cluster.example.com`, the copied value from the prod template it was based on. Two independent fields, only one got fixed during creation.",
    },
    {
      id: "argocd-cluster-registration-bug",
      label: "ArgoCD's cluster registration incorrectly maps the staging cluster name to production's API server.",
      explanation:
        "`cluster-registry-notes` shows both clusters are registered separately and correctly under their own distinct addresses - there's no cross-registration bug. The Application simply has the wrong one of the two correctly-registered values hardcoded into its own spec.",
    },
    {
      id: "appproject-allows-both-clusters",
      label: "The AppProject's destinations list is too permissive and should restrict which clusters are allowed.",
      explanation:
        "Even if the AppProject did restrict destinations more tightly (a reasonable defense-in-depth improvement), that's not what actually caused this specific incident - the immediate, direct cause is the copied `destination.server` value on the Application itself, which is what needs fixing first.",
    },
    {
      id: "repo-path-wrong-not-destination",
      label: "spec.source.path is actually the field that's wrong, not the destination.",
      explanation:
        "`spec.source.path` correctly reads `manifests/staging`, which is exactly what was intended - the manifests being deployed are the right ones. The mistake is entirely about which cluster they're being sent to, not which manifests are selected.",
    },
  ],
  correctOptionId: "destination-server-copied-from-prod-template",
  resolution: `\`cluster-registry-notes\` confirms both clusters are registered correctly
and separately - the mistake is entirely in this one Application's own
spec. \`spec.source.path\` was correctly updated to \`manifests/staging\`
when the Application was created from a copied prod template, but
\`spec.destination.server\` was left as the copied production cluster
address. Two fields, edited independently, and only one got the
attention it needed.

Fix in two parts. First, correct the destination so it stops targeting
prod:

\`\`\`yaml
spec:
  destination:
    server: https://kubernetes.default.svc   # the in-cluster / staging destination
    namespace: reporting-jobs
\`\`\`

Second, clean up what already landed in production - since prune is on,
simply correcting the destination and syncing would leave the old,
wrongly-placed resources behind on the prod cluster as now-unmanaged
orphans. Delete the Application with cascade against its *original*
(production) destination first to remove what's actually running there,
then re-create/re-sync it against the corrected staging destination:

\`\`\`
argocd app delete the-wrong-cluster-context --cascade
\`\`\`

then re-apply the Application manifest with the corrected
\`destination.server\`. Worth double-checking any other Application
created the same way (copied from an existing template) for the same
half-updated-field mistake.`,
};
