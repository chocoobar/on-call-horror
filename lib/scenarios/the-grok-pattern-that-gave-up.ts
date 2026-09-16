import type { Scenario } from "./types";

export const theGrokPatternThatGaveUp: Scenario = {
  id: "the-grok-pattern-that-gave-up",
  title: "The Grok Pattern That Gave Up",
  subtitle: "the daily failed-login dashboard for auth-gateway has read suspiciously low numbers since a routine log-format tweak",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["logstash", "grok", "elasticsearch"],
  briefing: `Security asked why the "Failed Logins" dashboard for "auth-gateway"
suddenly shows about a third of its usual daily count, starting the same
day a minor log-format tweak shipped to add a request-ID prefix to every
line. Nobody flagged it as a problem at the time - the deploy looked
completely uneventful.`,
  constraints: [
    "auth-gateway's raw stdout logs, checked directly, show the expected full volume of failed-login lines every day, unchanged.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "auth-gateway", namespace: "auth", labels: { app: "auth-gateway" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "logstash-grok-filter", namespace: "logging" },
        spec: {
          data: {
            "auth-gateway.conf":
              'filter {\n  grok {\n    match => { "message" => "%{TIMESTAMP_ISO8601:ts} %{LOGLEVEL:level} %{GREEDYDATA:msg}" }\n    tag_on_failure => ["_grokparsefailure"]\n  }\n}\n# NOTE: pattern expects the line to start directly with a timestamp.\n# It has not been updated since auth-gateway added a "[req-abc123]"\n# request-ID prefix before the timestamp on every log line eight days ago.',
          },
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grok-failure-stats", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "Documents tagged `_grokparsefailure` are still indexed into Elasticsearch\n(Logstash doesn't drop them outright) but with none of the structured\nfields (`level`, `msg`) the grok pattern was supposed to extract - only\nthe raw `message` string survives intact. The \"Failed Logins\" dashboard\npanel queries specifically on the structured field `level:ERROR AND\nmsg:\"failed login\"`, which only exists on documents where the grok match\nsucceeded. Roughly two-thirds of auth-gateway's log lines now start with\nthe new `[req-abc123]` prefix (added incrementally per-endpoint over the\npast week, not deployed all at once) and fail this grok pattern; the\nremaining third are from endpoints not yet migrated to the new prefix\nformat and still match correctly.\n",
          },
        },
        age: "8d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap logstash-grok-filter -n logging -o yaml` - what does this grok pattern expect at the very start of a log line, and has auth-gateway's actual line format changed recently?",
    "`kubectl get configmap grok-failure-stats -n logging -o yaml` - what happens to a document when its grok match fails, and does the \"Failed Logins\" panel's query actually depend on fields that only exist when the match succeeds?",
    "A grok parse failure doesn't drop the log line from Elasticsearch entirely - it just fails to extract the structured fields a dashboard query might be relying on, leaving the raw message intact but effectively invisible to any query built around those fields.",
  ],
  options: [
    {
      id: "grok-pattern-doesnt-match-new-prefix",
      label:
        "auth-gateway added a `[req-abc123]` request-ID prefix before the timestamp on log lines eight days ago, rolled out incrementally per-endpoint - the Logstash grok pattern still expects a line to start directly with the timestamp, so roughly two-thirds of lines (from migrated endpoints) now fail the match and get tagged `_grokparsefailure`, losing the structured `level`/`msg` fields the dashboard's query depends on, while still being indexed with their raw message intact - which is why the dashboard undercounts by roughly the same fraction while the raw logs themselves stay complete.",
      explanation:
        "`logstash-grok-filter` shows the pattern expects a timestamp at the very start of the line and hasn't been updated for the new request-ID prefix added eight days ago - matching the timing of the dashboard's drop. `grok-failure-stats` confirms failed-match documents are still indexed but without the structured fields the panel's query (`level:ERROR AND msg:\"failed login\"`) depends on, and that the incremental per-endpoint rollout explains the roughly-two-thirds-affected, one-third-still-working split seen in the numbers - consistent with auth-gateway's raw stdout logs, checked directly, showing full unchanged volume.",
    },
    {
      id: "auth-gateway-actually-fewer-failed-logins",
      label: "auth-gateway genuinely started rejecting fewer failed login attempts, perhaps due to a security fix.",
      explanation:
        "auth-gateway's raw stdout logs, checked directly, are confirmed to show the expected full volume of failed-login lines every day, unchanged - the real event volume never dropped. The undercounting is happening somewhere in the log processing pipeline, after the lines are written but before they're queryable with the expected structured fields.",
    },
    {
      id: "elasticsearch-dropping-a-third-of-documents",
      label: "Elasticsearch is silently dropping roughly a third of incoming documents from auth-gateway.",
      explanation:
        "`grok-failure-stats` confirms documents that fail the grok match are still indexed, not dropped - they just lack the structured fields the dashboard's specific query filters on. The documents exist in Elasticsearch; the dashboard's query simply can't find them without the fields it depends on.",
    },
    {
      id: "dashboard-time-range-misconfigured",
      label: "The dashboard's time range is misconfigured, missing part of each day's data.",
      explanation:
        "There's no evidence of a time-range issue - the drop correlates precisely with the request-ID prefix rollout and the specific structured-field dependency in the panel's query, both independently confirmed, rather than with anything about which time window is being queried.",
    },
  ],
  correctOptionId: "grok-pattern-doesnt-match-new-prefix",
  resolution: `\`logstash-grok-filter\` shows the grok pattern expects a log line to begin
directly with an ISO8601 timestamp - and its own comment flags that it
hasn't been updated since auth-gateway started prefixing lines with
\`[req-abc123]\` eight days ago, matching exactly when the dashboard's
numbers dropped. \`grok-failure-stats\` explains the mechanics: a failed
grok match doesn't drop the document, it just tags it \`_grokparsefailure\`
and indexes it without the structured \`level\`/\`msg\` fields the pattern was
supposed to extract - only the raw \`message\` string survives. The "Failed
Logins" panel's query filters specifically on \`level:ERROR AND
msg:"failed login"\`, fields that only exist on documents where the grok
match succeeded. Since the new prefix rolled out incrementally,
per-endpoint, over the past week rather than all at once, roughly
two-thirds of lines (from migrated endpoints) now fail the match and
become invisible to this query, while the remaining third (from
not-yet-migrated endpoints) still match and still count - exactly the
partial, roughly-one-third-remaining undercount observed, while
auth-gateway's raw stdout stays completely unaffected.

The fix is updating the grok pattern to account for the optional new
prefix:

\`\`\`ruby
filter {
  grok {
    match => { "message" => "(?:\\[%{DATA:request_id}\\] )?%{TIMESTAMP_ISO8601:ts} %{LOGLEVEL:level} %{GREEDYDATA:msg}" }
    tag_on_failure => ["_grokparsefailure"]
  }
}
\`\`\`

It's also worth adding an alert on the rate of \`_grokparsefailure\`-tagged
documents for high-value log sources like this one - a silent, partial
parse failure like this can undercount a security-relevant metric for
days before anyone happens to compare it against the raw source and
notices the gap.`,
};
