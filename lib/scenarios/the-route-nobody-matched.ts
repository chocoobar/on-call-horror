import type { Scenario } from "./types";

export const theRouteNobodyMatched: Scenario = {
  id: "the-route-nobody-matched",
  title: "The Route Nobody Matched",
  subtitle: "a critical alert fired for six hours and paged absolutely no one",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["alertmanager", "routing", "paging"],
  briefing: `A "DiskWillFillInFourHours" alert for the "fraud-detection" service fired
in Prometheus and stayed firing for over six hours before someone
noticed the disk had actually filled and the service had degraded. The
alert is confirmed to have reached Alertmanager the whole time - it's
sitting right there in the Alertmanager UI marked "firing." Nobody on the
fraud-detection team, or anyone else, ever got paged.`,
  constraints: [
    "PagerDuty's integration with Alertmanager is confirmed healthy - other alerts routed through it paged correctly during the same window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alertmanager-config", namespace: "monitoring" },
        spec: {
          data: {
            "alertmanager.yml":
              "route:\n  receiver: default-slack\n  group_by: ['alertname']\n  routes:\n    - match:\n        team: payments\n      receiver: payments-pagerduty\n    - match:\n        team: platform\n      receiver: platform-pagerduty\n    - match:\n        team: checkout\n      receiver: checkout-pagerduty\nreceivers:\n  - name: default-slack\n    slack_configs:\n      - channel: '#alerts-noisy'\n  - name: payments-pagerduty\n    pagerduty_configs: [{ service_key: 'REDACTED' }]\n  - name: platform-pagerduty\n    pagerduty_configs: [{ service_key: 'REDACTED' }]\n  - name: checkout-pagerduty\n    pagerduty_configs: [{ service_key: 'REDACTED' }]\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "fraud-detection-alerts", namespace: "fraud-detection" },
        spec: {
          groups: [
            {
              name: "fraud-detection.disk",
              rules: [
                {
                  alert: "DiskWillFillInFourHours",
                  expr: "predict_linear(node_filesystem_free_bytes{job=\"fraud-detection\"}[6h], 4*3600) < 0",
                  labels: { severity: "critical", squad: "fraud-detection" },
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
        metadata: { name: "alertmanager-routing-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "Alertmanager's routing tree matches routes top-down and, by default,\nstops at the *first* route whose `match` conditions are satisfied for a\ngiven alert (unless that route sets `continue: true`). None of the\nnamed team routes match on the label key `squad` - they all match on\n`team`. fraud-detection's alerting rules were written using `squad` as\nthe team-identifying label, following an older internal convention that\npredates the routing tree's `team` convention.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get prometheusrule fraud-detection-alerts -n fraud-detection -o yaml` - what label does this alert actually carry to identify its owning team?",
    "`kubectl get configmap alertmanager-config -n monitoring -o yaml` - what label key does every named route in the routing tree actually match against?",
    "If an alert's labels don't match any specific route's conditions, Alertmanager doesn't error out or warn - it just falls through to whatever the top-level default route is configured to do.",
  ],
  options: [
    {
      id: "label-key-mismatch-falls-to-default-route",
      label:
        "fraud-detection's alert rule labels itself with `squad: fraud-detection`, but every specific route in Alertmanager's routing tree matches on the label key `team`, not `squad` - since nothing matches, the alert silently falls through to the top-level default route, which only posts to a Slack channel, so it never reaches PagerDuty or anyone on-call despite firing correctly the whole time.",
      explanation:
        "`fraud-detection-alerts` labels the alert `squad: fraud-detection`. `alertmanager-config`'s routing tree only defines routes matching on `team: payments`, `team: platform`, and `team: checkout` - no route matches on `squad` at all, and there's no `team` label on this alert either. `alertmanager-routing-notes` confirms this is exactly a legacy label-key mismatch. With no route matching, Alertmanager sends the alert to the default receiver, `default-slack`, posting to `#alerts-noisy` - which, per its own name, is exactly the kind of channel a real six-hour critical alert could sit in unnoticed.",
    },
    {
      id: "pagerduty-integration-broken",
      label: "PagerDuty's integration with Alertmanager silently stopped working.",
      explanation:
        "Other alerts routed through PagerDuty during the same window paged correctly, which rules out a broken integration - the problem is specific to this alert never being routed to a PagerDuty receiver in the first place, not PagerDuty failing to deliver one that was.",
    },
    {
      id: "alert-severity-too-low",
      label: "The alert's `severity: critical` label isn't being read correctly by Alertmanager.",
      explanation:
        "Nothing in the routing tree matches or filters on `severity` at all - every route here matches purely on the team-identifying label, so the alert's severity label plays no role in whether it gets routed to a paging receiver.",
    },
    {
      id: "group-by-suppressing-the-alert",
      label: "The `group_by: ['alertname']` setting is suppressing this specific alert from being delivered.",
      explanation:
        "Grouping controls how multiple matching alerts get batched into one notification - it doesn't prevent an alert from being routed or delivered at all. The alert did reach a receiver (the default Slack one); it just never reached one with PagerDuty attached.",
    },
  ],
  correctOptionId: "label-key-mismatch-falls-to-default-route",
  resolution: `\`fraud-detection-alerts\` labels its alert rule \`squad: fraud-detection\`.
Every specific route defined in \`alertmanager-config\`'s routing tree
matches on the label key \`team\` - \`team: payments\`, \`team: platform\`,
\`team: checkout\` - and none of them match on \`squad\` at all, nor does this
alert carry a \`team\` label for any of them to match against anyway.
\`alertmanager-routing-notes\` confirms this is a legacy naming mismatch:
fraud-detection's rules were written against an older \`squad\` convention
that predates the routing tree's \`team\` convention, and nobody updated one
to match the other.

With no specific route matching, Alertmanager does exactly what it's
designed to do when nothing else applies - it falls through to the
top-level default route, \`default-slack\`, which posts to \`#alerts-noisy\`.
The alert was genuinely firing, genuinely delivered, and genuinely visible
in the Alertmanager UI the entire six hours - it just never reached anyone
positioned to actually act on a critical, time-sensitive page, because the
routing tree had no route built to recognize it as fraud-detection's alert
at all.

The fix is aligning the alert's label with the routing tree's convention
(or adding a route for the legacy one), plus a route specifically for
fraud-detection:

\`\`\`yaml
# fraud-detection-alerts PrometheusRule
labels: { severity: critical, team: fraud-detection }

# alertmanager-config
routes:
  - match: { team: fraud-detection }
    receiver: fraud-detection-pagerduty
\`\`\`

It's also worth auditing what else routes to \`default-slack\` - any alert
landing there by accident, rather than by deliberate design, is a page
that silently never happens.`,
};
