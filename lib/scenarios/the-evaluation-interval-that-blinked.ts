import type { Scenario } from "./types";

export const theEvaluationIntervalThatBlinked: Scenario = {
  id: "the-evaluation-interval-that-blinked",
  title: "The Evaluation Interval That Blinked",
  subtitle: "a five-minute error spike on catalog-sync happened and vanished between two alert checks",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["grafana-alerting", "evaluation-interval", "metrics"],
  briefing: `Someone reviewing catalog-sync's raw metrics after a customer complaint
finds a clear, real five-minute spike in error rate a few hours ago -
well above the alert threshold. No alert ever fired. The Grafana-managed
alert rule for catalog-sync's error rate is confirmed enabled and
correctly written, with a `for` duration well under five minutes.`,
  constraints: [
    "The error spike is confirmed real via catalog-sync's own logs and downstream retry metrics for the same five-minute window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "catalog-sync", namespace: "catalog", labels: { app: "catalog-sync" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-alert-rule-catalog-sync", namespace: "monitoring" },
        spec: {
          data: {
            "alert-rule.json":
              '{\n  "title": "catalog-sync high error rate",\n  "condition": "sum(rate(catalog_sync_errors_total[2m])) > 0.1",\n  "for": "1m",\n  "ruleGroup": "catalog-alerts",\n  "evaluationGroupIntervalSeconds": 900\n}',
          },
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "evaluation-interval-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "This alert's rule group (`catalog-alerts`) has its evaluation interval\nset to 900 seconds (15 minutes) - set generously to reduce evaluation\nload on Grafana's alerting engine when the group was created, back when\nit only contained slow-moving, low-urgency rules. `catalog-sync high\nerror rate` was added to this group later, without revisiting the\ngroup's shared 15-minute interval. The real spike lasted 5 minutes -\nentirely between two consecutive 15-minute evaluation checks, so neither\ncheck ever landed during the window when the condition was actually true.\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap grafana-alert-rule-catalog-sync -n monitoring -o yaml` - how often does this alert rule's group actually get evaluated?",
    "`kubectl get configmap evaluation-interval-notes -n monitoring -o yaml` - how does that evaluation interval compare to how long the real spike actually lasted?",
    "An alert rule can only ever notice a condition if an evaluation happens to land while that condition is true - a short-lived spike can start and fully end between two checks that are spaced far enough apart.",
  ],
  options: [
    {
      id: "evaluation-interval-coarser-than-spike-duration",
      label:
        "catalog-sync's alert rule belongs to a rule group with a shared 15-minute evaluation interval - set generously back when the group only held slow-moving rules, then inherited by this rule without adjustment - and the real error spike lasted only 5 minutes, entirely within the gap between two 15-minute evaluation checks, so the alert engine simply never looked at the metric during the one window when the condition was actually true.",
      explanation:
        "`grafana-alert-rule-catalog-sync` shows `evaluationGroupIntervalSeconds: 900` (15 minutes) for this rule's group. `evaluation-interval-notes` confirms that interval was set for an earlier, different set of rules and never revisited when this alert was added, and explicitly states the 5-minute spike fit entirely between two evaluation checks. The alert's condition and `for` duration are both correctly written - the problem is that the evaluation engine only checks every 15 minutes, so a spike shorter than that gap can start and fully resolve completely unseen.",
    },
    {
      id: "for-duration-too-long",
      label: "The alert's `for: 1m` duration is what's suppressing it during a brief spike.",
      explanation:
        "`for: 1m` is comfortably shorter than the real 5-minute spike - if an evaluation had actually landed during the spike, the condition would have had ample time to satisfy a 1-minute `for` duration well before the spike ended. The problem is upstream of `for`: no evaluation ever ran while the condition was true at all.",
    },
    {
      id: "catalog-sync-metric-not-exported",
      label: "catalog-sync isn't actually exporting `catalog_sync_errors_total` correctly.",
      explanation:
        "The spike is independently confirmed real via catalog-sync's own logs and downstream retry metrics for the exact window - the metric itself reflects reality; the issue is that the alert rule's evaluation schedule never happened to sample it during that window.",
    },
    {
      id: "grafana-alerting-engine-down",
      label: "Grafana's alerting engine was down or unresponsive during the spike.",
      explanation:
        "There's no evidence of the alerting engine being unavailable - other alerts in different rule groups with tighter evaluation intervals continued to evaluate normally throughout, which points at this specific group's coarse 15-minute schedule rather than a broader outage of the alerting engine itself.",
    },
  ],
  correctOptionId: "evaluation-interval-coarser-than-spike-duration",
  resolution: `\`grafana-alert-rule-catalog-sync\` shows this alert belongs to a rule group
evaluated every \`900\` seconds - 15 minutes. \`evaluation-interval-notes\`
explains that interval was chosen generously back when the group
contained only slow-moving, low-urgency rules, and was never revisited
when \`catalog-sync high error rate\` was added to the same group later.
The real spike lasted 5 minutes, confirmed independently via
catalog-sync's own logs and downstream retry metrics - comfortably
shorter than the 15-minute gap between consecutive evaluation checks. The
alert's condition and its 1-minute \`for\` duration are both correctly
written and would have caught the spike easily *if an evaluation had ever
run during it* - but with checks spaced 15 minutes apart, it's entirely
possible (and here, exactly what happened) for a short spike to start and
completely resolve in the blind spot between two checks.

This is a coarse-evaluation-interval blind spot rather than any error in
the alert rule's logic itself - the rule was simply grouped with others
that didn't need frequent evaluation, and inherited a schedule too slow
for its own purpose.

The fix is moving this rule into its own group (or an existing group)
with an evaluation interval short enough to reliably catch spikes on the
timescale that actually matters for it:

\`\`\`json
{
  "title": "catalog-sync high error rate",
  "condition": "sum(rate(catalog_sync_errors_total[2m])) > 0.1",
  "for": "1m",
  "ruleGroup": "catalog-fast-alerts",
  "evaluationGroupIntervalSeconds": 60
}
\`\`\`

A shared rule group's evaluation interval should be set to the tightest
requirement of any rule in it, not the loosest - otherwise adding a
fast-moving alert to a slow-moving group quietly caps how quickly it can
ever actually fire.`,
};
