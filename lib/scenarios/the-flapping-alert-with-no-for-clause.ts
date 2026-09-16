import type { Scenario } from "./types";

export const theFlappingAlertWithNoForClause: Scenario = {
  id: "the-flapping-alert-with-no-for-clause",
  title: "The Flapping Alert With No For-Clause",
  subtitle: "on-call gets paged and un-paged for report-exporter roughly every ninety seconds, all night",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["prometheus", "alerting", "for-clause"],
  briefing: `On-call spent last night getting paged, then immediately receiving a
"resolved" notification, then paged again, roughly every ninety seconds,
for "report-exporter" - dozens of times, all night. report-exporter's
actual health, checked in the morning, was fine the entire time: no
sustained outage, no real user impact, just very brief, momentary blips
in its scrape success.`,
  constraints: [
    "report-exporter's pods never crashed or restarted overnight - whatever was happening was extremely brief and self-resolving each time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "report-exporter-alerts", namespace: "reporting" },
        spec: {
          groups: [
            {
              name: "report-exporter.availability",
              rules: [
                {
                  alert: "ReportExporterDown",
                  expr: 'up{job="report-exporter"} == 0',
                  labels: { severity: "critical" },
                  // NOTE: no `for:` field set at all
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
        metadata: { name: "scrape-blip-notes", namespace: "reporting" },
        spec: {
          data: {
            "notes.md":
              "report-exporter runs behind an autoscaling group that briefly\nreshuffles pod-to-node placement roughly every 90 seconds overnight due\nto an unrelated, low-priority batch workload sharing the same nodes and\ncausing brief scheduling churn - each reshuffle causes one or two missed\nscrapes (a few seconds of `up == 0`) before the next scrape succeeds\nagain. This has always happened at a low level; it only started causing\npages once this alert rule was added without a `for:` clause.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get prometheusrule report-exporter-alerts -n reporting -o yaml` - does this alert rule have a `for:` duration set at all?",
    "`kubectl get configmap scrape-blip-notes -n reporting -o yaml` - what's actually causing these brief, self-resolving `up == 0` moments overnight?",
    "Without a `for:` clause, an alert rule fires the instant its condition is true for even a single evaluation - and resolves the instant it's false again, with no requirement that the condition persist for any minimum duration.",
  ],
  options: [
    {
      id: "no-for-clause-fires-on-every-brief-blip",
      label:
        "`ReportExporterDown` has no `for:` clause at all, so it fires immediately on every single evaluation where `up == 0` is momentarily true and resolves immediately once it's true again - report-exporter's nodes experience brief, roughly 90-second scheduling churn from an unrelated batch workload causing a few seconds of missed scrapes each time, and with no minimum duration required before firing, every one of those brief, harmless blips became a full page-and-resolve cycle overnight.",
      explanation:
        "`report-exporter-alerts` confirms no `for:` field is set on this rule, so it fires and resolves immediately with every evaluation rather than requiring the condition to persist. `scrape-blip-notes` confirms the underlying cause is brief, roughly-90-second scheduling churn causing momentary missed scrapes, self-resolving each time - exactly matching the reported page-and-resolve cadence, and confirming report-exporter's pods themselves never actually crashed or had any sustained outage overnight, consistent with an alert rule reacting instantly to noise it was never designed to filter out.",
    },
    {
      id: "report-exporter-genuinely-flapping-down",
      label: "report-exporter genuinely was crashing and restarting repeatedly overnight.",
      explanation:
        "The scenario explicitly confirms report-exporter's pods never crashed or restarted overnight, and its real health the next morning was fine throughout - there was no genuine, sustained outage; the alert reacted to extremely brief, self-resolving scrape blips rather than any real crash-loop.",
    },
    {
      id: "prometheus-scrape-interval-too-aggressive",
      label: "Prometheus's scrape interval for report-exporter is set too aggressively, causing frequent scrape failures.",
      explanation:
        "There's no indication the scrape interval itself is the problem - the missed scrapes are a real, if brief, side effect of node-level scheduling churn from an unrelated workload, not caused by scraping too often. The real issue is that the alert rule has no tolerance configured for exactly this kind of brief, expected noise.",
    },
    {
      id: "alertmanager-notification-repeat-interval-too-short",
      label: "Alertmanager's `repeat_interval` is set too short, causing the same firing alert to re-notify repeatedly.",
      explanation:
        "The pattern described is a full firing-then-resolved cycle roughly every 90 seconds, not one continuously-firing alert re-notifying on a short repeat interval - `repeat_interval` governs re-notification of an alert that's still actively firing, which doesn't match an alert that keeps flipping between firing and resolved.",
    },
  ],
  correctOptionId: "no-for-clause-fires-on-every-brief-blip",
  resolution: `\`report-exporter-alerts\` shows \`ReportExporterDown\`'s expression,
\`up{job="report-exporter"} == 0\`, has no \`for:\` field set at all. Without
one, a Prometheus alert rule transitions straight from \`inactive\` to
\`firing\` the instant its condition is true on a single evaluation - and
back to \`inactive\` the instant it's false again - with no requirement
that the condition hold for any minimum duration first. \`scrape-blip-notes\`
explains what's actually driving those brief \`up == 0\` moments: an
unrelated low-priority batch workload sharing report-exporter's nodes
causes brief scheduling churn roughly every 90 seconds overnight, each
reshuffle costing a scrape or two before the next one succeeds normally
again. This low-level noise has apparently always existed at some level -
it only started generating pages once this particular alert rule was
added without any tolerance for exactly this kind of brief, self-resolving
blip. report-exporter's pods never actually crashed, and its real health
the next morning confirms there was never a genuine, sustained outage -
every page was a real, if momentary and harmless, condition being treated
with the same urgency as a real, sustained outage would deserve.

The fix is adding a `for:` duration long enough to ride out routine,
few-second scrape blips while still catching a genuinely sustained
outage promptly:

\`\`\`yaml
- alert: ReportExporterDown
  expr: up{job="report-exporter"} == 0
  for: 3m
  labels: { severity: critical }
\`\`\`

Any alert rule built around `up{}` or similar binary health signals
should almost always carry a `for:` clause proportional to how much
brief, expected noise the underlying system produces - a bare condition
with no `for:` treats a two-second blip exactly the same as a two-hour
outage, which is rarely the intent.`,
};
