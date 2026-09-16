import type { Scenario } from "../types";

export const theBurnRateThatFlapped: Scenario = {
  id: "the-burn-rate-that-flapped",
  title: "The Burn-Rate That Flapped",
  subtitle: "the SLO alert for recommendation-api fires and resolves every ten minutes, all day",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["slo", "prometheus", "alerting"],
  briefing: `"recommendation-api"'s error-budget-burn-rate alert has been flapping -
firing, resolving, firing again - roughly every ten minutes for the past
day, despite the service's actual error rate being low and genuinely
stable the entire time. Every page gets investigated and turns out to be
nothing; the on-call rotation is exhausted and starting to reflexively
ignore it, which is exactly the failure mode SLO burn-rate alerting is
supposed to prevent.`,
  constraints: [
    "recommendation-api's real error rate, independently graphed, sits flat around 0.15% all day - well under its 1% SLO threshold the entire time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "recommendation-api-slo-burn-rate", namespace: "recommendations" },
        spec: {
          groups: [
            {
              name: "recommendation-api.slo",
              rules: [
                {
                  alert: "ErrorBudgetBurnRateHigh",
                  expr:
                    '(\n  sum(rate(recommendation_api_requests_total{code=~"5.."}[5m])) / sum(rate(recommendation_api_requests_total[5m])) > 14.4 * 0.01\n)\nand\n(\n  sum(rate(recommendation_api_requests_total{code=~"5.."}[1h])) / sum(rate(recommendation_api_requests_total[1h])) > 14.4 * 0.01\n)',
                  for: "2m",
                  labels: { severity: "page" },
                },
              ],
            },
          ],
        },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "slo-burn-rate-design-notes", namespace: "recommendations" },
        spec: {
          data: {
            "notes.md":
              "This is meant to be a standard Google SRE-style multi-window burn-rate\nalert: a short window (fast to trigger, fast to reset) combined with a\nlong window (confirms the burn rate is sustained, not a blip), both\nrequired to be simultaneously true - normally 5m short-window paired with\na proportionally much longer window like 1h *and* a matching long `for:`\non the long-window side, or a separate longer-window alert entirely, to\nactually confirm sustained burn. Here, both windows use the *same* 14.4x\nthreshold, and the short window especially is highly sensitive to brief,\nnormal noise: `recommendation_api_requests_total` has relatively low\nraw volume in any single 5-minute slice, so a handful of transient 5xxs\nfrom ordinary pod restarts or scaling events is enough to spike the\nshort window's ratio over threshold for a few minutes at a time, even\nwhile the 1h window and the real, aggregate daily error rate both stay\nwell under 1%.\n",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get prometheusrule recommendation-api-slo-burn-rate -n recommendations -o yaml` - both the short and long window use the exact same threshold and `for:` duration. Is that how multi-window burn-rate alerting is normally supposed to work?",
    "`kubectl get configmap slo-burn-rate-design-notes -n recommendations -o yaml` - how much raw request volume does the 5-minute window actually have to work with, and how sensitive is a ratio computed over a small sample to a handful of transient errors?",
    "The whole point of pairing a short window with a long one is that the long window should filter out short-lived noise that only the short window reacts to - if both windows are equally twitchy, the long window isn't actually doing that job.",
  ],
  options: [
    {
      id: "short-window-too-noisy-relative-to-volume",
      label:
        "The alert's short (5m) and long (1h) windows both use the same 14.4x threshold and a short, uniform `for: 2m`, with no meaningfully different tolerance between them - the 5-minute window has low enough raw request volume that a handful of transient 5xxs from ordinary pod restarts or scaling events is enough to spike its ratio over threshold repeatedly throughout the day, and because the long window isn't actually configured to filter that noise out the way multi-window burn-rate alerting is meant to, both conditions flap together even though the real, sustained error rate stays well under the SLO the entire time.",
      explanation:
        "`slo-burn-rate-design-notes` explains the two windows use the same threshold with no differentiated `for:` duration meant to confirm sustained burn, and notes the 5-minute window's low raw volume makes it highly sensitive to brief noise. `recommendation-api-slo-burn-rate`'s expression requires both conditions simultaneously, but with the short window flapping easily and nothing distinct making the long window meaningfully harder to trip, the two end up flapping together - consistent with the confirmed flat, low real error rate never actually breaching the SLO in any sustained way.",
    },
    {
      id: "recommendation-api-genuinely-flapping",
      label: "recommendation-api's error rate is genuinely flapping above and below the SLO threshold throughout the day.",
      explanation:
        "recommendation-api's real error rate, independently graphed, is confirmed flat around 0.15% all day - well under the 1% SLO threshold continuously, with no flapping in the real signal. The alert's flapping is a property of the alert's own window/threshold design, not of the underlying reality it's meant to reflect.",
    },
    {
      id: "prometheus-evaluation-flapping",
      label: "Prometheus's rule evaluation itself is unstable, intermittently failing to evaluate the alert condition correctly.",
      explanation:
        "There's no evidence of evaluation instability - the alert is evaluating its expression correctly and consistently against real (if noisy, at short-window granularity) data each time; the issue is the expression's own sensitivity given the request volume and matching thresholds, not unreliable evaluation.",
    },
    {
      id: "alertmanager-grouping-causing-flapping",
      label: "Alertmanager's grouping/repeat-interval settings are causing the same alert to re-fire artificially.",
      explanation:
        "The alert genuinely transitions between firing and resolved states at the Prometheus rule-evaluation level based on its own condition being repeatedly true and then false - Alertmanager's grouping settings control how notifications are batched and re-sent for an alert that's actually still firing, not whether the underlying condition itself flaps.",
    },
  ],
  correctOptionId: "short-window-too-noisy-relative-to-volume",
  resolution: `\`slo-burn-rate-design-notes\` lays out the design flaw directly: this is
meant to be a standard multi-window burn-rate alert, where a fast, noisy
short window is deliberately paired with a slower, more stable long
window that only agrees during a genuinely sustained burn - filtering out
exactly the kind of brief noise the short window alone would react to.
\`recommendation-api-slo-burn-rate\` shows both windows using the identical
\`14.4 * 0.01\` threshold and the same short \`for: 2m\`, with nothing making
the long window meaningfully harder to trip than the short one. Combined
with the 5-minute window's relatively low raw request volume, a handful
of transient 5xxs from something as ordinary as a pod restart or a
scaling event is enough to spike its ratio over threshold for a few
minutes - and because the long window isn't actually doing its intended
filtering job here, it ends up agreeing with the short window's noise
often enough to flap right alongside it, firing and resolving repeatedly
throughout the day, even while the real, aggregate error rate stays flat
and well under the 1% SLO the entire time.

The fix is implementing the multi-window pattern properly - a genuinely
longer, more stable confirmation window with its own appropriately longer
\`for:\`, so only a truly sustained elevated burn rate (not a few minutes of
ordinary noise) can satisfy both conditions together:

\`\`\`yaml
- alert: ErrorBudgetBurnRateHigh
  expr: >
    (sum(rate(recommendation_api_requests_total{code=~"5.."}[5m]))
     / sum(rate(recommendation_api_requests_total[5m])) > 14.4 * 0.01)
    and
    (sum(rate(recommendation_api_requests_total{code=~"5.."}[1h]))
     / sum(rate(recommendation_api_requests_total[1h])) > 14.4 * 0.01)
  for: 5m
- alert: ErrorBudgetBurnRateHigh_Slow
  expr: >
    (sum(rate(recommendation_api_requests_total{code=~"5.."}[30m]))
     / sum(rate(recommendation_api_requests_total[30m])) > 6 * 0.01)
    and
    (sum(rate(recommendation_api_requests_total{code=~"5.."}[6h]))
     / sum(rate(recommendation_api_requests_total[6h])) > 6 * 0.01)
  for: 15m
\`\`\`

Multi-window burn-rate alerting only works as intended when the long
window is actually harder to trip than the short one - matching
thresholds and durations across both windows defeats the entire point of
pairing them, and turns a design meant to reduce noise into one that
doubles down on it.`,
};
