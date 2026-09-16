import type { Scenario } from "./types";

export const theNotificationOnTheWrongEvent: Scenario = {
  id: "the-notification-on-the-wrong-event",
  title: "The Notification on the Wrong Event",
  subtitle: "the deploy channel gets a message for literally every sync, successful or not",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "notifications", "triggers"],
  briefing: `The "#deploys" Slack channel is supposed to only get pinged when a
production deploy actually fails, so the team can react quickly. Instead
it gets a message for every single sync across every Application on the
cluster - successful routine deploys included - and the team has started
muting the channel entirely, which means the failure alerts they actually
need are now also being missed.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-notifications-cm", namespace: "argocd" },
        spec: {
          data: {
            "trigger.on-deploy": "- when: app.status.operationState.phase in ['Succeeded', 'Failed', 'Error']\n  send: [deploy-notification]",
            "template.deploy-notification": "message: |\n  {{.app.metadata.name}} sync finished: {{.app.status.operationState.phase}}",
            "subscriptions": "- recipients:\n    - slack:deploys\n  triggers:\n    - on-deploy\n",
            "notes.md":
              "The `on-deploy` trigger's `when` condition matches phase 'Succeeded',\n'Failed', AND 'Error' - it was written to catch every possible terminal\nsync outcome, likely without realizing 'Succeeded' would then fire on\nevery single routine, working deploy too. The team's actual intent per\nthe channel's own description ('only failed deploys') would need the\ncondition to only match 'Failed' and 'Error', not 'Succeeded'.",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap argocd-notifications-cm -n argocd -o yaml` - read the `trigger.on-deploy` condition's `when` clause carefully, phase by phase.",
    "operationState.phase can be several different values - which ones actually represent a failure worth paging on, versus a normal successful deploy?",
    "The subscription wiring itself (which trigger goes to which Slack channel) looks correct - the trigger's own matching condition is what needs narrowing.",
  ],
  options: [
    {
      id: "trigger-condition-includes-succeeded",
      label:
        "The on-deploy trigger's condition matches operationState.phase being 'Succeeded', 'Failed', or 'Error' - all three, including successful deploys - so it fires on every single sync outcome rather than only the failure cases the channel is meant to be reserved for.",
      explanation:
        "`argocd-notifications-cm`'s own notes confirm the `when` clause explicitly includes `'Succeeded'` alongside `'Failed'` and `'Error'` - the trigger was written to catch every terminal phase, not specifically failures. Since almost every sync eventually reaches 'Succeeded', that's exactly why the channel gets pinged on essentially every deploy rather than only the ones that actually went wrong.",
    },
    {
      id: "subscription-wired-to-wrong-channel",
      label: "The subscriptions entry is routing the trigger to the wrong Slack channel entirely.",
      explanation:
        "The subscription correctly routes `on-deploy` to `slack:deploys`, the intended channel - the problem isn't *where* the notification goes, it's *how often* it fires, which is governed by the trigger's own condition, not the subscription's routing.",
    },
    {
      id: "template-rendering-every-app",
      label: "The message template is somehow being rendered and sent once per Application on every reconciliation, not just on sync completion.",
      explanation:
        "The trigger's `when` clause is explicitly scoped to operationState.phase reaching a terminal value - it only evaluates and fires on actual sync completions, not on every reconciliation loop tick. The volume of messages is explained entirely by how many syncs are legitimately completing (including successful ones), not by the template firing outside of real sync events.",
    },
    {
      id: "notifications-controller-duplicate-delivery",
      label: "The notifications controller is delivering each notification multiple times due to a delivery bug.",
      explanation:
        "There's no indication of duplicate delivery of the *same* notification - the volume comes from a large number of genuinely distinct, legitimately-firing notifications (one per sync completion, successful or not), which is explained fully by the trigger condition matching far more outcomes than intended.",
    },
  ],
  correctOptionId: "trigger-condition-includes-succeeded",
  resolution: `\`argocd-notifications-cm\`'s own notes confirm the \`on-deploy\` trigger's
\`when\` clause matches \`operationState.phase\` being \`'Succeeded'\`,
\`'Failed'\`, or \`'Error'\` - all three. It was written to catch every
possible terminal sync outcome, which technically it does, but that
includes the overwhelming majority of syncs that complete completely
normally. Since nearly every deploy across the cluster eventually reaches
'Succeeded', the trigger fires constantly, drowning out the actual
failure signal the channel exists for.

Fix by narrowing the condition to only the outcomes that represent an
actual problem:

\`\`\`yaml
trigger.on-deploy: |
  - when: app.status.operationState.phase in ['Failed', 'Error']
    send: [deploy-notification]
\`\`\`

If successful deploys are still worth tracking somewhere (just not
paging a channel), consider splitting into two triggers with two
different destinations - a low-noise audit log or a separate
"#deploys-all" channel for successes, and "#deploys" reserved strictly
for the failure case:

\`\`\`yaml
trigger.on-deploy-failed: |
  - when: app.status.operationState.phase in ['Failed', 'Error']
    send: [deploy-notification]
trigger.on-deploy-succeeded: |
  - when: app.status.operationState.phase == 'Succeeded'
    send: [deploy-notification]
subscriptions: |
  - recipients: [slack:deploys]
    triggers: [on-deploy-failed]
  - recipients: [slack:deploys-all]
    triggers: [on-deploy-succeeded]
\`\`\`

Once "#deploys" only fires on real failures, it's worth unmuting the
channel - the muting itself was the actual visibility gap that let a
real failure go unnoticed.`,
};
