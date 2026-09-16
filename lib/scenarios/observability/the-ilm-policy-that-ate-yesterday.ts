import type { Scenario } from "../types";

export const theIlmPolicyThatAteYesterday: Scenario = {
  id: "the-ilm-policy-that-ate-yesterday",
  title: "The ILM Policy That Ate Yesterday",
  subtitle: "yesterday's logs for audit-service are just gone from Elasticsearch",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["elasticsearch", "ilm", "logging"],
  briefing: `Compliance needs yesterday's full audit trail for "audit-service" pulled
from Elasticsearch for an unrelated review, and it's simply not there.
Not slow, not partial - a Kibana search across the full expected index
range for yesterday comes back completely empty, while today's logs and
logs from a week ago are both present and searchable just fine.`,
  constraints: [
    "audit-service itself confirms (via its local disk buffer before shipping) that it genuinely emitted a full day of logs yesterday, as always.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "audit-service-ilm-policy", namespace: "logging" },
        spec: {
          data: {
            "ilm-policy.json":
              '{\n  "policy": {\n    "phases": {\n      "hot":   { "min_age": "0ms",  "actions": { "rollover": { "max_age": "1d" } } },\n      "warm":  { "min_age": "2d",   "actions": {} },\n      "delete": { "min_age": "3d",  "actions": { "delete": {} } }\n    }\n  }\n}',
          },
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ilm-history-audit-service", namespace: "logging" },
        spec: {
          data: {
            "ilm-explain-output.json":
              '{\n  "indices": {\n    "audit-service-2026.09.06-000014": {\n      "phase": "delete",\n      "action": "delete",\n      "action_time_millis": 1757894400000,\n      "step": "complete"\n    }\n  }\n}',
          },
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ilm-reindex-history", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "Nine days ago, an unrelated cluster maintenance operation force-merged\nand reindexed several old indices, including some belonging to\naudit-service, resetting the `creation_date` used by ILM's `min_age`\ncalculations on those specific indices to the reindex time rather than\npreserving the original document ingestion time. This has the effect of\nmaking ILM believe some older indices are actually much younger than\ntheir documents, and - separately, and unrelated to that reindex\nincident - one specific rollover, `audit-service-2026.09.06-000014`, was\ncreated with `min_age` phases counted from its *rollover* time, and it\nrolled into the `delete` phase and was deleted right on schedule\nyesterday, 3 days after its own creation, taking a full day's worth of\nlogs (that were, from a human calendar perspective, only one day old at\nthe time of deletion because rollover happened later than expected due\nto a temporary indexing backlog) with it.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap audit-service-ilm-policy -n logging -o yaml` - how quickly does this ILM policy delete an index after it's created, and is that based on calendar date or actual index age?",
    "`kubectl get configmap ilm-history-audit-service -n logging -o yaml` - which specific index got deleted, and when?",
    "`kubectl get configmap ilm-reindex-history -n logging -o yaml` - what determined *when* that index actually rolled over, versus what date range of real documents ended up inside it?",
  ],
  options: [
    {
      id: "ilm-min-age-vs-calendar-date-confusion",
      label:
        "The ILM policy deletes an index 3 days after its own rollover/creation time, not 3 days after the calendar date its documents cover - a delayed rollover caused by an indexing backlog meant the index holding what should have been 'yesterday's' logs was actually created earlier than its documents' real dates suggest, so it hit the 3-day `min_age` delete threshold and was deleted right on schedule, taking documents that were, by their actual content, only a day old.",
      explanation:
        "`ilm-history-audit-service` confirms index `audit-service-2026.09.06-000014` completed deletion exactly per policy. `ilm-reindex-history` explains the mismatch: this index's rollover happened later than expected due to an indexing backlog, meaning its `min_age`-based deletion clock (counted from rollover/creation time) and the calendar date of the documents actually inside it drifted apart - the index aged out of ILM's phases on schedule by its own clock, while still containing what a human would call 'yesterday's' logs.",
    },
    {
      id: "elasticsearch-cluster-outage-lost-data",
      label: "An Elasticsearch cluster outage yesterday caused this specific day's data to be lost.",
      explanation:
        "There's no evidence of a cluster outage - today's and last week's logs are both present and searchable normally, and `ilm-history-audit-service` shows a completed, deliberate deletion action by ILM, not data loss from an incident.",
    },
    {
      id: "audit-service-stopped-shipping-logs",
      label: "audit-service itself stopped shipping logs to Elasticsearch for that one day.",
      explanation:
        "audit-service's own local disk buffer confirms it genuinely emitted a full day of logs as always - the logs were shipped and indexed successfully; the problem is that ILM later deleted the index they ended up in, not that they were never sent.",
    },
    {
      id: "kibana-index-pattern-excludes-yesterday",
      label: "Kibana's index pattern is misconfigured to exclude yesterday's index specifically.",
      explanation:
        "`ilm-history-audit-service` shows the index itself completed the `delete` action and no longer exists in the cluster at all - there's nothing for an index pattern to exclude or include, because the underlying index is genuinely gone, not merely unmatched by a pattern.",
    },
  ],
  correctOptionId: "ilm-min-age-vs-calendar-date-confusion",
  resolution: `\`ilm-history-audit-service\` confirms index \`audit-service-2026.09.06-000014\`
completed the \`delete\` action - it's genuinely gone, deleted deliberately
by ILM, not lost to an outage or a Kibana display issue. \`audit-service-ilm-policy\`
shows the policy's \`delete\` phase triggers at \`min_age: 3d\`, counted from
the index's own rollover/creation time - not from the calendar date of the
documents inside it. \`ilm-reindex-history\` explains how those two clocks
drifted apart: this particular rollover happened later than usual because
of a temporary indexing backlog, so the index's own "age," as ILM measures
it, hit the 3-day threshold and triggered deletion on schedule, while
still containing documents that, by their real timestamps, were only one
calendar day old at the moment they were deleted.

ILM's phase transitions are built around index lifecycle age, not the
content inside the index - which normally lines up close enough with
calendar time that nobody notices the distinction, until a rollover delay
(from backlog, from a slow shard, from anything) shifts an index's actual
lifespan later without correspondingly shifting the age of what ends up
inside it.

There's no way to recover the deleted index's data from here, but the
durable fix is widening the safety margin between hot/warm/delete phases
so a delayed rollover has room to catch up before anything gets deleted,
and/or moving to time-based (rather than pure size/age) rollover for
predictable retention:

\`\`\`json
{
  "policy": {
    "phases": {
      "hot":    { "min_age": "0ms", "actions": { "rollover": { "max_age": "1d" } } },
      "warm":   { "min_age": "2d",  "actions": {} },
      "delete": { "min_age": "14d", "actions": { "delete": {} } }
    }
  }
}
\`\`\`

A 3-day delete threshold leaves almost no margin for a late rollover -
widening it, and separately alerting on rollover lag itself, keeps a
temporary indexing backlog from quietly costing a full day of audit data.`,
};
