import type { Scenario } from "./types";

export const theExpiredIntegrationKey: Scenario = {
  id: "the-expired-integration-key",
  title: "The Expired Integration Key",
  subtitle: "Grafana-managed alerts for warehouse-api have fired reliably for months, and paged nobody for the last three weeks",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["grafana-alerting", "contact-points", "pagerduty"],
  briefing: `A minor incident on "warehouse-api" got resolved without ever paging
anyone - someone happened to notice the elevated error rate manually.
Checking Grafana's alert rule history shows the alert fired exactly as
expected. The alert's contact point is confirmed correctly attached to
the right notification policy. The page simply never arrived.`,
  constraints: [
    "Grafana's own alerting engine is confirmed healthy, actively evaluating and firing alerts on schedule the entire time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-contact-point-warehouse", namespace: "monitoring" },
        spec: {
          data: {
            "contact-point.json":
              '{\n  "name": "warehouse-team-pagerduty",\n  "type": "pagerduty",\n  "settings": { "integrationKey": "old-key-9f8e7d6c5b4a" }\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pagerduty-migration-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "The warehouse team migrated their on-call management from PagerDuty to\na different provider three weeks ago and deleted their old PagerDuty\nservice as part of decommissioning it - which immediately invalidates any\nintegration key tied to that service. Grafana's contact point for\nwarehouse-api was never updated as part of that migration; whoever ran\nit assumed alert routing lived entirely in the new provider's system,\nnot realizing Grafana's own alerting engine (used for a subset of\nwarehouse-api's alerts, configured independently of the team's general\non-call tooling) still pointed at the old PagerDuty integration\ndirectly.\n",
          },
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-notification-history", namespace: "monitoring" },
        spec: {
          data: {
            "history.md":
              "Notification delivery attempts to `warehouse-team-pagerduty` for the\npast 3 weeks: 100% failed, error `\"Events API v2: integration key not\nfound or service deleted\"`.\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap grafana-notification-history -n monitoring -o yaml` - is Grafana actually attempting delivery, and what error is it getting back?",
    "`kubectl get configmap pagerduty-migration-notes -n monitoring -o yaml` - did anything change about warehouse-api's PagerDuty setup recently, and did Grafana's contact point get updated along with it?",
    "A team migrating their general on-call tooling doesn't necessarily know about every place an old integration key is still directly configured - Grafana-managed alert rules can live entirely outside the team's main on-call system.",
  ],
  options: [
    {
      id: "grafana-contact-point-still-uses-deleted-pagerduty-key",
      label:
        "The warehouse team migrated their on-call management off PagerDuty and deleted the old PagerDuty service three weeks ago, but Grafana's own alerting contact point - configured independently of the team's general on-call tooling - was never updated and still holds the old, now-invalid integration key, so every notification attempt since has failed at the PagerDuty API with an 'integration key not found' error, confirmed directly in Grafana's own notification history, even though the alert itself and its routing to the contact point both work correctly.",
      explanation:
        "`pagerduty-migration-notes` confirms the old PagerDuty service was deleted during a migration three weeks ago, and that Grafana's contact point - independent of the team's main on-call tooling - was never updated as part of it. `grafana-contact-point-warehouse` still shows the old integration key. `grafana-notification-history` directly confirms every delivery attempt for the past three weeks has failed with an error matching a deleted/invalid integration key - the alert rule and routing both worked, and the failure is isolated to the final external delivery hop using a key that no longer resolves to anything.",
    },
    {
      id: "grafana-alert-rule-silently-disabled",
      label: "The alert rule for warehouse-api was silently disabled at some point.",
      explanation:
        "The scenario confirms Grafana's alert rule history shows the alert fired exactly as expected during the incident - the rule is active and evaluating correctly; the break happens downstream of firing, at the notification delivery stage to a contact point using an invalid key.",
    },
    {
      id: "notification-policy-misrouted",
      label: "The notification policy routes this alert to the wrong contact point entirely.",
      explanation:
        "The scenario confirms the contact point is correctly attached to the right notification policy - routing itself is correct. Grafana's own notification history shows delivery attempts are actually being made to the intended contact point; they're simply failing once they reach PagerDuty's API.",
    },
    {
      id: "warehouse-api-error-rate-too-low-for-threshold",
      label: "The elevated error rate never actually crossed the alert rule's configured threshold.",
      explanation:
        "This is directly contradicted - Grafana's alert rule history confirms the alert fired exactly as expected during the incident, meaning the condition was genuinely met and evaluated correctly; the failure is entirely in what happened after the alert fired, not in whether it should have fired at all.",
    },
  ],
  correctOptionId: "grafana-contact-point-still-uses-deleted-pagerduty-key",
  resolution: `\`pagerduty-migration-notes\` explains what happened: the warehouse team
migrated their on-call management to a different provider three weeks
ago and deleted their old PagerDuty service as part of decommissioning
it - which immediately invalidates any integration key still pointing at
it. Nobody realized Grafana's own alerting engine, used for a subset of
warehouse-api's alerts and configured independently of the team's general
on-call tooling, still had a contact point directly wired to that old
PagerDuty integration. \`grafana-contact-point-warehouse\` confirms the
contact point still holds \`old-key-9f8e7d6c5b4a\`, unchanged since before
the migration. \`grafana-notification-history\` confirms the practical
result: every single delivery attempt for the past three weeks has failed
with an "integration key not found or service deleted" error straight
from PagerDuty's Events API. The alert rule itself fired exactly on
schedule and routed correctly to this contact point the entire time - the
break is entirely in the final hop, talking to a PagerDuty integration
that stopped existing three weeks ago.

This is a common gap during any on-call tooling migration: alert routing
configured in more than one place (a team's central on-call system, and
separately, individual tools like Grafana's own alerting engine that can
independently hold notification config) means a migration has to be
tracked down and updated everywhere it lives, not just in the primary
system everyone thinks of first.

The fix is updating the contact point with a valid integration for
wherever warehouse-api's alerts should now actually be delivered:

\`\`\`json
{
  "name": "warehouse-team-pagerduty",
  "type": "pagerduty",
  "settings": { "integrationKey": "<new-key-or-different-provider>" }
}
\`\`\`

After any on-call tooling migration, it's worth explicitly auditing every
system capable of sending its own notifications directly - Grafana
alerting, any other tool with its own contact points - rather than
assuming the migration's primary system is the only place routing lived.`,
};
