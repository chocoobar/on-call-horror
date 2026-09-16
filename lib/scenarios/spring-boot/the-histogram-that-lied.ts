import type { Scenario } from "../types";

export const theHistogramThatLied: Scenario = {
  id: "the-histogram-that-lied",
  title: "The Histogram That Lied",
  subtitle: "search-api's dashboard swears p99 latency is a comfortable 80ms while customers report multi-second waits",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "micrometer", "observability"],
  briefing: `Support has a growing pile of tickets about "search-api" feeling sluggish
during busy periods, some describing waits of several seconds. The
service's own Grafana dashboard, built on its Micrometer/Prometheus
metrics, shows p99 latency sitting at a steady, unremarkable 80ms the
entire time - flatly contradicting what customers are actually
experiencing.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-api", namespace: "search", labels: { app: "search-api" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "search-api", image: "registry.internal/search-api:7.2.0" }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "14d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "search-api-6r7s8t9u0-v1w2x", namespace: "search", labels: { app: "search-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "search-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "search-api": [
            "2026-09-15T12:30:01.114Z INFO  c.e.search.SearchController - request req-33012 completed in 3410ms",
            "2026-09-15T12:30:12.220Z INFO  c.e.search.SearchController - request req-33018 completed in 2890ms",
          ],
        },
        age: "14d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-api-notes", namespace: "search" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "management:\n  metrics:\n    distribution:\n      slo:\n        http.server.requests: 10ms,50ms,80ms,200ms\n      percentiles-histogram:\n        http.server.requests: false\n",
            "notes.md":
              "`percentiles-histogram: false` means Micrometer isn't computing a real\nclient-side histogram at all - `slo` buckets instead produce simple\ncumulative counters at exactly the configured boundaries (10ms, 50ms,\n80ms, 200ms). Any actual request latency higher than 200ms - the highest\nconfigured SLO bucket - still only increments the '<= 200ms and above'\nbucket counter. The Grafana dashboard's p99 query estimates a percentile\nby interpolating between these bucket boundaries using PromQL's\n`histogram_quantile`, which has no visibility into how far past 200ms\nany individual slow request actually went - it can only ever report a\nvalue at or below the highest configured boundary.",
          },
        },
        age: "14d",
      },
    ],
  },
  hints: [
    "`kubectl logs search-api-6r7s8t9u0-v1w2x -n search` - real requests are logging completion times over 2.8 and 3.4 seconds. Compare that against the SLO buckets configured for the metric.",
    "`kubectl get configmap search-api-notes -n search -o yaml` - is `percentiles-histogram` actually enabled? What do `slo` buckets alone produce, versus a real histogram?",
    "`histogram_quantile` can only ever estimate a percentile within the range of buckets it has data for - what happens to a real 3-second request when the highest configured bucket boundary is 200ms?",
  ],
  options: [
    {
      id: "slo-buckets-without-histogram-cap-visible-latency-at-200ms",
      label:
        "`percentiles-histogram` is disabled and only `slo` boundary buckets are configured, topping out at 200ms - so Micrometer only ever records whether a request fell at or below each fixed boundary, with no data at all about how far past 200ms a slow request actually went; `histogram_quantile` in the dashboard's query can therefore never report a p99 above roughly 200ms no matter how slow real requests get, silently flattening genuine multi-second outliers into a reassuring, capped number.",
      explanation:
        "The logs show real completions well outside anything the dashboard reports: `3410ms` and `2890ms`, both far beyond the dashboard's steady ~80ms p99. `search-api-notes` explains the ceiling directly: with `percentiles-histogram: false`, only the configured `slo` bucket boundaries (up to 200ms) exist as counters at all - there's no finer-grained histogram data beyond that highest boundary, so any request slower than 200ms is indistinguishable, from the metric's point of view, from one that took exactly 200ms. `histogram_quantile` has no way to report a percentile value higher than the data it has, so genuine multi-second requests are invisible to it while still very real to the customers experiencing them.",
    },
    {
      id: "grafana-dashboard-query-caching-stale-data",
      label: "The Grafana dashboard's own query is caching a stale result and not refreshing.",
      explanation:
        "The problem here is in what data actually exists to query, not in how fresh the dashboard's display is - `search-api-notes` shows the underlying metric itself has no bucket data beyond 200ms at all, which a query cache refresh wouldn't create out of nothing.",
    },
    {
      id: "search-api-logging-wrong-durations",
      label: "SearchController's own request-timing log lines are measuring the wrong thing and are themselves wrong.",
      explanation:
        "The application's request-completion logs are a straightforward, direct measurement of how long each request actually took end-to-end - there's no indication they're measuring incorrectly; it's the aggregated metric pipeline's bucket configuration that's the source of the discrepancy.",
    },
    {
      id: "too-few-replicas-causing-real-slowness",
      label: "Three replicas is genuinely not enough capacity, and both the logs and customer reports reflect real overload.",
      explanation:
        "The slow requests in the logs are real and do reflect genuine latency - but the specific mystery here is why the *dashboard* fails to show it at all despite that, which is a metrics configuration gap (missing histogram data beyond 200ms), not a question of whether the underlying slowness itself is real.",
    },
  ],
  correctOptionId: "slo-buckets-without-histogram-cap-visible-latency-at-200ms",
  resolution: `The application's own request-completion logs show real, multi-second
latency: \`3410ms\` and \`2890ms\` for two ordinary search requests - nowhere
near the dashboard's steady, reassuring ~80ms p99. Since the logs
directly measure real end-to-end time, the discrepancy has to be in how
the aggregated metric is built.

\`search-api-notes\` explains exactly that: \`percentiles-histogram\` is set
to \`false\`, so Micrometer never builds a real histogram of individual
request latencies - it only tracks the configured \`slo\` boundaries (10ms,
50ms, 80ms, 200ms) as simple cumulative bucket counters. Any request
slower than the highest boundary, 200ms, still only increments that same
top bucket - there's no data anywhere in the metric about *how much*
slower it was. Grafana's dashboard estimates a p99 using PromQL's
\`histogram_quantile\`, which interpolates a percentile from bucket
boundaries - and it fundamentally cannot report a value above the highest
boundary it has any data for. A real 3.4-second outlier and a real
201ms request look identical to this metric: both just increment the
"200ms and above" bucket, and the reported p99 can never climb past
roughly 200ms no matter how bad the real tail gets.

The fix is enabling a real, finer-grained histogram with boundaries that
actually extend into the range customers are experiencing:

\`\`\`yaml
management:
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true
      minimum-expected-value:
        http.server.requests: 1ms
      maximum-expected-value:
        http.server.requests: 10s
\`\`\`

SLO-only bucket configuration is fine for tracking compliance against a
fixed set of targets, but it's the wrong tool for actually seeing the
tail of a latency distribution - any dashboard reporting a percentile via
\`histogram_quantile\` needs a real histogram with bucket boundaries that
extend meaningfully past whatever "bad" looks like for that service, or
the worst outliers become invisible by construction.`,
};
