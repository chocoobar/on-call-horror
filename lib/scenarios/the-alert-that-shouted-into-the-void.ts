import type { Scenario } from "./types";

export const theAlertThatShoutedIntoTheVoid: Scenario = {
  id: "the-alert-that-shouted-into-the-void",
  title: "The Alert That Shouted Into The Void",
  subtitle: "a critical alert for session-store has been firing in Alertmanager for three hours, paging nobody",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["alertmanager", "pagerduty", "webhook"],
  briefing: `"session-store" has been degraded for three hours, and the corresponding
critical alert is confirmed firing in the Alertmanager UI the entire
time, correctly routed to the right team's PagerDuty receiver according
to the routing tree. Nobody on that team's phone has made a sound.`,
  constraints: [
    "The alert's route, receiver, and label matching are all confirmed correctly configured - this isn't a routing tree problem.",
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
              "receivers:\n  - name: session-team-pagerduty\n    pagerduty_configs:\n      - service_key: 'a1b2c3d4e5f6REDACTED'\n        # NOTE: this integration key was for session-store's old PagerDuty\n        # service, which was deleted and replaced during a PagerDuty\n        # services reorganization 6 weeks ago. A new service and\n        # integration key were created, but Alertmanager's config was\n        # never updated to use it.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pagerduty-integration-audit", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "PagerDuty integration keys are tied to a specific *service* within\nPagerDuty. Deleting and recreating a service (rather than renaming the\nexisting one) always generates a brand-new integration key - the old key\nsimply stops resolving to anything and PagerDuty's Events API silently\nreturns a generic error for events sent with it, without any\nAlertmanager-visible failure beyond its own delivery-attempt logs.\n",
          },
        },
        age: "6w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alertmanager-delivery-log-excerpt", namespace: "monitoring" },
        spec: {
          data: {
            "notification-log.md":
              "notify.pagerduty: notify retry canceled after 3 attempts: Post\n\"https://events.pagerduty.com/v2/enqueue\": context deadline exceeded\n(repeated hourly since the alert began firing 3 hours ago)\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get configmap alertmanager-config -n monitoring -o yaml` - is the PagerDuty integration key still valid for a service that actually exists?",
    "`kubectl get configmap pagerduty-integration-audit -n monitoring -o yaml` - what happened to session-store's PagerDuty service six weeks ago?",
    "`kubectl get configmap alertmanager-delivery-log-excerpt -n monitoring -o yaml` - is Alertmanager actually succeeding at delivering this notification, or silently failing on every attempt?",
  ],
  options: [
    {
      id: "stale-pagerduty-integration-key",
      label:
        "session-store's PagerDuty service was deleted and recreated during a reorganization six weeks ago, generating a brand-new integration key - Alertmanager's receiver config was never updated with it and still points at the old, now-nonexistent key, so every notification attempt (visible in Alertmanager's own delivery logs as repeated failures) silently fails against PagerDuty's API, even though routing, matching, and the alert itself are all working exactly as configured.",
      explanation:
        "`alertmanager-config`'s own comment confirms the PagerDuty key is stale, left over from a service deleted six weeks ago. `pagerduty-integration-audit` explains that recreating a PagerDuty service always generates a new key, silently orphaning the old one. `alertmanager-delivery-log-excerpt` shows Alertmanager has in fact been trying and failing to deliver this exact notification every hour since the alert began - confirming the alert and its routing worked correctly, and the failure is specifically in the final delivery hop to a service that, under this key, no longer exists.",
    },
    {
      id: "pagerduty-service-outage",
      label: "PagerDuty itself is experiencing a service outage.",
      explanation:
        "There's no indication of a broader PagerDuty outage - the delivery log shows a consistent, specific failure pattern tied to this one integration, and a stale, orphaned integration key left over from a documented service recreation six weeks ago is a much more direct and evidenced explanation.",
    },
    {
      id: "team-phone-do-not-disturb",
      label: "Everyone on the on-call team happened to have Do Not Disturb enabled at the same time.",
      explanation:
        "Alertmanager's own delivery logs show every attempt to reach PagerDuty is failing before it would even get to a phone - a device-level Do Not Disturb setting on multiple people's phones simultaneously wouldn't explain repeated `context deadline exceeded` failures in Alertmanager's own log talking directly to PagerDuty's API.",
    },
    {
      id: "alert-severity-mismatched-escalation-policy",
      label: "PagerDuty's escalation policy for this severity level has no on-call schedule assigned.",
      explanation:
        "This would be a real problem if the notification ever successfully reached PagerDuty's service - but the delivery log shows the notification never gets that far, failing at the API call itself, which points to a broken integration key rather than a downstream escalation policy configuration issue.",
    },
  ],
  correctOptionId: "stale-pagerduty-integration-key",
  resolution: `\`alertmanager-config\`'s own comment traces the root cause: session-store's
PagerDuty service was deleted and recreated as part of a services
reorganization six weeks ago, and \`pagerduty-integration-audit\` confirms
that always generates a brand-new integration key - the old key simply
stops resolving to anything, with PagerDuty's Events API returning a
generic error for any event sent under it, invisible from PagerDuty's own
side. \`alertmanager-delivery-log-excerpt\` shows exactly that happening in
practice: Alertmanager has been retrying delivery of this notification
every hour since the alert started firing three hours ago, and every
single attempt has failed with a timeout against PagerDuty's Events API.
The alert itself, its condition, and its routing to the correct receiver
are all working exactly as intended - the break is the very last hop,
where the receiver's stored integration key points at a service that no
longer exists.

This is exactly the kind of failure that's invisible from inside the
monitoring stack: Prometheus, the alert rule, and Alertmanager's routing
tree all report success right up until the final external API call, which
fails quietly enough that nothing inside the stack itself flags it as
broken - only its own delivery logs show the real story.

The fix is updating the receiver with the current, valid integration key
for session-store's PagerDuty service:

\`\`\`yaml
receivers:
  - name: session-team-pagerduty
    pagerduty_configs:
      - service_key: '<new-integration-key>'
\`\`\`

It's worth adding a synthetic, low-severity "test" alert that fires on a
schedule specifically to verify each notification channel end-to-end -
otherwise a broken integration key can sit undetected until the next real
critical alert needs it.`,
};
