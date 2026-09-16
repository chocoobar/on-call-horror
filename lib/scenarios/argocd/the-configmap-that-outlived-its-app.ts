import type { Scenario } from "../types";

export const theConfigmapThatOutlivedItsApp: Scenario = {
  id: "the-configmap-that-outlived-its-app",
  title: "The ConfigMap That Outlived Its App",
  subtitle: "session-cache's config edits from this morning aren't taking effect",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "resource-exclusions", "configmap"],
  briefing: `A ConfigMap change for "session-cache" was merged to main this morning to
bump the cache TTL. The Application shows Synced against the new
revision, but the running pods are still using the old TTL value - the
ConfigMap in the cluster genuinely still has the old contents, even
though ArgoCD insists everything is in sync.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-configmap-that-outlived-its-app", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/session-cache.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "session-cache" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "e5f6a7b" }, health: { status: "Healthy" } },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "session-cache-config", namespace: "session-cache" },
        spec: { data: { "ttl-seconds": "300" } },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-cm", namespace: "argocd" },
        spec: {
          data: {
            "resource.exclusions": "- apiGroups:\n    - \"\"\n  kinds:\n    - ConfigMap\n  clusters:\n    - \"*\"\n",
            "notes.md":
              "This cluster-wide resource.exclusions rule was added roughly a year ago\nby a different team to stop ArgoCD from churning on a specific set of\nnoisy, frequently-externally-mutated ConfigMaps in a different namespace.\nIt excludes *every* ConfigMap, in every namespace, cluster-wide, from\nArgoCD's reconciliation entirely - including session-cache-config, which\nhas nothing to do with the original noisy-ConfigMap problem it was meant\nto solve.",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap session-cache-config -n session-cache -o yaml` - what does the live ttl-seconds value actually say, compared to what's in git?",
    "The Application reports Synced, but Synced only reflects resources ArgoCD is actually comparing - check `argocd-cm`'s `resource.exclusions` for anything that would make ArgoCD skip a whole resource kind entirely.",
    "A cluster-wide exclusion rule added for one team's specific problem can silently affect every other Application on the same ArgoCD instance.",
  ],
  options: [
    {
      id: "cluster-wide-configmap-exclusion",
      label:
        "A cluster-wide `resource.exclusions` rule in argocd-cm, added a year ago for an unrelated team's noisy ConfigMaps, excludes every ConfigMap in every namespace from ArgoCD's reconciliation entirely - so session-cache-config is never compared or synced at all, regardless of what changes in git.",
      explanation:
        "`argocd-cm`'s `resource.exclusions` entry matches ConfigMaps across every apiGroup, every cluster, with no namespace or name scoping at all. With ConfigMaps excluded outright, ArgoCD never even looks at session-cache-config to compare it against git - which is why the Application can genuinely, accurately report Synced (it's only evaluating what it's configured to look at) while the actual ConfigMap silently never updates.",
    },
    {
      id: "configmap-immutable-flag",
      label: "The ConfigMap has `immutable: true` set, preventing updates.",
      explanation:
        "There's no `immutable` field shown on this ConfigMap, and an immutable ConfigMap update attempt would fail loudly with a clear apply-time error on the Application (immutable fields can't be patched) rather than silently reporting Synced while quietly doing nothing.",
    },
    {
      id: "wrong-configmap-name-referenced",
      label: "The Deployment references a different ConfigMap name than the one that was updated.",
      explanation:
        "The scenario is about the ConfigMap's *own contents* not updating at all (still ttl-seconds: 300, the old value) - if the Deployment referenced the wrong ConfigMap, this one's contents would have updated correctly in git and live, and the problem would be entirely on the consuming side, not here.",
    },
    {
      id: "pods-caching-old-configmap-mount",
      "label": "The pods have the ConfigMap mounted as a volume and haven't picked up the update because they haven't restarted.",
      explanation:
        "This might normally be a real, separate consideration for mounted ConfigMaps - but it doesn't explain the actual reported symptom: the ConfigMap object *in the cluster itself* still has the old value. A stale mount would still show the new value in the ConfigMap object itself, just not yet reflected inside the running pod's filesystem.",
    },
  ],
  correctOptionId: "cluster-wide-configmap-exclusion",
  resolution: `\`argocd-cm\`'s \`resource.exclusions\` has a rule matching every ConfigMap,
in every namespace, cluster-wide - added a year ago by a different team
to stop ArgoCD churning on a specific set of noisy, externally-mutated
ConfigMaps elsewhere. It was never scoped to just those ConfigMaps, so it
silently excludes session-cache-config too. With ConfigMaps excluded
outright, ArgoCD never compares this one against git at all - the
Application's Synced status is technically accurate (everything it's
actually configured to look at matches), it's just not looking at the one
resource that changed.

Fix by scoping the exclusion down to only what it was meant to cover
(replace with the actual namespace/names of the originally-noisy
ConfigMaps):

\`\`\`yaml
resource.exclusions: |
  - apiGroups:
      - ""
    kinds:
      - ConfigMap
    clusters:
      - "*"
    labelSelector:
      matchLabels:
        argocd.argoproj.io/exclude-from-sync: "true"
\`\`\`

(and label only the specific noisy ConfigMaps that need excluding, rather
than blanket-excluding the entire kind). Once this Application's
ConfigMap is back under ArgoCD's reconciliation, the next sync applies
the new ttl-seconds value and pods pick it up on their next restart.
Worth auditing every other Application on this shared instance for the
same silent gap - a cluster-wide exclusion like this affects everyone,
not just the team that added it.`,
};
