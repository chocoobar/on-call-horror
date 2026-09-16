import type { Scenario } from "../types";

export const theRotatedDeployKey: Scenario = {
  id: "the-rotated-deploy-key",
  title: "The Rotated Deploy Key",
  subtitle: "fulfillment-api syncs fine, but a second, quieter repo behind it doesn't",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "credentials", "helm"],
  briefing: `"fulfillment-api" pulls its main manifests from one repo and its shared
Helm chart dependency from a second, separately-hosted chart repo. This
morning's credential rotation for the main repo went smoothly - but the
Application still fails to sync, with an error that traces back to the
second repo instead.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-rotated-deploy-key", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "git@github.com:example/fulfillment-api.git",
            targetRevision: "main",
            path: "chart",
            helm: { valueFiles: ["values-prod.yaml"] },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "fulfillment" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message:
                "helm dependency build failed: Repo \"https://charts.internal.example.com\" is not accessible: authentication required",
            },
          ],
        },
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "chart-dependency-notes", namespace: "argocd" },
        spec: {
          data: {
            "Chart.yaml.excerpt":
              "dependencies:\n  - name: shared-fulfillment-lib\n    version: \"2.1.0\"\n    repository: \"https://charts.internal.example.com\"\n",
            "notes.md":
              "This morning's rotation covered the SSH deploy key for the main\nfulfillment-api git repo (git@github.com:example/fulfillment-api.git)\nand went smoothly - that repo authenticates fine now. The chart's own\nChart.yaml declares a *separate* Helm dependency hosted on an entirely\ndifferent, credential-protected repo (charts.internal.example.com),\nregistered in ArgoCD as its own repository credential. That second\nrepository credential wasn't part of this morning's rotation at all -\nit's been sitting on an old, still-valid-for-now but soon-expiring\ncredential the whole time, and it looks like it finally expired\nsometime in roughly the last hour, independent of and unrelated to the\nmain repo's rotation.",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-rotated-deploy-key -n argocd` - the ComparisonError names a specific repo URL. Is it the same repo that was just rotated?",
    "`kubectl get configmap chart-dependency-notes -n argocd -o yaml` and check the chart's own Chart.yaml for any declared dependencies.",
    "A single Application/chart can depend on credentials for more than one repository - fixing one doesn't automatically fix the others.",
  ],
  options: [
    {
      id: "separate-chart-dependency-repo-credential-expired",
      label:
        "The chart declares a separate Helm dependency hosted on a different, independently credentialed repo (charts.internal.example.com) that wasn't part of this morning's rotation at all - its own, unrelated credential appears to have simply expired around the same time, which is why the main repo authenticates fine while the chart dependency build still fails.",
      explanation:
        "The ComparisonError explicitly names `https://charts.internal.example.com` - a different URL from the main repo that was rotated this morning (`git@github.com:example/fulfillment-api.git`). `chart-dependency-notes` confirms this second repo is a separate, independently-credentialed Helm chart dependency declared in Chart.yaml, and that its credential wasn't touched by this morning's rotation - it was already on a slowly-expiring credential that happened to lapse around the same time, an unrelated coincidence in timing rather than the same rotation.",
    },
    {
      id: "rotation-didnt-fully-apply",
      label: "This morning's credential rotation for the main repo didn't fully apply everywhere.",
      explanation:
        "The error message names a completely different repository URL than the one that was rotated - if the main repo's rotation had only partially applied, the error would still reference the main repo's URL, not an unrelated second repo that was never part of this rotation.",
    },
    {
      id: "chart-version-doesnt-exist",
      label: "The pinned dependency version 2.1.0 doesn't exist in the chart repo.",
      explanation:
        "The error is explicitly an authentication failure ('is not accessible: authentication required'), not a version-not-found error - ArgoCD never got far enough to check whether version 2.1.0 exists, because it couldn't authenticate to the repo at all.",
    },
    {
      id: "repo-server-lost-network-access",
      label: "argocd-repo-server lost network access to external chart repositories entirely.",
      explanation:
        "The error is a clear authentication failure on this specific repo, not a network-level connectivity or DNS failure - and the main repo (also external, over SSH) is confirmed reachable and authenticating fine, which rules out a broad network access problem.",
    },
  ],
  correctOptionId: "separate-chart-dependency-repo-credential-expired",
  resolution: `The ComparisonError names \`https://charts.internal.example.com\` directly
- a completely different repository from \`fulfillment-api.git\`, the one
actually rotated this morning. \`chart-dependency-notes\` confirms
Chart.yaml declares a separate Helm dependency, \`shared-fulfillment-lib\`,
hosted on that second repo with its own independent ArgoCD repository
credential - one that was never touched by this morning's rotation. It
looks like that credential simply reached its own, unrelated expiry
around the same time, which is why the main repo authenticates cleanly
while the chart dependency build still fails - two separate credentials,
coincidentally close in timing, not one rotation that missed a spot.

Fix by rotating/refreshing the credential for the chart repo specifically:

\`\`\`
argocd repo add https://charts.internal.example.com \\
  --username chart-reader --password <new-token> \\
  --upsert
\`\`\`

Once the second repo's credential is valid again, ArgoCD's next
comparison succeeds in building the chart's dependencies. Worth adding
both repository credentials to the same rotation schedule/runbook going
forward - a "rotate the deploy key" checklist that only covers the
primary git repo will keep missing any additional chart-dependency repos
an Application quietly relies on.`,
};
