import type { Scenario } from "../types";

export const theDatasourceThatAssumedWrong: Scenario = {
  id: "the-datasource-that-assumed-wrong",
  title: "The Datasource That Assumed Wrong",
  subtitle: "billing-webhooks' request-rate graph is full of erratic gaps and spikes that nobody else's graphs have",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["grafana", "prometheus", "rate-interval"],
  briefing: `Every dashboard built on the shared Grafana Prometheus datasource looks
smooth and reasonable except "billing-webhooks"'s - its request-rate panel
is full of erratic gaps and improbable spikes, as if data were missing
half the time. billing-webhooks is confirmed healthy and its raw metrics
endpoint returns complete, regular data whenever anyone checks it by
hand.`,
  constraints: [
    "Every other service's dashboard, sharing the exact same Grafana datasource, renders correctly with no such artifacts.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-webhooks", namespace: "billing", labels: { app: "billing-webhooks" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: { name: "billing-webhooks", namespace: "billing" },
        spec: {
          selector: { matchLabels: { app: "billing-webhooks" } },
          endpoints: [{ port: "metrics", interval: "2m" }],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-datasource-prometheus", namespace: "monitoring" },
        spec: {
          data: {
            "datasource.yaml":
              "jsonData:\n  timeInterval: 15s\n  # \"Scrape interval\" setting on the datasource - used cluster-wide as the\n  # assumed default scrape cadence when a panel query uses Grafana's\n  # $__rate_interval variable, which auto-computes as roughly\n  # 4 * max(configured scrape interval, actual query step).\n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "billing-webhooks-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Webhook Request Rate",\n  "targets": [{ "expr": "sum(rate(billing_webhooks_requests_total[$__rate_interval]))" }]\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rate-interval-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "$__rate_interval computes as roughly 4x the datasource's configured\nscrape interval (or 4x the panel's actual step, whichever is larger).\nThe shared datasource's configured scrape interval is 15s (correct for\nmost services), giving a $__rate_interval around 60s for most panels -\nplenty for a `rate()` window to reliably contain multiple real samples.\nbilling-webhooks, however, is scraped every 2 minutes (deliberately\nlower-frequency, to reduce load from its heavier metrics payload) -\nfour times slower than the datasource's assumed default. A 60s\n$__rate_interval against a metric only actually sampled every 120s means\nmost evaluated windows contain zero or one real sample, which `rate()`\ncan't compute a meaningful rate from - producing exactly the erratic\ngaps and spikes seen on this one dashboard.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get servicemonitor billing-webhooks -n billing -o yaml` - how often is this specific target actually scraped, compared to everything else?",
    "`kubectl get configmap grafana-datasource-prometheus -n monitoring -o yaml` - what scrape interval does the shared Grafana datasource assume by default when computing `$__rate_interval`?",
    "`kubectl get configmap rate-interval-notes -n monitoring -o yaml` - if `$__rate_interval` is computed assuming a much shorter scrape interval than a target actually uses, how many real samples end up inside a `rate()` window built from it?",
  ],
  options: [
    {
      id: "rate-interval-shorter-than-actual-scrape-cadence",
      label:
        "billing-webhooks is deliberately scraped every 2 minutes (four times slower than most services), but Grafana's shared datasource assumes a 15s scrape interval when computing `$__rate_interval`, producing a roughly 60-second rate window for every panel using it - which for a target actually sampled every 120s means most evaluated windows contain zero or one real sample, and `rate()` can't compute a stable value from that, producing the erratic gaps and spikes unique to this one dashboard.",
      explanation:
        "`billing-webhooks` ServiceMonitor confirms a 2-minute scrape interval, deliberately set lower-frequency due to a heavier metrics payload. `grafana-datasource-prometheus` shows the shared datasource assumes a 15s scrape interval for computing `$__rate_interval`. `rate-interval-notes` does the math: the resulting ~60s rate window against a target only actually sampled every 120s leaves most windows with 0-1 real samples, exactly matching why only this dashboard - whose target scrapes far slower than the datasource's assumed default - shows the artifact, while every other service's dashboard (scraped closer to 15s) renders fine.",
    },
    {
      id: "billing-webhooks-metrics-endpoint-flaky",
      label: "billing-webhooks' `/metrics` endpoint is intermittently slow or failing to respond.",
      explanation:
        "billing-webhooks' raw metrics endpoint is confirmed to return complete, regular data whenever checked directly - the data collection itself isn't the problem. The issue is specifically how a rate calculation's assumed window size interacts with this target's genuinely slower (but perfectly healthy) scrape cadence.",
    },
    {
      id: "grafana-datasource-connectivity-issue",
      label: "Grafana's connection to the Prometheus datasource is intermittently dropping for this specific query.",
      explanation:
        "Every other dashboard using the exact same datasource connection renders correctly and consistently - a connectivity issue with the datasource itself would be expected to affect all queries through it, not selectively just billing-webhooks' panel.",
    },
    {
      id: "billing-webhooks-counter-resets-frequently",
      label: "billing_webhooks_requests_total is resetting unusually often, confusing rate() calculations.",
      explanation:
        "There's no evidence of frequent counter resets here - billing-webhooks' pods show normal, low restart counts, and the specific mechanism evidenced (a rate window mismatched against the actual scrape cadence) is a sufficient and directly documented explanation for the erratic-looking graph without needing to assume additional resets.",
    },
  ],
  correctOptionId: "rate-interval-shorter-than-actual-scrape-cadence",
  resolution: `\`billing-webhooks\`'s \`ServiceMonitor\` confirms it's scraped every 2
minutes - deliberately slower than most services, to reduce load from a
heavier metrics payload. \`grafana-datasource-prometheus\` shows the shared
Grafana datasource's configured scrape interval, used to auto-compute
\`$__rate_interval\` for any panel that relies on it, is 15 seconds - a
reasonable default for most services, but four times shorter than
billing-webhooks' real cadence. \`rate-interval-notes\` explains the
consequence: \`$__rate_interval\` resolves to roughly 4x the assumed scrape
interval, around 60 seconds here, and a \`rate()\` window that size against
a target actually sampled only every 120 seconds frequently contains zero
or one real data point - not enough for \`rate()\` to compute a stable,
meaningful value from, producing exactly the gaps and spikes seen. Every
other dashboard, built against services scraped close to the assumed 15s
default, never hits this problem, which is why it's isolated to this one
panel.

The datasource-level assumption is a reasonable default for the common
case, but it silently breaks down for any target with a meaningfully
different real scrape interval - and \`$__rate_interval\` has no visibility
into per-target scrape configuration to correct for that automatically.

The fix is overriding the rate window explicitly for this panel, sized to
comfortably span multiple real scrape intervals for this specific target:

\`\`\`promql
sum(rate(billing_webhooks_requests_total[8m]))
\`\`\`

or, more precisely, using Grafana's per-panel \`min interval\` setting to
tell \`$__rate_interval\` about this target's real cadence. Any target
scraped meaningfully slower (or faster) than a shared datasource's
assumed default is worth checking specifically for this - \`$__rate_interval\`
is a convenience, not a guarantee, when scrape cadence varies across
targets sharing one datasource.`,
};
