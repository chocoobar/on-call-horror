import type { Scenario } from "./types";

export const theClusterGeneratorWithNoLabel: Scenario = {
  id: "the-cluster-generator-with-no-label",
  title: "The Cluster Generator With No Label",
  subtitle: "the new EU region cluster never got a single Application deployed to it",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "applicationset", "cluster-generator"],
  briefing: `A new cluster, "eu-west-cluster", was registered with ArgoCD three days
ago as part of an EU expansion. The "regional-services" ApplicationSet is
supposed to generate one Application per registered cluster for every
service in its list - it did that for every existing cluster, but
absolutely nothing was generated for eu-west-cluster.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "regional-services", namespace: "argocd" },
        spec: {
          generators: [
            {
              clusters: {
                selector: { matchLabels: { "argocd.argoproj.io/deploy-region-services": "true" } },
              },
            },
          ],
          template: {
            metadata: { name: "{{name}}-region-services" },
            spec: {
              source: { repoURL: "https://github.com/example/region-services.git", targetRevision: "main", path: "manifests" },
              destination: { server: "{{server}}", namespace: "region-services" },
            },
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "eu-west-cluster",
          namespace: "argocd",
          labels: { "argocd.argoproj.io/secret-type": "cluster" },
        },
        spec: {
          data: {
            name: "eu-west-cluster",
            server: "https://eu-west-cluster.example.com:6443",
          },
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "us-east-cluster",
          namespace: "argocd",
          labels: { "argocd.argoproj.io/secret-type": "cluster", "argocd.argoproj.io/deploy-region-services": "true" },
        },
        spec: {
          data: {
            name: "us-east-cluster",
            server: "https://us-east-cluster.example.com:6443",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get applicationset regional-services -n argocd -o yaml` - the cluster generator uses a `selector.matchLabels`, not a plain 'every registered cluster'.",
    "`kubectl get secret eu-west-cluster -n argocd --show-labels` and compare against `us-east-cluster`'s labels - both are registered cluster secrets, but do they carry the same labels?",
    "A cluster generator with a label selector only picks up clusters whose secret carries the matching label - registering a new cluster doesn't automatically apply any labels beyond the required `argocd.argoproj.io/secret-type: cluster`.",
  ],
  options: [
    {
      id: "new-cluster-secret-missing-selector-label",
      label:
        "The ApplicationSet's cluster generator only matches cluster secrets labeled `argocd.argoproj.io/deploy-region-services: true`, but the new eu-west-cluster secret only carries the required base `secret-type: cluster` label from registration and was never given the extra opt-in label the generator's selector actually filters on.",
      explanation:
        "The generator's `selector.matchLabels` requires `argocd.argoproj.io/deploy-region-services: true`. The `us-east-cluster` secret carries that label (which is why it generates Applications), but the new `eu-west-cluster` secret only has the base `secret-type: cluster` label that cluster registration itself adds - the opt-in label the generator actually filters on was never added when the cluster was registered.",
    },
    {
      id: "appset-controller-not-watching-new-cluster",
      label: "The ApplicationSet controller hasn't refreshed its view of registered clusters since eu-west-cluster was added.",
      explanation:
        "ApplicationSet's cluster generator re-evaluates on its normal reconciliation loop (typically every few minutes, well within three days) - a stale cache wouldn't persist for days, and there's no indication of a controller-level staleness issue here versus a straightforward label mismatch.",
    },
    {
      id: "cluster-secret-missing-server-field",
      label: "The eu-west-cluster secret is missing the server field needed to register it.",
      explanation:
        "The secret's data includes both `name` and `server` fields, correctly formed - registration itself succeeded (the cluster is a valid, usable ArgoCD-registered destination). The gap is specifically in which label the generator's selector is filtering by, not in the secret's basic validity.",
    },
    {
      id: "appproject-blocks-new-destination",
      label: "The AppProject doesn't allow eu-west-cluster as a destination yet.",
      explanation:
        "If an AppProject destination restriction were blocking it, the ApplicationSet would still generate the Application, which would then show an InvalidSpecError condition - here no Application was generated for eu-west-cluster at all, which points at the generator never selecting the cluster in the first place, not at a downstream project restriction.",
    },
  ],
  correctOptionId: "new-cluster-secret-missing-selector-label",
  resolution: `The ApplicationSet's cluster generator filters with \`selector.matchLabels:
{argocd.argoproj.io/deploy-region-services: "true"}\`. The existing
\`us-east-cluster\` secret carries that exact label, which is why it
generates region-services Applications correctly. The new
\`eu-west-cluster\` secret only has the base \`argocd.argoproj.io/secret-
type: cluster\` label that cluster registration itself always adds -
nobody applied the extra opt-in label the generator's selector actually
requires, so the generator never sees eu-west-cluster as a match at all,
silently and without any error.

Fix by adding the missing label to the cluster secret:

\`\`\`
kubectl label secret eu-west-cluster -n argocd \\
  argocd.argoproj.io/deploy-region-services=true
\`\`\`

On the ApplicationSet's next reconciliation, eu-west-cluster starts
matching the selector and generates \`eu-west-cluster-region-services\`
along with every other cluster already registered. Worth documenting this
opt-in label as a required step in whatever runbook or automation
registers a new cluster - it's easy to complete cluster registration
itself successfully while missing a labeling step that a specific
ApplicationSet quietly depends on.`,
};
