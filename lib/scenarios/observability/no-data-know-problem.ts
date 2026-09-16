import type { Scenario } from "../types";

export const noDataKnowProblem: Scenario = {
  id: "no-data-know-problem",
  title: "No Data, Know Problem",
  subtitle: "billing-api's Grafana dashboard has said \"No data\" for two days",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "servicemonitor", "metrics"],
  briefing: `The Grafana dashboard for "billing-api" has shown "No data" on every panel
for the last two days. Nobody noticed, because the service itself is
healthy - no customer complaints, pods Running and Ready, ArgoCD reports
Synced/Healthy. It only got caught because someone happened to open the
dashboard mid-deploy and it looked wrong.`,
  constraints: [
    "Prometheus itself is healthy and actively scraping dozens of other services without issue - this is scoped to one target.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "billing-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/billing-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "billing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "5d6e7f8a9b0c" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-api", namespace: "billing", labels: { app: "billing-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "billing-api-6b7c8d9e0-p1q2r", namespace: "billing", labels: { app: "billing-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "billing-api", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "billing-api-metrics", namespace: "billing", labels: { app: "billing-api" } },
        spec: {
          type: "ClusterIP",
          clusterIP: "10.96.88.14",
          selector: { app: "billing-api" },
          ports: [{ name: "http-metrics", port: 9464, targetPort: 9464 }],
        },
        age: "2d",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: { name: "billing-api", namespace: "billing" },
        spec: {
          selector: { matchLabels: { app: "billing-api-metrics" } },
          endpoints: [{ port: "http-metrics", interval: "30s", path: "/actuator/prometheus" }],
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get service billing-api-metrics -n billing -o yaml` and `kubectl get servicemonitor billing-api -n billing -o yaml` - Prometheus Operator turns a ServiceMonitor into scrape targets by matching its `spec.selector` against a Service's *labels*, not its name.",
    "Line up `spec.selector.matchLabels` on the ServiceMonitor against `metadata.labels` on the Service, key by key.",
    "This has nothing to do with billing-api itself - the pod is Running, Ready, and (per the Service in front of it) has a metrics port exposed the whole time. Something just never asked it for metrics.",
  ],
  options: [
    {
      id: "selector-name-mismatch",
      label:
        "The ServiceMonitor's selector (`matchLabels: { app: billing-api-metrics }`) doesn't match any label on the `billing-api-metrics` Service - it matches the Service's *name*, not a label it actually has - so Prometheus Operator never generates a scrape target for it.",
      explanation:
        "The Service's actual label is `app: billing-api` (matching the app, as every other resource here does) - not `app: billing-api-metrics`. Whoever wrote the ServiceMonitor selector used the Service's name where a label value belonged. Since the selector matches zero Services, Prometheus Operator never creates a scrape config for this target - the app has been emitting metrics on port 9464 the entire time, nothing has been pulling them.",
    },
    {
      id: "endpoint-down",
      label: "billing-api's `/actuator/prometheus` metrics endpoint is down.",
      explanation:
        "The pod is Running and Ready, and the Service in front of it has a healthy endpoint on port 9464 - there's nothing indicating the metrics endpoint itself is broken, only that nothing is currently configured to scrape it.",
    },
    {
      id: "prometheus-storage-full",
      label: "Prometheus itself is out of storage and silently dropping new series.",
      explanation:
        "Every other service's dashboard is populated and up to date, which rules out a Prometheus-wide storage or ingestion problem - this is isolated to billing-api specifically.",
    },
    {
      id: "grafana-query-wrong",
      label: "The Grafana dashboard's query uses the wrong job name.",
      explanation:
        "Even if the dashboard's query were wrong, that would only matter if billing-api's series existed in Prometheus in the first place to query - they don't, because the ServiceMonitor's selector never matched a scrape target for it to begin with.",
    },
  ],
  correctOptionId: "selector-name-mismatch",
  resolution: `The \`billing-api-metrics\` Service carries the label \`app: billing-api\`,
same as everything else in this namespace. The ServiceMonitor's
\`spec.selector.matchLabels\` is \`{ app: billing-api-metrics }\` - someone
copy-pasted the Service's *name* into a selector field that's supposed to
hold a *label value*. Since no Service in the namespace actually has that
label, Prometheus Operator's reconciler never finds a match, never
generates a scrape config, and Prometheus never learns this target exists.
No error, no alert, nothing - it's a target that was never wired up in the
first place, not one that broke.

The fix is a one-line correction to the ServiceMonitor:

\`\`\`yaml
spec:
  selector:
    matchLabels:
      app: billing-api   # match the Service's actual label, not its name
\`\`\`

Once the selector matches, Prometheus Operator picks up the target within
one reconcile loop, starts scraping \`/actuator/prometheus\` every 30s as
configured, and the Grafana dashboard starts filling back in.`,
};
