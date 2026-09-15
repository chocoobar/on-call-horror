import type { Scenario } from "./types";

export const theBucketBoundaryLie: Scenario = {
  id: "the-bucket-boundary-lie",
  title: "The Bucket Boundary Lie",
  subtitle: "the p99 latency panel for checkout-gateway has read a suspiciously exact 500ms for a week",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["prometheus", "histogram", "latency"],
  briefing: `The p99 latency dashboard for "checkout-gateway" has shown almost exactly
500ms for the past week, suspiciously flat for a service whose real
traffic pattern is anything but flat. Real user complaints about slow
checkouts have been trickling in the whole time, but the dashboard everyone
trusts says nothing's wrong.`,
  constraints: [
    "checkout-gateway's request logs, independently, show real response times well above 500ms during peak traffic.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-gateway", namespace: "checkout", labels: { app: "checkout-gateway" } },
        spec: { replicas: 5 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 5 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-gateway-metrics-config", namespace: "checkout" },
        spec: {
          data: {
            "metrics.yaml":
              "histogram:\n  name: http_request_duration_seconds\n  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5]\n  # NOTE: this bucket list was copied from the old \"catalog-api\" service\n  # template two years ago and never revisited for checkout-gateway's\n  # actual latency profile.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "histogram-quantile-notes", namespace: "checkout" },
        spec: {
          data: {
            "notes.md":
              "`histogram_quantile()` estimates a quantile by linear interpolation\n*between the two bucket boundaries the target quantile falls between*.\nIf every observation above the highest finite bucket boundary (here,\n0.5s) falls into the `+Inf` bucket, `histogram_quantile()` has no upper\nbound to interpolate against for any quantile that lands in that bucket -\nit clamps the result to the highest finite boundary itself. In other\nwords: once enough requests exceed 500ms, the reported p99 *cannot* go\nabove 0.5s, no matter how slow those requests actually are.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap checkout-gateway-metrics-config -n checkout -o yaml` - look at the actual bucket boundaries this histogram was configured with, and where they came from.",
    "`kubectl get configmap histogram-quantile-notes -n checkout -o yaml` - what does `histogram_quantile()` actually do when a quantile falls in the `+Inf` bucket?",
    "If literally every request slower than the highest finite bucket boundary gets lumped into one catch-all `+Inf` bucket, what's the mathematical ceiling on any quantile `histogram_quantile()` can report?",
  ],
  options: [
    {
      id: "highest-bucket-boundary-clamps-quantile",
      label:
        "The histogram's highest finite bucket boundary is 0.5s, copied years ago from an unrelated service's much faster latency profile - once real requests exceed that, they all land in the catch-all `+Inf` bucket with no further resolution, and `histogram_quantile()` mathematically clamps at the highest finite boundary, so p99 can never report above 500ms no matter how slow requests actually get.",
      explanation:
        "`checkout-gateway-metrics-config` shows the highest finite bucket boundary is `0.5` (seconds), explicitly noted as copied from a different, faster service. `histogram-quantile-notes` explains the consequence directly: once enough observations exceed that boundary and pile into `+Inf`, `histogram_quantile()` has nothing to interpolate against and clamps its estimate at the highest finite boundary - exactly the flat, suspiciously-exact 500ms the dashboard has been showing, regardless of how slow real requests get, which lines up with the independently-confirmed slow response times in the logs.",
    },
    {
      id: "grafana-panel-caching",
      label: "Grafana is caching the panel's last known value instead of querying fresh data.",
      explanation:
        "A caching issue would produce a genuinely stale, unchanging number - but the dashboard is querying live and getting a real (if mathematically capped) computed value each time. The flatness comes from how the underlying histogram buckets constrain what value can possibly be computed, not from stale display data.",
    },
    {
      id: "wrong-quantile-configured",
      label: "The dashboard panel is actually querying p50, not p99, and someone mislabeled it.",
      explanation:
        "The query itself does target the 0.99 quantile correctly - the issue isn't which quantile is requested, it's that the histogram's bucket boundaries make any quantile above the busiest bucket mathematically indistinguishable once enough samples exceed the highest finite boundary.",
    },
    {
      id: "checkout-gateway-actually-fast",
      label: "checkout-gateway is genuinely fast, and the user complaints are about something else in the checkout flow.",
      explanation:
        "The independently confirmed request logs directly contradict this - response times well above 500ms are recorded there during peak traffic. The dashboard's flat 500ms reading is the anomaly to explain, not evidence the service is actually fast.",
    },
  ],
  correctOptionId: "highest-bucket-boundary-clamps-quantile",
  resolution: `\`checkout-gateway-metrics-config\` shows the histogram's bucket boundaries
top out at \`0.5\` seconds - explicitly noted as having been copied from a
different, much faster service's template two years ago and never revisited.
\`histogram-quantile-notes\` explains what that does to \`histogram_quantile()\`:
every observation slower than 500ms gets lumped into the single catch-all
\`+Inf\` bucket, with no further boundary inside it to interpolate against.
Once enough requests land there to make p99 fall in that bucket,
\`histogram_quantile()\` has nowhere higher to estimate toward and clamps its
result at the highest *finite* boundary - 500ms, exactly the suspiciously
flat number the dashboard has been showing, no matter how slow requests
actually get. This lines up perfectly with the independently-confirmed
slow response times in checkout-gateway's own logs; the histogram simply
lost the resolution to represent them.

The fix is giving the histogram bucket boundaries that actually span
checkout-gateway's real latency profile, with enough headroom above the
genuinely slow tail to keep meaningful resolution:

\`\`\`yaml
histogram:
  name: http_request_duration_seconds
  buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
\`\`\`

Histogram buckets should be chosen for the service they're actually
measuring, not inherited wholesale from an unrelated one - and it's worth
periodically checking what fraction of observations are landing in
\`+Inf\`; a nontrivial amount there is a sign the buckets have already
stopped telling the truth.`,
};
