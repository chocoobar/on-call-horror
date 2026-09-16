import type { Scenario } from "../types";

export const theRegexThatFellBehind: Scenario = {
  id: "the-regex-that-fell-behind",
  title: "The Regex That Fell Behind",
  subtitle: "a log-based alert for failed-payment-webhook stopped firing the same week its false-positive rate finally hit zero",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["log-based-alerting", "regex", "elk"],
  briefing: `A log-based Watcher alert that pages when "payment-webhook" logs a
delivery failure hasn't fired in two weeks - which felt like good news,
until someone doing an unrelated audit found three genuine, unpaged
delivery failures buried in the raw logs during that exact window. The
alert's query is confirmed to still run successfully on its usual
schedule with no errors.`,
  constraints: [
    "The three unpaged failures are confirmed real - the downstream vendor independently confirms the webhook deliveries genuinely failed at those timestamps.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payment-webhook", namespace: "payments", labels: { app: "payment-webhook" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payment-webhook-3d4e5f6g7-h8i9j", namespace: "payments", labels: { app: "payment-webhook" } },
        logs: {
          "payment-webhook": [
            "2026-09-14T16:02:11.404Z ERROR c.e.payments.WebhookDispatcher - delivery attempt failed status=503 endpoint=vendor-x retries_exhausted=true",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "watcher-failed-webhook-alert", namespace: "logging" },
        spec: {
          data: {
            "watcher.json":
              '{\n  "trigger": { "schedule": { "interval": "5m" } },\n  "input": {\n    "search": {\n      "request": {\n        "body": { "query": { "query_string": { "query": "message:\\"webhook delivery failed permanently\\"" } } }\n      }\n    }\n  },\n  "condition": { "compare": { "ctx.payload.hits.total": { "gt": 0 } } }\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "payment-webhook-changelog", namespace: "payments" },
        spec: {
          data: {
            "CHANGELOG.md":
              "## v2.9.0 (2 weeks ago)\n- Reworded delivery-failure log message from \"webhook delivery failed\npermanently\" to \"delivery attempt failed ... retries_exhausted=true\" for\nconsistency with the rest of the dispatcher's structured logging - the\nold literal phrase is no longer logged anywhere.\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap watcher-failed-webhook-alert -n logging -o yaml` - what exact phrase is this alert's query string searching for?",
    "`kubectl logs payment-webhook-3d4e5f6g7-h8i9j -n payments` - does a real failure's log line actually contain that exact phrase anymore?",
    "`kubectl get configmap payment-webhook-changelog -n payments -o yaml` - did the wording of this specific log message change recently?",
  ],
  options: [
    {
      id: "log-message-reworded-regex-stale",
      label:
        "payment-webhook's v2.9.0 release two weeks ago reworded its delivery-failure log message from the literal phrase `\"webhook delivery failed permanently\"` to a differently-structured message, but the log-based alert's query still searches for that exact original phrase - which no longer appears anywhere in the logs - so the alert query runs successfully on schedule every time and simply finds zero matching documents, never firing despite genuine failures continuing to be logged under new wording.",
      explanation:
        "`payment-webhook-changelog` confirms the exact log message the alert searches for was reworded two weeks ago, matching precisely when the alert stopped firing. `watcher-failed-webhook-alert`'s query string is a literal match against `\"webhook delivery failed permanently\"`. The current log line, shown directly, uses entirely different wording (`delivery attempt failed status=503 ... retries_exhausted=true`) with no occurrence of the original phrase - the query executes without error, it just legitimately finds nothing, which is indistinguishable from 'no failures happened' unless someone checks the raw logs directly, as the audit did.",
    },
    {
      id: "elasticsearch-not-indexing-payment-webhook-logs",
      label: "Elasticsearch has stopped indexing payment-webhook's logs entirely for the past two weeks.",
      explanation:
        "The genuine failure log line is confirmed present and viewable via `kubectl logs`, and the audit found the real failures in the raw logs already indexed somewhere for them to be discoverable - the logs are being indexed; the alert's search query itself just no longer matches their current wording.",
    },
    {
      id: "watcher-schedule-not-running",
      label: "The Watcher alert's schedule stopped triggering, so the query never actually runs anymore.",
      explanation:
        "The alert's query is explicitly confirmed to still run successfully on its usual schedule with no errors - the schedule and execution are both working; the query simply returns zero matching hits because the phrase it searches for no longer appears in any log line.",
    },
    {
      id: "payment-webhook-actually-stopped-failing",
      label: "payment-webhook genuinely stopped experiencing delivery failures around the same time.",
      explanation:
        "The downstream vendor independently confirms three genuine webhook delivery failures occurred during exactly this window - real failures continued to happen; they just stopped being described using the exact phrase the alert's query was built to search for.",
    },
  ],
  correctOptionId: "log-message-reworded-regex-stale",
  resolution: `\`payment-webhook-changelog\` shows the v2.9.0 release, two weeks ago,
reworded the delivery-failure log message from the literal phrase
\`"webhook delivery failed permanently"\` to a differently structured
message using \`retries_exhausted=true\` - matching exactly when the alert
went quiet. \`watcher-failed-webhook-alert\`'s query is a literal
\`query_string\` search for that exact original phrase, and the current log
line, visible directly via \`kubectl logs\`, confirms the phrase simply
doesn't exist in the new wording anywhere. The alert's schedule and query
execution are both working fine - every five minutes, it runs a
perfectly valid search that legitimately returns zero hits, because the
thing it's searching for stopped being written to the logs. Zero hits
looks identical to "nothing bad happened," which is exactly what fooled
everyone for two weeks, until an unrelated audit went looking at the raw
logs directly and found genuine, unpaged failures (independently
confirmed by the downstream vendor) sitting right there in plain sight,
just under new wording.

Log-message-literal alert queries are fragile in exactly this way -
nothing enforces that a log line's wording stays stable across releases,
and a query built around specific phrasing has no way to notice when that
phrasing quietly changes underneath it.

The fix is updating the query to match the current log format, and
ideally moving toward matching on a stable structured field rather than
free-text wording:

\`\`\`json
{
  "query": { "query_string": { "query": "message:\\"retries_exhausted=true\\"" } }
}
\`\`\`

Where possible, alerting on a structured field (a boolean flag, a status
code, a log level) rather than exact free-text phrasing is far more
resilient to routine logging changes - and it's worth periodically
re-validating log-based alert queries against current, real log samples
rather than assuming they still match.`,
};
