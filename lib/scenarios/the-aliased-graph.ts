import type { Scenario } from "./types";

export const theAliasedGraph: Scenario = {
  id: "the-aliased-graph",
  title: "The Aliased Graph",
  subtitle: "the 30-day view of api-gateway's request rate shows a suspiciously regular pulsing pattern nobody can explain",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["grafana", "promql", "step-interval"],
  briefing: `Someone zoomed the api-gateway request-rate dashboard out to a 30-day view
ahead of a capacity planning meeting, and it shows an oddly regular,
almost rhythmic pulsing pattern - sharp dips every few hours, far too
frequent and mechanical-looking to be a real daily traffic cycle. Zoomed
into any single dip at high resolution, the underlying traffic actually
looks completely smooth and normal.`,
  constraints: [
    "api-gateway's traffic, confirmed via the load balancer's own independent access-log-based rate, is smooth and free of any such periodic dips.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "api-gateway", namespace: "gateway", labels: { app: "api-gateway" } },
        spec: { replicas: 5 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 5 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "api-gateway-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Request Rate (30d)",\n  "targets": [{ "expr": "sum(rate(gateway_requests_total[5m]))", "interval": "3h" }],\n  "description": "interval field pins the query step regardless of time range or panel width"\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "promql-step-aliasing-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "This panel's query has a hardcoded `interval: 3h`, meaning Prometheus\nevaluates `rate(gateway_requests_total[5m])` at a fixed point in time\nonce every 3 hours and connects those points with a line - each plotted\npoint reflects only the 5-minute window ending at that instant, not an\naverage across the 3 hours between points. api-gateway also runs a\nlightweight internal batch job every 3 hours, lasting about 4 minutes,\nduring which request handling briefly slows (though real traffic\nvolume itself doesn't drop). If the batch job's timing happens to align\nwith when the query's evaluation instants land, each sampled 5-minute\nwindow can catch the tail end of that slowdown, and the 3h-spaced,\nunsampled gaps in between never get evaluated at all - producing a\nregular-looking dip pattern that doesn't represent the real, continuous\ntraffic curve.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap api-gateway-dashboard-panel -n monitoring -o yaml` - the panel has a hardcoded `interval`. How does that compare to the `[5m]` range inside the `rate()` call itself?",
    "`kubectl get configmap promql-step-aliasing-notes -n monitoring -o yaml` - what's actually happening to api-gateway every 3 hours, and does the query's evaluation cadence happen to land near it?",
    "A query evaluated only once every 3 hours, using a `rate()` window covering just 5 of those 180 minutes, only ever samples a tiny fraction of what's really happening - if something short and periodic happens to fall inside that narrow sampled slice consistently, the graph shows a pattern that isn't representative of the continuous underlying signal at all.",
  ],
  options: [
    {
      id: "coarse-step-samples-periodic-batch-job",
      label:
        "The panel's query is hardcoded to a 3-hour evaluation step against a `rate(...[5m])` window, so it only ever samples a narrow 5-minute slice out of every 180 minutes - and api-gateway's own 3-hourly internal batch job (which briefly slows request handling for about 4 minutes but doesn't reduce real traffic volume) happens to land inside that narrow sampled slice consistently, producing a misleadingly regular dip pattern that isn't representative of the real, continuous, smooth traffic curve the load balancer's own logs confirm.",
      explanation:
        "`api-gateway-dashboard-panel` shows the hardcoded `interval: 3h` against a `[5m]` rate window - evaluating a tiny fraction of the full time range. `promql-step-aliasing-notes` explains the mechanism: a 3-hourly internal batch job briefly slows request handling, and when the query's 3-hour-spaced evaluation instants happen to land near that recurring event, the sampled 5-minute windows keep catching its tail, producing an artificial, regular-looking pattern with no visibility into the smooth traffic in between - exactly matching why zooming into any single dip at full resolution shows normal, smooth underlying traffic, and why the load balancer's independent access-log rate shows no such dips at all.",
    },
    {
      id: "internal-batch-job-genuinely-degrading-traffic",
      label: "The internal batch job genuinely reduces real request throughput every time it runs, and this is a real, recurring capacity problem.",
      explanation:
        "The load balancer's own independent, access-log-based rate is confirmed smooth with no periodic dips, and zooming into any single dip at full resolution shows normal traffic - both directly contradict a real, sustained throughput reduction. The dip is an artifact of how sparsely the panel samples the data, not a genuine drop in served traffic.",
    },
    {
      id: "prometheus-scrape-gaps-every-3-hours",
      label: "Prometheus is failing to scrape api-gateway for a few minutes every 3 hours.",
      explanation:
        "If scrapes were genuinely failing periodically, that would show as gaps or `up{}` drops at the scrape layer itself, not a smooth-looking dip pattern in a rate calculation - and zooming into full resolution shows continuous, unbroken underlying data, which rules out actual missing scrapes.",
    },
    {
      id: "gateway-requests-total-counter-resets",
      label: "The `gateway_requests_total` counter is resetting periodically, which `rate()` is misinterpreting.",
      explanation:
        "A counter reset would show up consistently regardless of the query's evaluation interval, including at full zoom resolution - but the dip pattern specifically only appears at the coarse 30-day view and vanishes when zoomed into a single dip, which points at a sampling/step artifact rather than a real discontinuity in the counter itself.",
    },
  ],
  correctOptionId: "coarse-step-samples-periodic-batch-job",
  resolution: `\`api-gateway-dashboard-panel\` shows the panel's query has a hardcoded
\`interval: 3h\` while its \`rate()\` call still only looks at a \`[5m]\`
window - meaning Prometheus evaluates the expression at one fixed instant
every three hours, using only the 5 minutes immediately before that
instant, and simply connects the resulting points with a line. The other
175 minutes between each evaluation are never sampled at all.
\`promql-step-aliasing-notes\` explains what's landing in that narrow
sampled slice: api-gateway runs a lightweight internal batch job every 3
hours that briefly slows request handling (without reducing real traffic
volume) for about 4 minutes - and the query's 3-hour-spaced evaluation
instants happen to consistently fall near enough to that recurring event
to catch its tail in the sampled 5-minute window, over and over,
producing a mechanically regular-looking dip pattern. It's a classic
aliasing artifact: sampling a periodic underlying signal at a rate too
coarse (and too conveniently synchronized) to represent it faithfully,
the same phenomenon that makes a fast-spinning wheel look like it's
turning slowly (or backwards) in a low-frame-rate video.

The load balancer's own smooth, gap-free access-log-based rate, and the
fact that zooming into any single dip at full resolution shows nothing
unusual, both confirm the real underlying traffic never actually pulses
like this - only the sparsely-sampled query does.

The fix is letting the panel's step interval scale naturally with the
time range instead of pinning it, so a 30-day view samples densely enough
to represent the real curve:

\`\`\`json
{
  "targets": [{ "expr": "sum(rate(gateway_requests_total[5m]))" }]
}
\`\`\`

(removing the hardcoded \`interval\` field entirely lets Grafana's
\`$__interval\` auto-scale the step to the panel width and time range).
Hardcoded step intervals are worth treating with suspicion on any panel
meant to be viewed across a wide range of zoom levels - what looks fine
zoomed in can alias into something misleading zoomed all the way out.`,
};
