import type { Scenario } from "../types";

export const theAnnotationInTheWrongPlace: Scenario = {
  id: "the-annotation-in-the-wrong-place",
  title: "The Annotation In The Wrong Place",
  subtitle: "the deploy marker on ledger-api's dashboard lines up with nothing, three panels away from where the graph actually moved",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["grafana", "annotations", "deploys"],
  briefing: `An engineer reviewing a latency regression on "ledger-api" keeps trying
to correlate it with a recent deploy, using the vertical deploy-marker
annotation lines on the dashboard - except the marker for today's deploy
sits a full two hours off from when the deploy actually happened
according to the CI/CD system's own timeline, making the correlation
look wrong even though the deploy genuinely was the cause.`,
  constraints: [
    "The CI/CD system's own deploy history timestamps are confirmed accurate and in UTC.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ledger-api", namespace: "ledger", labels: { app: "ledger-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "deploy-annotation-webhook-config", namespace: "monitoring" },
        spec: {
          data: {
            "annotation-pusher.yaml":
              "# Deploy pipeline posts a Grafana annotation on every release via the\n# HTTP Annotations API:\n#   POST /api/annotations\n#   { \"time\": <epoch millis>, \"text\": \"ledger-api deployed v4.2.1\" }\n#\n# NOTE: the pipeline script computes <epoch millis> from\n# `date +%s` * 1000 run on the CI runner - but Grafana's Annotations API\n# expects epoch milliseconds in UTC, and the CI runner's local timezone\n# is set to America/New_York (UTC-4 during daylight saving, as it is\n# now). `date +%s` itself is timezone-agnostic (it always returns true\n# UTC epoch seconds) UNLESS the calling script is instead formatting a\n# local `date` string and parsing *that* back into epoch time assuming\n# it was already UTC - which is what this particular script does.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "deploy-history", namespace: "ledger" },
        spec: {
          data: {
            "history.md":
              "ledger-api v4.2.1 deployed 2026-09-15T18:04:00Z (confirmed via CI/CD\nsystem's own UTC deploy log). Grafana annotation for this deploy was\ncreated with `time` corresponding to 2026-09-15T14:04:00Z - exactly 4\nhours earlier, matching the CI runner's UTC-4 offset at the time.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap deploy-history -n ledger -o yaml` - compare the real deploy time from CI/CD against the timestamp actually attached to the Grafana annotation.",
    "`kubectl get configmap deploy-annotation-webhook-config -n monitoring -o yaml` - how does the deploy pipeline script actually compute the timestamp it sends to Grafana's Annotations API?",
    "Grafana's Annotations API expects a UTC epoch timestamp - if the script that builds it accidentally treats a local-timezone timestamp as if it were already UTC, every annotation lands off by exactly the local UTC offset, consistently.",
  ],
  options: [
    {
      id: "annotation-script-local-time-treated-as-utc",
      label:
        "The deploy pipeline's annotation script formats a local-timezone (America/New_York, UTC-4) timestamp and parses it back into epoch time as if it were already UTC, before posting it to Grafana's Annotations API - every deploy annotation lands exactly 4 hours earlier than the real UTC deploy time, which is why today's marker sits noticeably off from when the deploy (and the resulting latency change) actually happened, even though the deploy genuinely caused it.",
      explanation:
        "`deploy-history` shows the real deploy happened at 18:04 UTC while the annotation was created for 14:04 UTC - exactly a 4-hour offset, matching the CI runner's UTC-4 timezone. `deploy-annotation-webhook-config`'s own note confirms the script formats a local-time string and parses it back assuming it's already UTC, rather than using true UTC epoch time throughout. The consistent, exact 4-hour offset is the signature of a timezone-conversion bug rather than random timestamp drift, and it fully explains why the deploy marker doesn't visually line up with the real latency change despite the deploy being the actual cause.",
    },
    {
      id: "grafana-server-clock-drift",
      label: "Grafana's own server clock has drifted out of sync.",
      explanation:
        "Clock drift on Grafana's server would affect every panel and every data point uniformly, not just deploy annotations specifically - and a drift of exactly 4 hours, matching a known timezone offset precisely, is far more consistent with a timezone-handling bug in the annotation script than with clock drift.",
    },
    {
      id: "ledger-api-latency-regression-unrelated-to-deploy",
      label: "The latency regression is unrelated to the deploy and just coincidentally happened around the same time.",
      explanation:
        "The scenario confirms the deploy genuinely was the cause of the latency change - the difficulty is purely that the annotation marking it visually lands in the wrong place on the timeline, making that true correlation look wrong at a glance, not that the correlation itself is false.",
    },
    {
      id: "grafana-dashboard-timezone-display-setting",
      label: "The Grafana dashboard's own display timezone setting is misconfigured, showing all times shifted.",
      explanation:
        "If the dashboard's display timezone were the issue, every data point and axis label would appear shifted, not just the deploy annotation specifically - and the CI/CD system's own deploy history, confirmed accurate and in UTC, directly shows the annotation's stored timestamp itself is wrong, not merely how it's being displayed.",
    },
  ],
  correctOptionId: "annotation-script-local-time-treated-as-utc",
  resolution: `\`deploy-history\` lines the two timestamps up directly: the real deploy,
per the CI/CD system's own accurate UTC log, happened at 18:04 UTC, while
the Grafana annotation was created for 14:04 UTC - exactly four hours
earlier. \`deploy-annotation-webhook-config\`'s own note explains the bug:
the pipeline script formats a timestamp using the CI runner's local
timezone (America/New_York, UTC-4 during daylight saving) and then parses
that local-time string back into epoch milliseconds as if it were already
UTC, before posting it to Grafana's Annotations API. Grafana's API expects
genuine UTC epoch time throughout - by handing it a UTC-4 local time
mislabeled as UTC, every annotation this script posts lands exactly four
hours earlier than the real event, consistently, matching the runner's
fixed offset. The deploy genuinely caused the latency regression; the
marker meant to show that correlation is just drawn in the wrong place on
the timeline, four hours too early, making a real cause-and-effect
relationship look like a coincidence or a miss.

The fix is having the script compute and send true UTC epoch time
throughout, without ever formatting and re-parsing a local-time string in
between:

\`\`\`bash
# before: local date string parsed back in as if it were UTC
TS=$(date '+%Y-%m-%dT%H:%M:%S')
EPOCH_MS=$(date -d "$TS UTC" +%s%3N)   # wrong: $TS was never UTC

# after: epoch seconds directly, timezone-agnostic by construction
EPOCH_MS=$(($(date +%s) * 1000))
\`\`\`

Any script that builds a timestamp for an API expecting UTC should
compute epoch time directly rather than round-tripping through a
formatted local-time string - the round trip is exactly where a runner's
local timezone can quietly sneak back in.`,
};
