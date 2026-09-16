import type { Scenario } from "./types";

export const theMismatchedScrapeIntervals: Scenario = {
  id: "the-mismatched-scrape-intervals",
  title: "The Mismatched Scrape Intervals",
  subtitle: "billing-reconciler's throughput panel jumped to exactly 3x overnight with no deploy and no alert",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "scrape-interval", "promql"],
  briefing: `The throughput dashboard for "billing-reconciler" shows requests-per-second
tripling overnight, with a suspiciously clean, exact-looking multiplier.
No deploy happened, no scaling event occurred, and downstream systems
that depend on billing-reconciler's actual output show completely normal,
unchanged volume the whole time.`,
  constraints: [
    "billing-reconciler's downstream consumer (a queue) confirms a flat, unchanged message consumption rate across the entire window - real throughput never changed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-reconciler", namespace: "billing", labels: { app: "billing-reconciler" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: { name: "billing-reconciler", namespace: "billing" },
        spec: {
          selector: { matchLabels: { app: "billing-reconciler" } },
          endpoints: [{ port: "metrics", interval: "10s" }],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-global-config", namespace: "monitoring" },
        spec: {
          data: {
            "global.yaml":
              "global:\n  scrape_interval: 30s\n  # NOTE: a platform-wide change last night lowered the *global* default\n  # scrape_interval from 30s down to... wait, actually this stayed the\n  # same. What changed: billing-reconciler's own ServiceMonitor was\n  # updated last night to set `interval: 10s`, down from the previous\n  # 30s, as part of an unrelated effort to get finer-grained data for a\n  # different panel.\n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "billing-reconciler-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Throughput (req/s)",\n  "targets": [{ "expr": "sum(increase(billing_reconciler_requests_total[1m])) / 60" }],\n  "description": "computes rate manually via increase() divided by a fixed 60s, instead of using rate() or scaling with the real interval"\n}',
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get servicemonitor billing-reconciler -n billing -o yaml` - did the scrape interval for this specific target change recently?",
    "`kubectl get configmap billing-reconciler-dashboard-panel -n monitoring -o yaml` - this panel computes throughput manually with `increase(...[1m]) / 60` instead of `rate(...[1m])`. Does that distinction matter here?",
    "`increase()` over `[1m]` returns the total increase across that window, extrapolated from however many actual samples fell inside it - `rate()` divides by the real elapsed time between samples automatically, but a query that instead divides `increase()` by a hardcoded constant assumes a specific, fixed number of samples that may no longer match reality.",
  ],
  options: [
    {
      id: "manual-rate-calc-assumes-old-scrape-interval",
      label:
        "billing-reconciler's ServiceMonitor was changed from a 30s to a 10s scrape interval last night for an unrelated reason, and the dashboard panel computes throughput manually as `increase(...[1m]) / 60` instead of using `rate()` - `increase()`'s extrapolation behavior combined with three times as many real samples now landing in the same 1-minute window changes the computed increase in a way the panel's fixed `/ 60` divisor was never designed to account for, producing a misleading roughly-3x jump with no real change in throughput.",
      explanation:
        "`billing-reconciler` ServiceMonitor shows `interval: 10s`, down from a previous 30s changed the night before, per the platform config's own note. `billing-reconciler-dashboard-panel` shows the panel deliberately avoids `rate()` in favor of a manual `increase(...[1m]) / 60` calculation, which isn't scrape-interval-aware the way `rate()` is - `rate()` normalizes by actual elapsed time between samples automatically, while this hand-rolled version doesn't, so tripling the sample density inside the same window skews the manual calculation exactly the way that produces a misleading multiplier, matching the fact that the downstream queue's real consumption rate never changed.",
    },
    {
      id: "billing-reconciler-genuinely-tripled",
      label: "billing-reconciler genuinely started processing three times as many requests overnight.",
      explanation:
        "The downstream queue's own message consumption rate is confirmed flat and unchanged across the entire window - a genuine 3x increase in real throughput would necessarily also show up as a 3x increase in downstream consumption, which didn't happen.",
    },
    {
      id: "prometheus-double-scraping-after-interval-change",
      label: "Prometheus is now double- or triple-scraping the target due to a configuration reload glitch.",
      explanation:
        "There's no evidence of duplicate scraping - the ServiceMonitor's interval was deliberately and correctly changed to 10s, which is a legitimate, single scrape every 10 seconds, not multiple redundant scrapes. The issue is how the dashboard's manually-computed throughput query interacts with that new, denser sampling.",
    },
    {
      id: "billing-reconciler-restarted-and-reset-counter",
      label: "billing-reconciler's pods restarted overnight, resetting the underlying counter and confusing the calculation.",
      explanation:
        "Both replicas show zero recent restarts and normal uptime - there's no indication of a counter reset here. The evidenced, timing-matched cause is the scrape interval change interacting with the panel's non-`rate()`-based manual calculation.",
    },
  ],
  correctOptionId: "manual-rate-calc-assumes-old-scrape-interval",
  resolution: `\`billing-reconciler\`'s ServiceMonitor shows its scrape \`interval\` was
changed from 30s to 10s the night before the dashboard jump - a
deliberate, unrelated change made to get finer-grained data for a
different panel. \`billing-reconciler-dashboard-panel\` shows the
throughput panel was never built on \`rate()\`, which normalizes by real
elapsed time between samples automatically - instead it computes
\`increase(billing_reconciler_requests_total[1m]) / 60\`, a manual
approximation that implicitly assumes a particular scrape cadence baked
into how \`increase()\`'s extrapolation behaves relative to that hardcoded
divisor. Once the actual scrape interval dropped to a third of what it
was, the relationship between "raw counter increase over this window" and
"true requests per second" shifted in a way the hand-rolled \`/ 60\`
calculation was never built to track - producing a misleadingly clean,
roughly 3x-looking jump on the dashboard with nothing real behind it. The
downstream queue's own, completely independent consumption-rate metric,
confirmed flat the entire time, is the tell that nothing about real
throughput actually changed.

The fix is switching the panel to \`rate()\`, which is specifically designed
to stay correct regardless of the underlying scrape interval:

\`\`\`promql
sum(rate(billing_reconciler_requests_total[1m]))
\`\`\`

Manually reconstructing a rate calculation with \`increase()\` and a
hardcoded time divisor is rarely necessary and rarely safe - \`rate()\`
already does the equivalent calculation correctly and automatically
adapts if the scrape interval ever changes, which is exactly the kind of
quiet infrastructure change (someone tuning a ServiceMonitor for an
unrelated reason) that a hand-rolled formula has no way to know about.`,
};
