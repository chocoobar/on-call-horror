import type { Scenario } from "./types";

export const theClusterResourceWhitelistGap: Scenario = {
  id: "the-cluster-resource-whitelist-gap",
  title: "The ClusterResourceWhitelist Gap",
  subtitle: "rate-limiter's Application syncs the Deployment fine but ignores its own CRD",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "appproject", "clusterresourcewhitelist"],
  briefing: `"rate-limiter" ships both a Deployment and a cluster-scoped
RateLimitPolicy custom resource. After this morning's sync, the
Deployment is running fine, but the RateLimitPolicy object is nowhere to
be found in the cluster - and without it, the rate limiter is running with
no policy configured at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-cluster-resource-whitelist-gap", namespace: "argocd" },
        spec: {
          project: "rate-limiter-project",
          source: { repoURL: "https://github.com/example/rate-limiter.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "rate-limiter" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          resources: [
            { kind: "Deployment", name: "rate-limiter", status: "Synced" },
            { kind: "RateLimitPolicy", name: "rate-limiter-default", status: "OutOfSync", message: "resource is excluded from sync because it is not permitted by the AppProject" },
          ],
        },
        age: "40m",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AppProject",
        metadata: { name: "rate-limiter-project", namespace: "argocd" },
        spec: {
          description: "Rate limiter team project",
          sourceRepos: ["*"],
          destinations: [{ namespace: "rate-limiter", server: "https://kubernetes.default.svc" }],
          clusterResourceWhitelist: [],
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-cluster-resource-whitelist-gap -n argocd` - look at the per-resource status list, not just the overall sync status.",
    "`kubectl get appproject rate-limiter-project -n argocd -o yaml` and check `spec.clusterResourceWhitelist` specifically - note that RateLimitPolicy is a cluster-scoped CRD, not a namespaced one.",
    "By default, an AppProject's clusterResourceWhitelist is empty, meaning no cluster-scoped resources are permitted at all - namespaced resources like Deployments aren't affected by this list.",
  ],
  options: [
    {
      id: "clusterresourcewhitelist-empty-blocks-crd",
      label:
        "RateLimitPolicy is a cluster-scoped custom resource, and the AppProject's `clusterResourceWhitelist` is empty - which permits zero cluster-scoped resource kinds by default, so ArgoCD silently excludes it from sync while the namespaced Deployment (unaffected by this list) applies normally.",
      explanation:
        "The Application's own per-resource status names it directly: the RateLimitPolicy is excluded because it's 'not permitted by the AppProject'. `clusterResourceWhitelist` is empty on this AppProject - by ArgoCD's design, an empty whitelist means no cluster-scoped kinds are allowed, regardless of namespacedResourceBlacklist settings. The Deployment is namespaced and unaffected by this list, which is exactly why it synced fine while the CRD didn't.",
    },
    {
      id: "crd-not-installed",
      label: "The RateLimitPolicy CustomResourceDefinition itself was never installed on the cluster.",
      explanation:
        "If the CRD weren't installed, ArgoCD would report an error about an unrecognized resource kind entirely (no matching CRD), not a specific 'not permitted by the AppProject' exclusion message - that message is a project-policy rejection, which presupposes ArgoCD does recognize the kind.",
    },
    {
      id: "sync-wave-crd-after-deployment",
      label: "The RateLimitPolicy has a later sync-wave than the Deployment and just hasn't applied yet.",
      explanation:
        "The per-resource status shows the RateLimitPolicy as explicitly excluded from sync with a permission message, not merely pending in a later wave - a later-wave resource would show as Progressing/pending, not blocked by project policy.",
    },
    {
      id: "namespace-scoped-crd-mismatch",
      label: "The RateLimitPolicy manifest is missing a namespace field, so it can't be applied.",
      explanation:
        "RateLimitPolicy is described as a cluster-scoped resource - it isn't supposed to have a namespace field at all. The actual block is the AppProject's clusterResourceWhitelist rejecting the resource kind outright, unrelated to namespacing.",
    },
  ],
  correctOptionId: "clusterresourcewhitelist-empty-blocks-crd",
  resolution: `The Application's own per-resource status names the exact reason: the
RateLimitPolicy is excluded because it's "not permitted by the
AppProject". RateLimitPolicy is a cluster-scoped custom resource, and the
AppProject's \`spec.clusterResourceWhitelist\` is empty - by ArgoCD's
design, an empty (or absent) whitelist permits zero cluster-scoped
resource kinds, full stop. The Deployment is namespaced and governed by
a separate (and here unrestricted) mechanism, which is exactly why it
applied fine while the CRD was silently excluded.

Fix by explicitly allowlisting the CRD's kind on the AppProject:

\`\`\`yaml
spec:
  clusterResourceWhitelist:
    - group: ratelimiter.example.com
      kind: RateLimitPolicy
\`\`\`

(Avoid a wildcard \`{group: "*", kind: "*"}\` here unless the project
genuinely needs every cluster-scoped kind - allowlisting just the kinds
this app actually ships keeps the AppProject's isolation meaningful.)
Once added, the next sync applies the RateLimitPolicy along with the
Deployment, and the Application returns to fully Synced.`,
};
