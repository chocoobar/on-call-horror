import type { Scenario } from "./types";

export const whereDidTheLogsGo: Scenario = {
  id: "where-did-the-logs-go",
  title: "Where Did the Logs Go",
  subtitle: "notifications-worker is clearly erroring, but Kibana hasn't seen it since yesterday",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["elk", "logging", "elasticsearch"],
  briefing: `"notifications-worker" has been throwing errors for the last hour according
to \`kubectl logs\` - but Kibana shows nothing for this service since
yesterday afternoon. On-call can see the errors happening in real time,
just not search or graph them anywhere, and this rotation's alerting is
built entirely on Kibana - which has stayed completely quiet.`,
  constraints: [
    "The Elasticsearch cluster reports green health, and every other service's logs are showing up in Kibana normally - this is scoped to one service's log pipeline.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notifications-worker", namespace: "notifications", labels: { app: "notifications-worker" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notifications-worker-2c3d4e5f6-g7h8i", namespace: "notifications", labels: { app: "notifications-worker" } },
        status: { phase: "Running", containerStatuses: [{ name: "notifications-worker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "notifications-worker": [
            '{"ts":"2026-09-15T10:02:01.114Z","level":"ERROR","logger":"c.e.notify.SmsSender","msg":"provider timeout sending sms to +1555010199","requestId":"ntf-88213"}',
            '{"ts":"2026-09-15T10:02:03.410Z","level":"ERROR","logger":"c.e.notify.SmsSender","msg":"provider timeout sending sms to +1555010204","requestId":"ntf-88214"}',
            '{"ts":"2026-09-15T10:02:05.902Z","level":"INFO","logger":"c.e.notify.EmailSender","msg":"sent email to user 44210","requestId":"ntf-88215"}',
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "notifications-worker-changelog", namespace: "notifications" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v2.1.0 (deployed yesterday, 14:30 UTC)\n- Switched application logging from plain-text lines to structured\n  single-line JSON (one JSON object per log event), to make fields\n  like `requestId` easier to query directly.\n",
          },
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "filebeat-notifications-config", namespace: "logging" },
        spec: {
          data: {
            "notifications-worker.yml":
              "- type: log\n  paths:\n    - /var/log/containers/notifications-worker-*.log\n  multiline.pattern: '^\\d{4}-\\d{2}-\\d{2}'\n  multiline.negate: true\n  multiline.match: after\n  json.keys_under_root: false\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs notifications-worker-2c3d4e5f6-g7h8i -n notifications` - what does each log line actually look like right now? Does it start with a date, or something else?",
    "`kubectl get configmap notifications-worker-changelog -n notifications -o yaml` - has the log format changed recently?",
    "`kubectl get configmap filebeat-notifications-config -n logging -o yaml` - `multiline.pattern` decides which lines start a *new* shipped event versus get glued onto the previous one as a continuation (controlled by `multiline.negate`/`multiline.match`). What happens if not a single line ever matches that pattern?",
  ],
  options: [
    {
      id: "multiline-pattern-stale",
      label:
        "Filebeat's `multiline.pattern` for this service still expects the old plain-text, date-prefixed log lines. Now that every line is single-line JSON starting with `{`, nothing ever matches the pattern, so Filebeat treats every line as a continuation of one endless event that never gets flushed and shipped to Elasticsearch.",
      explanation:
        "`notifications-worker-changelog` shows the log format switched to single-line JSON yesterday. `filebeat-notifications-config` still has `multiline.pattern: '^\\d{4}-\\d{2}-\\d{2}'` with `negate: true, match: after` - meaning 'any line that does NOT start with a date is a continuation of the previous event.' Every JSON line starts with `{`, not a date, so every single line since the deploy has been getting glued onto one never-ending event that Filebeat is still waiting to see the 'next' event to close and ship. Nothing new has left the node since the format changed.",
    },
    {
      id: "elasticsearch-disk-full",
      label: "Elasticsearch's disk is full, so it's silently dropping new documents.",
      explanation:
        "Cluster health reports green, and every other service's logs are indexing normally right now - a full or degraded cluster would affect ingestion for everyone, not just one service's pipeline.",
    },
    {
      id: "log-level-too-high",
      label: "notifications-worker's log level is configured too high, so error logs aren't even being written.",
      explanation:
        "`kubectl logs` shows the ERROR lines being written by the container in real time - the application is logging correctly. The problem is downstream of the container, in what happens to those log lines after they're written.",
    },
    {
      id: "kibana-index-pattern-wrong",
      label: "Kibana's index pattern is misconfigured and can't find the right index.",
      explanation:
        "There are no documents for this service in any index since yesterday - it isn't a matter of Kibana searching the wrong place, the documents themselves never arrived in Elasticsearch for Kibana to find in the first place.",
    },
  ],
  correctOptionId: "multiline-pattern-stale",
  resolution: `\`notifications-worker-changelog\` pinpoints the timing: the app switched
from plain-text, date-prefixed log lines to single-line JSON yesterday at
14:30 UTC - right around when Kibana's data for this service goes quiet.

\`filebeat-notifications-config\` explains the mechanism. Its \`multiline\`
block is a holdover from the old format:

\`\`\`yaml
multiline.pattern: '^\\d{4}-\\d{2}-\\d{2}'
multiline.negate: true
multiline.match: after
\`\`\`

Read together, that means: "a line that does *not* start with a date
(\`negate: true\`) gets appended *after* the previous line, as part of the
same event (\`match: after\`)." That's exactly right for stitching a
multi-line stack trace onto the log line that started it - as long as
*normal* lines still start with a date. Every JSON log line now starts
with \`{\`, which never matches the date pattern, so from Filebeat's
perspective *every single line since the format changed* looks like a
continuation of whatever event came before it. The very first JSON line
after the deploy became an endless, still-open "event" that Filebeat is
still waiting to close - so nothing new has ever been flushed and shipped
to Elasticsearch since.

Since the app now logs one structured JSON object per line, the fix is to
drop multiline handling entirely and parse the JSON directly:

\`\`\`yaml
- type: log
  paths:
    - /var/log/containers/notifications-worker-*.log
  json.keys_under_root: true
  json.add_error_key: true
\`\`\`

Any time a service's log format changes, the shipping pipeline's parsing
config needs to change in the same rollout - otherwise the app keeps
logging correctly and the pipeline keeps running without error, while
nothing observable ever reaches the other end.`,
};
