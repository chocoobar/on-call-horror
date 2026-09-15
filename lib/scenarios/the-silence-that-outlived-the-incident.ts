import type { Scenario } from "./types";

export const theSilenceThatOutlivedTheIncident: Scenario = {
  id: "the-silence-that-outlived-the-incident",
  title: "The Silence That Outlived The Incident",
  subtitle: "recommendation-engine has been unhealthy for two days and nobody got paged",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["alertmanager", "silence", "paging"],
  briefing: `"recommendation-engine" has been returning elevated 500s for two days -
confirmed in its own logs and in downstream error rates - but nobody was
ever paged. The alert rule is confirmed correctly configured and would
normally fire for exactly this condition. Alertmanager itself is healthy
and reachable.`,
  constraints: [
    "The alert rule's PromQL condition is confirmed to be true for the entire two-day window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-engine", namespace: "recommendations", labels: { app: "recommendation-engine" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alertmanager-silences-snapshot", namespace: "monitoring" },
        spec: {
          data: {
            "silences.json":
              '[\n  {\n    "id": "a1b2c3",\n    "matchers": [{"name":"service","value":"recommendation-engine","isRegex":false}],\n    "startsAt": "2026-09-08T09:00:00Z",\n    "endsAt": "2026-09-20T09:00:00Z",\n    "createdBy": "j.alvarez",\n    "comment": "silencing HighErrorRate during planned maintenance window for cache migration - remove after Sept 8 maintenance completes"\n  }\n]',
          },
        },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "maintenance-log", namespace: "recommendations" },
        spec: {
          data: {
            "log.md":
              "2026-09-08: cache migration maintenance window, completed successfully\nsame day, ~2 hours. recommendation-engine's real elevated error rate\nstarted independently on 2026-09-13, five days after the migration\nfinished, unrelated to it.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap alertmanager-silences-snapshot -n monitoring -o yaml` - is there an active silence matching recommendation-engine right now, and when is it actually set to expire?",
    "`kubectl get configmap maintenance-log -n recommendations -o yaml` - compare the silence's end date to when the maintenance it was meant to cover actually finished.",
    "A silence matching a service's alerts doesn't care whether the condition it's suppressing is 'the planned thing' or 'a completely unrelated real incident' - it suppresses everything matching, for as long as it's active.",
  ],
  options: [
    {
      id: "stale-silence-still-active",
      label:
        "A silence created for a planned cache-migration maintenance window on Sept 8 was set to expire Sept 20 instead of right after the (few-hour) maintenance finished - it's still active, and it matches on `service: recommendation-engine` with no distinction for cause, so it's been suppressing the real, unrelated HighErrorRate alert that started firing on Sept 13 the entire time.",
      explanation:
        "`alertmanager-silences-snapshot` shows a silence matching `service: recommendation-engine`, created for the Sept 8 maintenance, but set to expire Sept 20 - twelve days later. `maintenance-log` confirms the maintenance itself finished the same day it started, and that the real elevated error rate began independently five days after that, on Sept 13, well within the silence's still-active window. The silence doesn't distinguish between 'the alert we expected during maintenance' and 'a real new incident' - it just matches the label and suppresses whatever fires while it's active.",
    },
    {
      id: "alert-rule-disabled",
      label: "The HighErrorRate alert rule itself was accidentally disabled or deleted.",
      explanation:
        "The scenario confirms the alert rule is correctly configured and its condition has been true the entire window - the rule itself is firing exactly as designed. The issue is what happens to that firing alert after it reaches Alertmanager, not whether it fires.",
    },
    {
      id: "alertmanager-down",
      label: "Alertmanager itself has been down or unreachable for the past two days.",
      explanation:
        "Alertmanager is confirmed healthy and reachable - the alert is very likely reaching it and being correctly evaluated against active silences, it's just being matched and suppressed by one rather than failing to arrive at all.",
    },
    {
      id: "notification-channel-broken",
      label: "The PagerDuty or Slack notification channel for this alert is broken.",
      explanation:
        "A broken notification channel would still show the alert as firing (and un-silenced) in the Alertmanager UI, just failing to deliver. Here the far more direct evidence is a silence whose match and time window line up exactly with the alert going unpaged.",
    },
  ],
  correctOptionId: "stale-silence-still-active",
  resolution: `\`alertmanager-silences-snapshot\` shows an active silence matching
\`service: recommendation-engine\`, created on Sept 8 by \`j.alvarez\` with a
comment explaining it was meant to cover a planned cache-migration
maintenance window - but its \`endsAt\` is set to Sept 20, twelve days after
it was created. \`maintenance-log\` confirms the actual maintenance finished
the same day it started, in about two hours, and that the real, unrelated
elevated error rate began independently five days later on Sept 13 -
comfortably inside the still-active silence window.

A silence doesn't know or care *why* an alert is firing - it just matches
on labels and suppresses anything that fits, for as long as it's active.
Whoever created this one to cover a few hours of expected noise during
maintenance set its expiry for a date far past that, and nobody thought
to remove it once the maintenance itself completed. Two days into a real
incident, the alert has been firing correctly and reaching Alertmanager
correctly the entire time - it's just been getting silently matched and
suppressed by a leftover silence with nothing to do with the current
problem.

The fix, immediately, is expiring the stale silence so the real alert can
page:

\`\`\`
amtool silence expire a1b2c3
\`\`\`

Longer term, this is a good case for keeping planned-maintenance silences
scoped as tightly as possible - matching on the specific alertname being
expected, not the whole service, and setting the expiry to just past the
maintenance window itself rather than a generous, easy-to-forget-about
buffer - so a silence created for one afternoon can't quietly eat two
days of a real, unrelated incident.`,
};
