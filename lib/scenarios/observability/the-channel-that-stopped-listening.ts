import type { Scenario } from "../types";

export const theChannelThatStoppedListening: Scenario = {
  id: "the-channel-that-stopped-listening",
  title: "The Channel That Stopped Listening",
  subtitle: "#incidents has been silent for two weeks, which is either great news or a very bad sign",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["alertmanager", "slack", "notifications"],
  briefing: `Someone finally notices that the "#incidents" Slack channel, which
normally gets at least a handful of low-severity alert notifications a
day, has posted nothing at all for two weeks. Nobody remembers things
being unusually quiet operationally - if anything, there was a minor
elevated-latency blip on "media-cdn-origin" just yesterday that should
have generated at least one warning-level notification.`,
  constraints: [
    "Prometheus and Alertmanager are both confirmed healthy and actively evaluating and firing alerts as expected throughout the period.",
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
              "receivers:\n  - name: incidents-slack\n    slack_configs:\n      - api_url: 'https://hooks.slack.com/services/T000/B000/REDACTEDWEBHOOK'\n        channel: '#incidents'\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "slack-workspace-admin-log-excerpt", namespace: "monitoring" },
        spec: {
          data: {
            "admin-log.md":
              "2 weeks ago: workspace security review uninstalled several unused or\nunrecognized Slack apps, including the \"Incoming Webhooks\" app instance\nassociated with the Alertmanager integration - it hadn't been reviewed\nor renamed since it was set up years ago and wasn't recognized as being\nin active use.\n",
          },
        },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alertmanager-notify-log-excerpt", namespace: "monitoring" },
        spec: {
          data: {
            "notify-log.md":
              "notify.slack: notify retry canceled after 3 attempts: unexpected status\ncode 404: {\"error\":\"channel_not_found\"} (recurring, first seen 2 weeks\nago, most recent: media-cdn-origin LatencyWarning, yesterday)\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap alertmanager-notify-log-excerpt -n monitoring -o yaml` - is Alertmanager actually attempting to deliver to Slack, and what's the actual response it's getting back?",
    "`kubectl get configmap slack-workspace-admin-log-excerpt -n monitoring -o yaml` - did anything change in the Slack workspace itself around two weeks ago?",
    "A webhook URL tied to a specific installed Slack app stops working the moment that app is uninstalled from the workspace - the URL doesn't get disabled gracefully, it just starts returning errors for every future request.",
  ],
  options: [
    {
      id: "slack-app-uninstalled-breaking-webhook",
      label:
        "A workspace security review two weeks ago uninstalled the Slack \"Incoming Webhooks\" app instance backing Alertmanager's `#incidents` integration, not recognizing it as actively in use - the webhook URL stored in Alertmanager's config now returns errors for every delivery attempt, which is confirmed directly in Alertmanager's own notification logs recurring every time an alert has tried to post since, including yesterday's media-cdn-origin warning.",
      explanation:
        "`slack-workspace-admin-log-excerpt` confirms the webhook-backing app was uninstalled during a security review exactly two weeks ago, for not being recognized as in active use. `alertmanager-notify-log-excerpt` shows Alertmanager has been genuinely trying and failing to deliver ever since, including for yesterday's specific media-cdn-origin alert, with the failure mode consistent with a webhook whose backing app no longer exists. Prometheus and Alertmanager themselves are confirmed healthy and firing correctly - the break is entirely in the final delivery hop to a webhook URL that stopped being valid the moment its app was removed.",
    },
    {
      id: "genuinely-quiet-period",
      label: "Operations have genuinely been unusually quiet for two weeks, and this is simply a healthy stretch.",
      explanation:
        "There was a minor elevated-latency blip on media-cdn-origin just yesterday that should have generated at least a warning-level notification - and Alertmanager's own logs confirm it tried and failed to deliver one for exactly that alert, which rules out this being a genuinely uneventful period rather than a broken notification channel.",
    },
    {
      id: "alertmanager-routing-changed-away-from-slack",
      label: "Alertmanager's routing tree was changed to stop sending anything to the Slack receiver.",
      explanation:
        "The notification log shows Alertmanager is still actively attempting delivery to this specific Slack receiver - the alert is being correctly routed to it and an attempt is being made every time, which rules out a routing tree change; the failure happens after routing, at the actual Slack API call.",
    },
    {
      id: "slack-rate-limiting-alertmanager",
      label: "Slack is rate-limiting Alertmanager's requests due to too many notifications.",
      explanation:
        "The notification log shows a `404 channel_not_found`-style error, not a rate-limit response - and the described volume (a handful of alerts a day) wouldn't typically approach Slack's webhook rate limits. The error is specific to the webhook/channel no longer resolving, consistent with the app being uninstalled.",
    },
  ],
  correctOptionId: "slack-app-uninstalled-breaking-webhook",
  resolution: `\`slack-workspace-admin-log-excerpt\` shows a workspace security review two
weeks ago uninstalled several Slack apps that weren't recognized as
actively in use, including the "Incoming Webhooks" app instance backing
Alertmanager's \`#incidents\` integration - it hadn't been renamed or
documented as belonging to the monitoring stack, so nobody doing the
review connected it to anything important. \`alertmanager-notify-log-excerpt\`
confirms the practical effect: every delivery attempt since then,
including yesterday's for the media-cdn-origin latency warning, has
failed with an error consistent with the webhook's backing app no longer
existing. Prometheus and Alertmanager are both confirmed healthy and
firing alerts correctly the entire time - the break is entirely at the
final hop, posting to a webhook URL that stopped being valid the instant
its app was removed from the workspace.

A Slack incoming-webhook URL doesn't fail gracefully or notify anyone
when its backing app is removed - it just starts silently returning
errors to whoever's still trying to use it, which is exactly why this
went unnoticed for two weeks: nothing about the monitoring stack itself
looked unhealthy, and Slack gave no signal on its end either.

The fix is reinstalling the Incoming Webhooks integration for
\`#incidents\` and updating Alertmanager's config with the new webhook URL:

\`\`\`yaml
receivers:
  - name: incidents-slack
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/<new-webhook-url>'
        channel: '#incidents'
\`\`\`

Renaming integration-owning Slack apps to clearly reference what they
back ("Alertmanager - #incidents", not a generic default name) and adding
a scheduled low-severity test alert both help catch this kind of silent
breakage before a real incident needs the channel and finds it empty.`,
};
