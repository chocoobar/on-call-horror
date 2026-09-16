import type { Scenario } from "./types";

export const theCounterThatAppearedToCrash: Scenario = {
  id: "the-counter-that-appeared-to-crash",
  title: "The Counter That Appeared To Crash",
  subtitle: "the total-orders-processed graph for order-worker plunges to zero every time it deploys",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["prometheus", "promql", "counters"],
  briefing: `Every deploy of "order-worker" is immediately followed by a jarring, sharp
drop to zero on its "orders processed" dashboard panel, prompting a wave
of concern each time before it recovers within a minute or two. Nobody's
ever found an actual problem during these drops - orders keep flowing
normally the whole time, based on downstream fulfillment volume.`,
  constraints: [
    "Downstream fulfillment volume, an independent signal, shows no interruption at all during any of these deploy-triggered \"drops.\"",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "order-worker", namespace: "orders", labels: { app: "order-worker" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "order-worker-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Orders Processed (total)",\n  "targets": [{ "expr": "sum(orders_processed_total{job=\\"order-worker\\"})" }]\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "counter-reset-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "`orders_processed_total` is a standard Prometheus counter - it resets to\nzero every time the process that exposes it restarts (a deploy replaces\npods, so each new pod's counter starts fresh at 0). The dashboard panel\nqueries `sum(orders_processed_total{...})` directly - a raw sum of the\ncurrent counter values across all pods, with no `rate()` or `increase()`\nwrapping it. Summing raw counter values across a rolling set of pods,\nsome freshly restarted and reset to near-zero, produces a value that\ndrops sharply immediately after a deploy and then climbs back up as the\nnew pods' counters accumulate again - this is expected counter behavior,\nnot a real interruption in processing.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap order-worker-dashboard-panel -n monitoring -o yaml` - is the panel querying the raw counter value directly, or a rate/increase derived from it?",
    "`kubectl get configmap counter-reset-notes -n monitoring -o yaml` - what happens to a Prometheus counter's value when the process exposing it restarts?",
    "A deploy replaces pods - and a brand-new pod's counter always starts at zero. Summing raw counter values across pods that just restarted looks exactly like a crash, even when nothing actually stopped processing.",
  ],
  options: [
    {
      id: "raw-counter-sum-resets-on-deploy",
      label:
        "The dashboard panel queries `sum(orders_processed_total{...})` as a raw counter value with no `rate()` or `increase()`, and every deploy restarts order-worker's pods, resetting each new pod's counter to zero - the panel's sharp drop is simply the expected, well-known behavior of summing raw counter values across a rolling set of freshly-restarted pods, not any real interruption in order processing, consistent with downstream fulfillment volume showing no gap at all.",
      explanation:
        "`order-worker-dashboard-panel` confirms the query is a plain `sum()` over the raw counter, with no rate-based wrapping. `counter-reset-notes` explains that a Prometheus counter resets to zero on process restart, and that summing raw values across pods mid-rollout produces exactly this kind of sharp apparent drop as new, reset counters temporarily pull the total down before climbing back up - matching the fact that downstream fulfillment volume, an independent and more meaningful signal, shows no actual interruption during any of these events.",
    },
    {
      id: "order-worker-genuinely-drops-orders-on-deploy",
      label: "order-worker genuinely stops processing orders briefly during every deploy due to a rollout timing issue.",
      explanation:
        "Downstream fulfillment volume, an independent signal, shows no interruption at all during these events - if orders were genuinely not being processed for a minute or two on every deploy, that gap would be expected to show up in real downstream volume, which it doesn't.",
    },
    {
      id: "prometheus-scrape-gap-during-rollout",
      label: "Prometheus briefly fails to scrape order-worker's replacement pods during the rollout, causing a data gap.",
      explanation:
        "A scrape gap would typically show as missing data points or a flat/interpolated line, not a sharp, clean drop to zero followed by a climb - the described pattern is specifically consistent with summing genuinely-reset counter values, which is a different (and, per the panel's query, directly evidenced) mechanism.",
    },
    {
      id: "orders-processed-total-metric-misconfigured",
      label: "The `orders_processed_total` metric is misconfigured as a gauge instead of a counter, causing it to reset unexpectedly.",
      explanation:
        "There's no indication the metric type itself is wrong - a counter resetting to zero on process restart is its normal, expected behavior by design, not a sign of misconfiguration. The issue is entirely in how the dashboard panel queries it (a raw sum, rather than a rate-based query robust to resets).",
    },
  ],
  correctOptionId: "raw-counter-sum-resets-on-deploy",
  resolution: `\`order-worker-dashboard-panel\` shows the "Orders Processed" panel queries
\`sum(orders_processed_total{job="order-worker"})\` directly - a raw sum of
the counter's current values, with no \`rate()\` or \`increase()\` involved.
\`counter-reset-notes\` explains exactly what that means during a deploy: a
Prometheus counter always resets to zero when the process exposing it
restarts, and a deploy replaces every pod, so each new pod's counter
starts fresh at zero. Summing raw counter values across a mix of
long-running and freshly-restarted pods produces a temporary dip in the
total - some pods' contributions just dropped to near-zero - that climbs
back up as the new pods accumulate their own counts again. It looks
exactly like a processing outage on a graph, but it's simply how raw
counters behave by design, and downstream fulfillment volume - a signal
that isn't vulnerable to this artifact - confirms nothing actually
stopped.

This is one of the most common PromQL pitfalls: a counter's *raw value*
is rarely the interesting thing to graph directly; what's usually wanted
is the *rate of increase*, which is specifically designed to handle
resets gracefully (treating a reset as a discontinuity to skip over,
rather than a real negative change).

The fix is switching the panel to \`increase()\` (a running or windowed
total that correctly handles counter resets) instead of a raw sum:

\`\`\`promql
sum(increase(orders_processed_total{job="order-worker"}[1h]))
\`\`\`

or, for a genuinely all-time running total unaffected by individual pod
restarts, pairing this with a recording rule that tracks the sum
persistently rather than re-deriving it from live, restart-prone counter
values. Either way, the panel stops mistaking "a pod restarted" for "the
service stopped working."`,
};
