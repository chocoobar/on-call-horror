import type { Scenario } from "./types";

export const theRuleThatOutlivedTheMetric: Scenario = {
  id: "the-rule-that-outlived-the-metric",
  title: "The Rule That Outlived The Metric",
  subtitle: "the SLO dashboard for shipping-api has read exactly 0% error rate for two weeks",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "recording-rules", "slo"],
  briefing: `The error-rate panel on shipping-api's SLO dashboard has read a flat,
suspicious 0% for the past two weeks - not "healthy and low," but exactly
zero, down to the decimal. Meanwhile support tickets about failed
shipping label generation have kept coming in at a normal, unremarkable
rate the whole time.`,
  constraints: [
    "shipping-api's own application logs confirm a normal, nonzero rate of 5xx responses throughout the two-week window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-api", namespace: "shipping", labels: { app: "shipping-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "shipping-api-slo-rules", namespace: "shipping" },
        spec: {
          groups: [
            {
              name: "shipping.slo",
              rules: [
                {
                  record: "shipping_api:error_ratio",
                  expr: 'sum(rate(shipping_api_requests_total{code=~"5.."}[5m])) / sum(rate(shipping_api_requests_total[5m]))',
                },
              ],
            },
          ],
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipping-api-changelog", namespace: "shipping" },
        spec: {
          data: {
            "CHANGELOG.md":
              "## v4.0.0 (2 weeks ago)\n- Migrated HTTP metrics instrumentation library. New metric name:\n  `shipping_api_http_requests_total` (label `status_code`, replacing the\n  old `shipping_api_requests_total` metric and its `code` label).\n- Old metric name deprecated and no longer emitted as of this release.\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap shipping-api-changelog -n shipping -o yaml` - did the actual metric name or label names emitted by shipping-api change recently?",
    "`kubectl get prometheusrule shipping-api-slo-rules -n shipping -o yaml` - does the recording rule's expression still reference the metric name shipping-api actually emits today?",
    "If a metric name referenced in a PromQL expression simply stops being emitted, the expression doesn't error - `sum(rate(nonexistent_metric[5m]))` just evaluates to an empty result, and dividing zero-result sums like this can quietly resolve to something that renders as a flat 0.",
  ],
  options: [
    {
      id: "recording-rule-references-renamed-metric",
      label:
        "shipping-api's v4.0.0 release two weeks ago renamed its HTTP metric from `shipping_api_requests_total` to `shipping_api_http_requests_total` and changed the status-code label from `code` to `status_code` - the SLO recording rule was never updated to match, so both its numerator and denominator now query a metric that no longer exists, silently producing a result that renders as a flat 0% instead of erroring.",
      explanation:
        "`shipping-api-changelog` confirms the v4.0.0 metrics library migration renamed the metric and its label exactly two weeks ago - matching the timing of the dashboard going flat. `shipping-api-slo-rules` still references the old `shipping_api_requests_total{code=~\"5..\"}` name. Querying a metric name Prometheus has no series for doesn't produce an error - both the numerator and denominator sums evaluate against nothing, and the resulting query renders as a flat 0, masking the real, independently-confirmed nonzero error rate in shipping-api's own logs.",
    },
    {
      id: "shipping-api-genuinely-healthy-now",
      label: "shipping-api genuinely fixed its error rate two weeks ago and the dashboard is correct.",
      explanation:
        "shipping-api's own application logs directly contradict this - they confirm a normal, nonzero rate of 5xx responses throughout the entire two-week window, plus the ongoing support tickets. The dashboard's 0% doesn't reflect reality; it reflects a query with nothing to measure.",
    },
    {
      id: "prometheus-not-scraping-shipping-api",
      label: "Prometheus stopped scraping shipping-api entirely two weeks ago.",
      explanation:
        "If scraping had stopped entirely, the recording rule's `up{}`-adjacent series and every other shipping-api metric would also be missing, and a ratio of two genuinely-empty sums (0/0) typically renders as blank or 'no data' rather than a clean, dashboard-rendering 0% - the changelog's metric rename is the more direct, evidenced explanation.",
    },
    {
      id: "support-tickets-unrelated-to-5xx",
      label: "The support tickets are about a separate issue unrelated to shipping-api's actual 5xx error rate.",
      explanation:
        "shipping-api's own logs, independent of the support tickets, already confirm a normal nonzero 5xx rate throughout the window - the tickets are corroborating evidence, not the primary contradiction here. The core mismatch is between the logs and the recording rule's output.",
    },
  ],
  correctOptionId: "recording-rule-references-renamed-metric",
  resolution: `\`shipping-api-changelog\` shows the v4.0.0 release, two weeks ago, migrated
shipping-api's HTTP metrics library and renamed the metric from
\`shipping_api_requests_total\` to \`shipping_api_http_requests_total\`,
along with renaming its status-code label from \`code\` to \`status_code\` -
and explicitly deprecated the old metric name entirely. \`shipping-api-slo-rules\`
was never updated to match; its \`shipping_api:error_ratio\` recording rule
still queries the old, now-nonexistent metric name in both its numerator
and denominator.

Querying a metric Prometheus has no series for doesn't produce an error -
it just returns an empty result set. \`sum()\` over an empty result is 0,
and \`0 / 0\` in PromQL either renders as no data or, depending on exactly
how the dashboard panel handles it, ends up displayed as a flat 0 - which
is indistinguishable at a glance from "genuinely zero errors," except that
it stays perfectly, suspiciously flat rather than tracking anything real.
Meanwhile shipping-api's actual logs and the ongoing support tickets
confirm the real error rate never went anywhere.

The fix is updating the recording rule to match the new metric and label
names:

\`\`\`yaml
- record: shipping_api:error_ratio
  expr: >
    sum(rate(shipping_api_http_requests_total{status_code=~"5.."}[5m]))
    /
    sum(rate(shipping_api_http_requests_total[5m]))
\`\`\`

A metrics library migration or instrumentation rename should always come
with an audit of every recording rule, alert rule, and dashboard querying
the old names - otherwise, as here, the SLO keeps reporting a perfect
score built entirely out of querying nothing.`,
};
