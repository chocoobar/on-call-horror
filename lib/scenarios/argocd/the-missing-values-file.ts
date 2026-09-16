import type { Scenario } from "../types";

export const theMissingValuesFile: Scenario = {
  id: "the-missing-values-file",
  title: "The Missing Values File",
  subtitle: "recommendation-engine deployed with every default the chart ships with",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "helm", "values"],
  briefing: `"recommendation-engine" is a Helm-based Application. The team carefully
tuned a "values-prod.yaml" file with production resource requests,
replica counts, and feature flags - but after this morning's sync, the
running pods look exactly like the chart's own bare defaults. None of the
tuned values appear to have taken effect anywhere.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-missing-values-file", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/recommendation-engine.git",
            targetRevision: "main",
            path: "chart",
            helm: {},
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "recommendations" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "3c4d5e6" }, health: { status: "Healthy" } },
        age: "3h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-engine", namespace: "recommendations", labels: { app: "recommendation-engine" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "app", resources: { requests: { cpu: "100m", memory: "128Mi" } } }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "chart-values-notes", namespace: "recommendations" },
        spec: {
          data: {
            "notes.md":
              "The chart's default values.yaml sets replicaCount: 1 and modest\nrequests (100m CPU / 128Mi memory) - exactly what's live. The team's\ntuned file, chart/values-prod.yaml, sets replicaCount: 6 and much higher\nrequests, and is present and committed in the repo at that exact path.\nThe Application's `spec.source.helm` block is present but empty ({}) -\nit never lists `values-prod.yaml` under `valueFiles`, so Helm renders\nusing only the chart's bundled values.yaml.",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get application the-missing-values-file -n argocd -o yaml` - look at `spec.source.helm` specifically. Is it empty?",
    "Committing a values file to the repo doesn't make Helm use it automatically - ArgoCD has to be told which value files to layer in via `spec.source.helm.valueFiles`.",
    "`kubectl get configmap chart-values-notes -n recommendations -o yaml` confirms the running Deployment matches the chart's bare defaults, not the tuned file.",
  ],
  options: [
    {
      id: "valuefiles-not-listed",
      label:
        "The prod values file exists and is committed at the right path, but the Application's `spec.source.helm.valueFiles` never references it - Helm renders using only the chart's own bundled defaults, which happen to match exactly what's running.",
      explanation:
        "`chart-values-notes` confirms the live Deployment (1 replica, 100m/128Mi) matches the chart's bare default values.yaml precisely, while the tuned `values-prod.yaml` (6 replicas, higher requests) sits committed in the repo but is never referenced. `spec.source.helm` on the Application is an empty object - without `valueFiles` listing it, ArgoCD's Helm render never layers that file in at all.",
    },
    {
      id: "values-file-yaml-error",
      label: "values-prod.yaml has a YAML syntax error, so Helm silently falls back to defaults.",
      explanation:
        "Helm doesn't silently fall back to defaults on a syntax error in a referenced values file - it fails the render outright with a parsing error, which would show as a comparison error on the Application, not a clean Synced/Healthy status running pure defaults.",
    },
    {
      id: "chart-version-pinned-old-missing",
      label: "The Application is pinned to an old chart version that predates the tuned values structure.",
      explanation:
        "There's no chart version mismatch here - the chart's own default values.yaml keys (replicaCount, resources) match what values-prod.yaml is trying to override, they're simply never being layered in because the file isn't referenced at all.",
    },
    {
      id: "selfheal-reverting-tuned-values",
      label: "selfHeal is reverting the tuned values back to defaults after each sync.",
      explanation:
        "selfHeal reverts live drift *away from what git currently declares* - here git's declared render (via the empty helm.valueFiles) genuinely is the bare defaults, so there's no drift for selfHeal to be correcting; the Application is accurately Synced to what it's actually configured to render.",
    },
  ],
  correctOptionId: "valuefiles-not-listed",
  resolution: `\`chart-values-notes\` confirms the running Deployment matches the chart's
own bundled \`values.yaml\` defaults exactly - 1 replica, 100m CPU, 128Mi
memory. The team's tuned \`values-prod.yaml\` is genuinely committed at
\`chart/values-prod.yaml\`, correctly formed, with the intended production
numbers - but the Application's \`spec.source.helm\` block is empty. Helm
only layers in additional values files that are explicitly listed under
\`valueFiles\`; a file simply existing in the chart directory isn't enough,
no matter how correct its contents are.

Fix by referencing it:

\`\`\`yaml
spec:
  source:
    helm:
      valueFiles:
        - values-prod.yaml
\`\`\`

ArgoCD's next sync re-renders the chart with both the base
\`values.yaml\` and \`values-prod.yaml\` layered on top (Helm's later
\`valueFiles\` entries take precedence over earlier ones and the chart's
own defaults), and the Deployment picks up the intended replica count and
resource requests.`,
};
