import type { Scenario } from "../types";

export const alertThatNeverFired: Scenario = {
  id: "alert-that-never-fired",
  title: "The Alert That Never Fired",
  subtitle: "checkout-api had a 40-minute outage and PagerDuty stayed silent",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["prometheus", "alerting", "metrics"],
  briefing: `"checkout-api" had a rough 40-minute stretch overnight where its error
rate spiked past 20%. Customers noticed. On-call didn't, because
PagerDuty never rang. The \`PrometheusRule\` for exactly this situation -
\`HighCheckoutErrorRate\` - has existed for months and has fired correctly
before.`,
  constraints: [
    "This exact alert fired correctly as recently as three weeks ago - something changed since then, not the rule's underlying logic.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "checkout-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/checkout-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "checkout" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "a1b2c3d4e5f6" }, health: { status: "Healthy" } },
        age: "3w",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-api-4d5e6f7g8-h9i0j", namespace: "checkout", labels: { app: "checkout-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-api": [
            "2026-09-14T02:11:03.221Z ERROR c.e.checkout.PaymentGateway - upstream returned 503 for charge req-40021",
            "2026-09-14T02:11:04.880Z ERROR c.e.checkout.PaymentGateway - upstream returned 503 for charge req-40022",
            "2026-09-14T02:11:05.412Z ERROR c.e.checkout.PaymentGateway - upstream returned 503 for charge req-40023",
            "2026-09-14T02:11:06.009Z ERROR c.e.checkout.PaymentGateway - upstream returned 503 for charge req-40024",
            "2026-09-14T02:11:06.771Z INFO  c.e.checkout.OrderController - completed order req-40020 in 44ms",
          ],
        },
        age: "3w",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "checkout-api-alerts", namespace: "checkout" },
        spec: {
          groups: [
            {
              name: "checkout.rules",
              rules: [
                {
                  alert: "HighCheckoutErrorRate",
                  expr:
                    'sum(rate(checkout_requests_total{status=~"5.."}[5m])) / sum(rate(checkout_requests_total[5m])) > 0.05',
                  for: "5m",
                  labels: { severity: "page" },
                  annotations: { summary: "checkout-api error rate above 5% for 5m" },
                },
              ],
            },
          ],
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-api-changelog", namespace: "checkout" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v4.2.0 (deployed 2026-09-02)\n- Migrated custom request metrics to Micrometer's standard HTTP\n  server metrics (`http_server_requests_seconds_count`).\n- Removed the legacy `checkout_requests_total` counter - it's fully\n  superseded by the Micrometer metric with the same information in\n  its `status`/`outcome` tags.\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get prometheusrule checkout-api-alerts -n checkout -o yaml` - what metric name does `HighCheckoutErrorRate`'s `expr` actually query?",
    "`kubectl get configmap checkout-api-changelog -n checkout -o yaml` - has anything about checkout-api's metrics changed recently?",
    "The logs prove the error rate was real (`req-40021` through `req-40024` all 503ing back to back). If the rule's query returns no data at all, an alert can't become `pending`, let alone `firing` - it just sits at `inactive` forever, with nothing to show anyone that anything's wrong with the rule itself.",
  ],
  options: [
    {
      id: "metric-renamed",
      label:
        "The rule's `expr` still queries `checkout_requests_total`, a metric that no longer exists since v4.2.0 replaced it with Micrometer's standard `http_server_requests_seconds_count` - the query returns no data, so the alert can never leave `inactive`, no matter how bad the real error rate gets.",
      explanation:
        "`checkout-api-changelog` confirms `checkout_requests_total` was removed in v4.2.0, deployed three weeks ago - right when this alert last fired correctly. `HighCheckoutErrorRate`'s `expr` was never updated to match, so it's been querying a metric that doesn't exist ever since. A PromQL query against a nonexistent metric doesn't error, it just returns an empty result set - which means the alert's condition is never true, and it sits at `inactive` forever, completely indistinguishable from things being fine.",
    },
    {
      id: "for-duration-too-long",
      label: "`for: 5m` is too long, letting the incident resolve before the alert can fire.",
      explanation:
        "The incident lasted roughly 40 minutes - comfortably longer than a 5-minute for-duration. If the query were matching real data, this alert would have had more than enough time to go from `pending` to `firing`.",
    },
    {
      id: "pagerduty-key-wrong",
      label: "The PagerDuty integration key in Alertmanager's routing config is misconfigured.",
      explanation:
        "Alertmanager routing only matters for alerts that actually reach `firing` - this one never got that far in Prometheus itself, so there was nothing for Alertmanager to route anywhere in the first place.",
    },
    {
      id: "error-rate-was-fine",
      label: "checkout-api's real error rate never actually crossed 5%, so the alert correctly stayed quiet.",
      explanation:
        "The logs from the incident window show a sustained run of upstream 503s on the payment gateway path, well above a 5% threshold - the traffic was clearly unhealthy. The alert just wasn't watching a metric that could prove it.",
    },
  ],
  correctOptionId: "metric-renamed",
  resolution: `\`checkout-api-changelog\` pins it down exactly: v4.2.0, deployed three
weeks ago, replaced the custom \`checkout_requests_total\` counter with
Micrometer's standard \`http_server_requests_seconds_count\`. Nobody updated
\`HighCheckoutErrorRate\`'s \`expr\` to match. A PromQL query against a metric
that no longer exists doesn't throw an error anywhere visible - it just
silently evaluates to an empty result set, forever, which means the
alert's ratio condition is never even evaluated as true or false. It sits
at \`inactive\` in the Prometheus UI indistinguishably from "everything is
fine."

The fix is updating the rule to query the metric that actually exists now,
with the equivalent label matchers:

\`\`\`yaml
- alert: HighCheckoutErrorRate
  expr: |
    sum(rate(http_server_requests_seconds_count{
      uri="/checkout", outcome="SERVER_ERROR"
    }[5m]))
    /
    sum(rate(http_server_requests_seconds_count{uri="/checkout"}[5m]))
    > 0.05
  for: 5m
\`\`\`

Whenever a metrics migration renames or removes a series, every alert
rule, dashboard panel, and recording rule that referenced the old name
needs to be audited and updated in the same change - otherwise they don't
break loudly, they just quietly stop watching anything at all.`,
};
