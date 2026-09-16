import type { Scenario } from "./types";

export const theTimeFieldThatWasnt: Scenario = {
  id: "the-time-field-that-wasnt",
  title: "The Time Field That Wasn't",
  subtitle: "picking any time range in Kibana for gateway-audit-log shows the exact same set of documents, always",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["kibana", "index-pattern", "elasticsearch"],
  briefing: `Someone investigating a specific incident window in the "gateway-audit-log"
index in Kibana notices something odd: changing the time picker from
"last 15 minutes" to "last 30 days" doesn't change the result count or
the documents shown at all - not even slightly. It's as if the time
filter isn't doing anything.`,
  constraints: [
    "Documents in the gateway-audit-log index are confirmed, via direct Elasticsearch query, to have accurate and varied real timestamps spanning weeks.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kibana-index-pattern-export", namespace: "logging" },
        spec: {
          data: {
            "gateway-audit-log-pattern.ndjson":
              '{"attributes":{"title":"gateway-audit-log*","timeFieldName":"ingest_id"}}',
          },
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gateway-audit-log-mapping-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "gateway-audit-log documents have two relevant fields: `@timestamp`\n(a proper `date` type, populated correctly with the real event time on\nevery document) and `ingest_id` (a `keyword` type - a unique string\nidentifier assigned per ingest batch, NOT a real timestamp at all,\ndespite its name suggesting otherwise to whoever configured this index\npattern). Kibana's time picker filters strictly on whatever field is\nconfigured as `timeFieldName` for the index pattern - if that field\nisn't actually a `date` type in the underlying mapping, Kibana's date\nrange filtering against it either matches everything, matches nothing\nuseful, or behaves inconsistently, since a `keyword` field has no\nchronological ordering for a date range query to meaningfully apply to.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap kibana-index-pattern-export -n logging -o yaml` - what field is actually configured as this index pattern's `timeFieldName`?",
    "`kubectl get configmap gateway-audit-log-mapping-notes -n logging -o yaml` - is that field actually a real `date` type in Elasticsearch's mapping, or something else entirely?",
    "Kibana's time picker only works meaningfully against a field that's genuinely a `date` type - pointed at a `keyword` field with a misleading name, it has no real chronological data to filter on at all.",
  ],
  options: [
    {
      id: "time-field-points-at-non-date-keyword-field",
      label:
        "The index pattern's `timeFieldName` is configured as `ingest_id`, a `keyword`-type field holding a per-batch identifier string that isn't a real timestamp at all, rather than `@timestamp`, the actual `date`-type field correctly populated with real event times on every document - Kibana's time picker filters strictly on whatever field is configured as the time field, and since `ingest_id` has no genuine chronological ordering, changing the time range has no meaningful effect on which documents match.",
      explanation:
        "`kibana-index-pattern-export` shows `timeFieldName` is explicitly set to `ingest_id`. `gateway-audit-log-mapping-notes` confirms `ingest_id` is a `keyword` field holding a per-ingest-batch identifier, not a real timestamp, while the genuinely accurate, varied `@timestamp` field sits unused as the configured time field. Since documents are independently confirmed to have accurate real timestamps via direct Elasticsearch query, the mismatch is specifically in which field Kibana's index pattern points its time filtering at, fully explaining why the time picker appears to have no effect on results.",
    },
    {
      id: "elasticsearch-documents-missing-timestamps",
      label: "gateway-audit-log documents are missing a real timestamp field entirely.",
      explanation:
        "Documents are confirmed, via direct Elasticsearch query, to have accurate and varied real timestamps (in `@timestamp`) spanning weeks - the timestamp data genuinely exists and is correct; Kibana's index pattern is simply configured to filter on a different, non-date field instead.",
    },
    {
      id: "kibana-time-picker-ui-bug",
      label: "Kibana's time picker widget itself has a display bug and isn't actually applying the selected range.",
      explanation:
        "There's no indication of a UI-level bug in the time picker component itself - the more direct, evidenced explanation is that the index pattern's configured time field isn't a real date field at all, which would produce exactly this kind of \"time range has no effect\" behavior through completely normal Kibana operation.",
    },
    {
      id: "elasticsearch-index-not-time-based",
      label: "The gateway-audit-log index isn't time-based and therefore can't support time filtering at all.",
      explanation:
        "Elasticsearch itself doesn't require an index to be structured any particular way to support date range filtering - it just needs a genuine `date`-type field to filter on, which this index does have (`@timestamp`). The index pattern is simply configured to use the wrong field for that filtering, not incapable of it.",
    },
  ],
  correctOptionId: "time-field-points-at-non-date-keyword-field",
  resolution: `\`kibana-index-pattern-export\` shows the \`gateway-audit-log*\` index
pattern's \`timeFieldName\` is set to \`ingest_id\`. \`gateway-audit-log-mapping-notes\`
explains why that breaks time filtering: \`ingest_id\` is a \`keyword\`-type
field holding a unique per-ingest-batch identifier string - its name
suggests something chronological, but it isn't a timestamp at all and has
no genuine date ordering. The actual, correctly-populated \`date\`-type
field, \`@timestamp\`, sits right there in the same documents, unused by
the index pattern. Kibana's time picker filters strictly and only against
whatever field is configured as \`timeFieldName\` - pointed at a
non-chronological \`keyword\` field, changing the time range has no
meaningful way to include or exclude documents based on when they
actually happened, which is exactly the "time range does nothing"
behavior observed. Documents themselves are confirmed to carry accurate,
varied real timestamps in \`@timestamp\` the whole time - the data was
never the problem, only which field the index pattern was told to treat
as time.

This is an easy mistake to make when setting up an index pattern -
\`ingest_id\` sounds plausible as a time-related field, and Kibana doesn't
validate that a chosen \`timeFieldName\` is actually a sensible date field
before letting it be selected.

The fix is repointing the index pattern's time field to the real
timestamp:

\`\`\`json
{
  "attributes": {
    "title": "gateway-audit-log*",
    "timeFieldName": "@timestamp"
  }
}
\`\`\`

Once the index pattern uses the genuine \`date\`-type field, Kibana's time
picker starts meaningfully filtering results by when events actually
happened - and it's worth spot-checking any index pattern's configured
time field name against its actual mapping type, since a plausible-
sounding field name is no guarantee it's actually a date.`,
};
