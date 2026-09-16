import type { Scenario } from "../types";

export const theForClauseThatWaitedTooLong: Scenario = {
  id: "the-for-clause-that-waited-too-long",
  title: "The For-Clause That Waited Too Long",
  subtitle: "cart-service went fully down for ninety seconds and nobody got paged",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "alerting", "availability"],
  briefing: `A ninety-second total outage on "cart-service" - every pod returning 503s -
was caught entirely by accident, when someone happened to be actively
testing checkout at the time. The "CartServiceDown" alert rule exists,
is correctly written, and evaluated correctly according to Prometheus's
own rule evaluation history... it just never fired.`,
  constraints: [
    "The outage is independently confirmed via load balancer access logs showing a 90-second window of 100% 503 responses.",
  ],
  world: {
    resources: [
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "cart-service-alerts", namespace: "cart" },
        spec: {
          groups: [
            {
              name: "cart.availability",
              rules: [
                {
                  alert: "CartServiceDown",
                  expr: 'sum(up{job="cart-service"}) == 0',
                  for: "5m",
                  labels: { severity: "critical" },
                },
              ],
            },
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-rule-eval-history", namespace: "monitoring" },
        spec: {
          data: {
            "eval-history.md":
              "`CartServiceDown`'s condition (`sum(up{job=\"cart-service\"}) == 0`) evaluated\nas true continuously from 14:02:10 to 14:03:40 (90 seconds), confirmed\nby the rule's own evaluation timestamps in Prometheus's internal state.\nIt then evaluated false again at 14:03:45 once pods recovered. The alert\nnever transitioned out of the `pending` state into `firing` during that\nwindow.\n",
          },
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alerting-for-clause-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "A Prometheus alert rule's `for:` duration requires the condition to\nremain continuously true for at least that long before the alert\ntransitions from `pending` to `firing` and gets sent to Alertmanager. This\nis meant to avoid paging on brief, self-resolving blips. `CartServiceDown`\nis set to `for: 5m` - originally chosen to match the on-call team's\ngeneral noise-reduction convention, applied uniformly across alert rules\nwithout considering that a *full service outage* is exactly the kind of\ncondition where even a much shorter sustained duration should already be\nurgent.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get prometheusrule cart-service-alerts -n cart -o yaml` - how long does this alert's condition need to stay true before it actually fires?",
    "`kubectl get configmap prometheus-rule-eval-history -n monitoring -o yaml` - how long was the condition actually true for, compared to the `for:` duration required to fire?",
    "An alert stuck in `pending` the whole time it's true, but never reaching `firing` because the outage resolved just before the `for:` duration elapsed, produces zero notifications - even though the underlying condition was completely genuine.",
  ],
  options: [
    {
      id: "for-duration-longer-than-outage",
      label:
        "`CartServiceDown` requires its condition to hold continuously for `for: 5m` before firing, but the actual outage only lasted 90 seconds - the alert sat correctly in the `pending` state the entire time, evaluating true just as it should, but the outage resolved before the 5-minute threshold was reached, so it went back to `inactive` without ever transitioning to `firing` and paging anyone.",
      explanation:
        "`prometheus-rule-eval-history` confirms the condition was true for exactly 90 seconds, well short of the `for: 5m` required by `cart-service-alerts`. `alerting-for-clause-notes` explains the 5-minute value was chosen as a generic noise-reduction convention, not tuned for a full-outage scenario specifically. The alert rule and Prometheus's evaluation both behaved exactly as configured - the config just wasn't shaped to catch a real but short-lived total outage, which is precisely why it never reached `firing` despite the condition being completely genuine.",
    },
    {
      id: "prometheus-missed-evaluations",
      label: "Prometheus missed some rule evaluations during the outage window, breaking the continuity required for `for:`.",
      explanation:
        "`prometheus-rule-eval-history` shows continuous true evaluations across the entire 90-second window with no gaps - the evaluation history is intact and consistent, ruling out missed evaluations as the cause. The alert simply never accumulated enough continuous true time to satisfy the configured `for:` duration.",
    },
    {
      id: "alertmanager-suppressed-the-alert",
      label: "Alertmanager received the alert but suppressed it via routing or inhibition.",
      explanation:
        "The rule evaluation history shows the alert never transitioned out of the `pending` state at all - it never reached `firing`, which means it was never even sent to Alertmanager in the first place. There's nothing for Alertmanager to have suppressed.",
    },
    {
      id: "up-metric-not-reflecting-reality",
      label: "The `up{job=\"cart-service\"}` metric wasn't actually reflecting real pod health during the outage.",
      explanation:
        "The evaluation history confirms the condition (`sum(up{...}) == 0`) was true for the exact duration independently corroborated by load balancer logs showing 100% 503s - the metric tracked reality correctly the whole time; the alert just wasn't configured to fire quickly enough on it.",
    },
  ],
  correctOptionId: "for-duration-longer-than-outage",
  resolution: `\`prometheus-rule-eval-history\` shows \`CartServiceDown\`'s condition,
\`sum(up{job="cart-service"}) == 0\`, evaluated true continuously for
exactly 90 seconds - matching the load balancer logs' independently
confirmed 100%-503 window precisely - before flipping back to false as
pods recovered. \`cart-service-alerts\` requires that condition to hold for
\`for: 5m\` before the alert transitions from \`pending\` to \`firing\` and gets
sent anywhere. Ninety seconds never gets close to five minutes, so the
alert sat correctly in \`pending\` the entire outage and then simply reset,
never firing, never paging anyone - despite the underlying condition
being a completely real, total service outage the whole time.

\`alerting-for-clause-notes\` explains how this happened: \`5m\` was applied
as a blanket noise-reduction convention across alert rules, without
separately considering that some conditions - a full outage being the
clearest example - are urgent enough that even a much shorter sustained
duration should already page, while other, noisier conditions genuinely
benefit from a long \`for:\` to avoid paging on brief blips.

The fix is giving \`CartServiceDown\` a \`for:\` duration proportional to how
urgent total unavailability actually is, rather than the generic
convention:

\`\`\`yaml
- alert: CartServiceDown
  expr: sum(up{job="cart-service"}) == 0
  for: 30s
  labels: { severity: critical }
\`\`\`

\`for:\` durations shouldn't be copy-pasted uniformly across every alert -
they should reflect how much of a genuine, sustained problem is tolerable
before someone needs to know, and "the entire service is down" tolerates
very little of that.`,
};
