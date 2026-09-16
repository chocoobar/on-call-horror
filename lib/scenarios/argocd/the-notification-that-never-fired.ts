import type { Scenario } from "../types";

export const theNotificationThatNeverFired: Scenario = {
  id: "the-notification-that-never-fired",
  title: "The Notification That Never Fired",
  subtitle: "payments-ledger has been Degraded for two hours and nobody's phone made a sound",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "notifications", "alerting"],
  briefing: `"payments-ledger" went Degraded two hours ago after a bad deploy, and
nobody noticed until a customer complained - even though ArgoCD
Notifications is supposedly wired up to page the on-call channel the
moment any Application's health goes bad. Other Applications' sync
failures have paged correctly in the past.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-notification-that-never-fired",
          namespace: "argocd",
          annotations: { "notifications.argoproj.io/subscribe.on-sync-failed.slack": "payments-oncall" },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/payments-ledger.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "payments" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "9a8b7c6" },
          health: { status: "Degraded" },
        },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-notifications-cm", namespace: "argocd" },
        spec: {
          data: {
            "trigger.on-health-degraded": "- when: app.status.health.status == 'Degraded'\n  send: [app-health-degraded]",
            "template.app-health-degraded": "message: |\n  {{.app.metadata.name}} went Degraded.",
            "notes.md":
              "The `on-health-degraded` trigger and its template both exist correctly in\nthis ConfigMap and fire for every other Application that subscribes to\nthem. payments-ledger's Application manifest only has the annotation\n`notifications.argoproj.io/subscribe.on-sync-failed.slack: payments-oncall`\n- there's no `on-health-degraded` subscription annotation on it at all,\nonly one for sync failures. This deploy's sync itself actually\nsucceeded; only the resulting health went bad.",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get application the-notification-that-never-fired -n argocd -o yaml` - list every `notifications.argoproj.io/subscribe.*` annotation present.",
    "`kubectl get configmap argocd-notifications-cm -n argocd -o yaml` - the trigger and template for health degradation both exist and work for other apps.",
    "This Application's sync itself actually succeeded (status.sync.status is Synced) - only status.health.status is bad. Which specific subscription annotation would need to exist to notify on that?",
  ],
  options: [
    {
      id: "subscribed-to-sync-failed-not-health-degraded",
      label:
        "The Application only subscribes to the `on-sync-failed` notification trigger, not `on-health-degraded` - since this deploy's sync itself actually succeeded and only the resulting health went bad afterward, no subscribed trigger ever matched, so nothing fired.",
      explanation:
        "`argocd-notifications-cm` shows the `on-health-degraded` trigger and template both exist and work correctly for other Applications - the wiring itself isn't broken. This specific Application's annotations only include a subscription to `on-sync-failed`, and its `status.sync.status` really is `Synced` (the deploy applied fine); it's `status.health.status` that's `Degraded`. With no `on-health-degraded` subscription on this Application, that condition being true never triggers a notification for it specifically.",
    },
    {
      id: "notifications-controller-down",
      label: "The argocd-notifications-controller pod is down entirely.",
      explanation:
        "Other Applications' sync failures have paged correctly in the recent past on this same instance, which means the notifications controller itself is running and functioning - the gap here is specific to which trigger this one Application subscribes to, not the controller's overall health.",
    },
    {
      id: "slack-webhook-expired",
      label: "The Slack webhook/token used by ArgoCD Notifications expired.",
      explanation:
        "If the Slack integration itself had failed, every subscribed notification (including sync-failed ones, which have worked recently) would fail to deliver - the issue here is that no matching trigger ever fired for this Application in the first place, not that a fired notification failed to reach Slack.",
    },
    {
      id: "health-check-never-marked-degraded",
      label: "ArgoCD never actually marked the Application as Degraded internally, only in the UI display.",
      explanation:
        "`status.health.status` on the Application object itself is `Degraded` - that's the real, internal status ArgoCD is tracking, not just a display quirk. The notification gap is about which trigger the Application subscribes to, not whether the health status is genuinely recorded.",
    },
  ],
  correctOptionId: "subscribed-to-sync-failed-not-health-degraded",
  resolution: `\`argocd-notifications-cm\` confirms the \`on-health-degraded\` trigger and
its Slack template both exist and are known-working (they fire correctly
for other Applications). The gap is entirely on payments-ledger's own
Application manifest: its only notification subscription annotation is
\`notifications.argoproj.io/subscribe.on-sync-failed.slack\`. This
particular incident's sync genuinely succeeded (\`status.sync.status:
Synced\`) - the bad deploy applied cleanly and only became unhealthy
afterward - so the one trigger this Application listens for never
matched, and nothing was ever sent.

Fix by adding the missing subscription:

\`\`\`yaml
metadata:
  annotations:
    notifications.argoproj.io/subscribe.on-sync-failed.slack: payments-oncall
    notifications.argoproj.io/subscribe.on-health-degraded.slack: payments-oncall
\`\`\`

Worth checking every other Application for the same gap - "notify on sync
failure" and "notify on health degradation" are two genuinely different
trigger conditions, and a deploy that applies cleanly but then goes
unhealthy (a bad readiness probe, a runtime crash, whatever) will only
ever be caught by the second one.`,
};
