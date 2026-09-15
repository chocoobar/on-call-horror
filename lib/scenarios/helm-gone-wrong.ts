import type { Scenario } from "./types";

export const helmGoneWrong: Scenario = {
  id: "helm-gone-wrong",
  title: "Helm Gone Wrong",
  subtitle: "storefront's chart won't apply",
  difficulty: "medium",
  type: "fix",
  timeMinutes: 15,
  tags: ["argocd", "helm"],
  briefing: `The "storefront" Application deploys a small Helm chart. It was fine until
someone "tuned capacity for the holiday sale" by editing the Helm parameter
overrides on the Application itself, instead of the chart's own
values.yaml.

Now the Application fails to apply at all.`,
  constraints: [
    "The chart's own values.yaml and templates are fine - don't assume the chart itself is broken.",
    "The fix belongs in the override on the Application; leave a sane, valid value behind.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "helm-gone-wrong", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/storefront-chart.git",
            targetRevision: "main",
            path: "manifests",
            helm: { parameters: [{ name: "replicaCount", value: "many" }] },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "storefront" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Missing" },
          operationState: {
            phase: "Failed",
            message:
              'one or more objects failed to apply, reason: Deployment.apps "helm-gone-wrong-web" is invalid: spec.replicas: Invalid value: "many": spec.replicas in body must be of type integer: "string"',
          },
          conditions: [
            {
              type: "SyncError",
              message:
                'Deployment.apps "helm-gone-wrong-web" is invalid: spec.replicas: Invalid value: "many": spec.replicas in body must be of type integer: "string"',
            },
          ],
        },
        age: "12m",
      },
    ],
  },
  hints: [
    "`kubectl get application helm-gone-wrong -n argocd -o yaml` - check `spec.source.helm.parameters` first.",
    "`kubectl describe application helm-gone-wrong -n argocd` - the condition/operation error names the exact field and the exact bad value.",
    "The chart's default (in its own values.yaml) is fine. Someone overrode it on the Application with something that isn't a number.",
  ],
  options: [
    {
      id: "chart-syntax",
      label: "The chart's values.yaml has a syntax error.",
      explanation:
        "The error is a Kubernetes API validation error on the rendered Deployment (spec.replicas must be an integer), not a Helm template/YAML parse error - the chart itself renders fine, just with a bad value plugged in.",
    },
    {
      id: "missing-chart-yaml",
      label: "The chart is missing a Chart.yaml, so Helm can't render it at all.",
      explanation:
        "If Helm couldn't even parse the chart, ArgoCD would report a chart-loading error, not a Kubernetes API validation error about a specific field on a specific rendered Deployment.",
    },
    {
      id: "bad-helm-param",
      label: "A Helm parameter override on the Application sets replicaCount to a non-numeric value, which Kubernetes rejects.",
      explanation:
        "`spec.source.helm.parameters` overrides `replicaCount` to the string \"many\". Rendered through the chart, that becomes `replicas: many` in the Deployment - the Kubernetes API rejects it because replicas must be an integer, exactly matching the error message.",
    },
    {
      id: "bad-image-repo",
      label: "The image repository in values.yaml points to a registry that doesn't exist.",
      explanation:
        "The failure happens at manifest-apply time on the replicas field, before an image would ever be pulled - the error text is explicitly about spec.replicas, not an image pull.",
    },
  ],
  correctOptionId: "bad-helm-param",
  resolution: `\`spec.source.helm.parameters\` on the Application overrides \`replicaCount\` to
the string \`"many"\`. Rendered through the chart, that produces
\`replicas: many\` in the Deployment manifest, which the Kubernetes API
rejects outright (replicas must be an integer) - exactly the error in
\`status.operationState.message\`.

Fix the override to any valid integer (the chart's own default is 2):

\`\`\`
kubectl -n argocd patch application helm-gone-wrong --type json \\
  -p '[{"op":"replace","path":"/spec/source/helm/parameters/0/value","value":"4"}]'
\`\`\`

ArgoCD's automated sync retries on its own once the spec is valid again.`,
};
