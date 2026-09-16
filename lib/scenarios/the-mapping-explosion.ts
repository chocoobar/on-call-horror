import type { Scenario } from "./types";

export const theMappingExplosion: Scenario = {
  id: "the-mapping-explosion",
  title: "The Mapping Explosion",
  subtitle: "event-tracker's log index started silently rejecting documents the same week a new event type shipped",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["elasticsearch", "dynamic-mapping", "logging"],
  briefing: `A growing number of "event-tracker" log documents have simply never made
it into Elasticsearch since a new analytics event type shipped last
week - not delayed, genuinely never indexed, confirmed by comparing
event-tracker's own outbound send-count metric against Elasticsearch's
document count for the same window. Fluentd itself shows no crash, no
restart, nothing unusual in its own health status.`,
  constraints: [
    "event-tracker's own logs confirm it successfully sends every event to the logging pipeline - the gap is happening somewhere downstream of the application.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "event-tracker", namespace: "analytics", labels: { app: "event-tracker" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "event-tracker-changelog", namespace: "analytics" },
        spec: {
          data: {
            "CHANGELOG.md":
              "## v3.4.0 (1 week ago)\n- Added new `custom_properties` event type: an open-ended, user-defined\nkey-value map attached to certain analytics events, where keys are\narbitrary strings chosen by the calling client (e.g. `custom_properties.experiment_variant_42`,\n`custom_properties.ab_test_bucket_7`, one distinct key per\nexperiment/test combination in use).\n",
          },
        },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "elasticsearch-fluentd-write-errors", namespace: "logging" },
        spec: {
          data: {
            "error-log-excerpt.md":
              "fluentd.elasticsearch: bulk index error, status 400:\n\"Limit of total fields [1000] has been exceeded while adding new fields\ncontributed by document\" (recurring, first seen 1 week ago, affecting\nan increasing share of event-tracker documents daily)\n",
          },
        },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dynamic-mapping-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "Elasticsearch's default dynamic mapping automatically creates a new\nindexed field for every distinct JSON key it sees in an incoming\ndocument, unless the index's mapping explicitly disables that for a\ngiven object (`\"dynamic\": false` or `\"type\": \"flattened\"`). Each\ndistinct key under `custom_properties` - one per experiment/test\ncombination, effectively unbounded - creates a brand-new mapped field.\nElasticsearch enforces a hard limit (`index.mapping.total_fields.limit`,\ndefault 1000) on the total number of mapped fields an index can ever\naccumulate; once hit, any document that would introduce a genuinely NEW\nfield beyond that limit is rejected outright with a 400 error, while\ndocuments that don't introduce any new field names continue to index\nnormally.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap elasticsearch-fluentd-write-errors -n logging -o yaml` - what exact error is Elasticsearch returning for the rejected documents, and when did it start?",
    "`kubectl get configmap event-tracker-changelog -n analytics -o yaml` - what changed in event-tracker a week ago that introduces new, unpredictable JSON keys into its event documents?",
    "`kubectl get configmap dynamic-mapping-notes -n logging -o yaml` - what does Elasticsearch do by default with every distinct JSON key it encounters, and is there a limit to how many it will accept for one index?",
  ],
  options: [
    {
      id: "dynamic-mapping-field-limit-exceeded",
      label:
        "event-tracker's new `custom_properties` event type, shipped a week ago, introduces an open-ended, user-defined set of JSON keys - one per experiment/test combination - and Elasticsearch's default dynamic mapping creates a brand-new indexed field for every distinct key it sees, which has now pushed the index past its default 1000-field mapping limit, causing every document that would introduce yet another new field to be rejected outright with a 400 error, exactly matching the recurring bulk-index errors and the growing share of event-tracker documents failing to index since that release.",
      explanation:
        "`event-tracker-changelog` confirms the new `custom_properties` field introduces arbitrary, effectively unbounded keys, shipped exactly a week before the problem started. `elasticsearch-fluentd-write-errors` shows the exact error - \"Limit of total fields [1000] has been exceeded\" - starting the same week. `dynamic-mapping-notes` explains the mechanism directly: every distinct new key creates a new mapped field by default, and once the index's field-count limit is hit, documents introducing yet another new field get rejected, which is exactly why an increasing share of documents (those introducing not-yet-seen experiment/test key combinations) fail while others continue indexing normally.",
    },
    {
      id: "fluentd-crashed-and-lost-buffered-events",
      label: "Fluentd crashed or restarted during this window, losing buffered events.",
      explanation:
        "Fluentd's own health status shows no crash or restart, and the errors evidenced are explicit, per-document \"400\" rejection responses from Elasticsearch itself, not a Fluentd-side process failure or buffer loss - the documents are being actively refused by Elasticsearch, not lost before ever being sent.",
    },
    {
      id: "event-tracker-network-issue-to-logging-pipeline",
      label: "event-tracker has an intermittent network issue reaching the logging pipeline.",
      explanation:
        "event-tracker's own logs confirm it successfully sends every event to the logging pipeline - the send side is working correctly. The rejection is happening downstream, specifically at Elasticsearch's document-indexing step, evidenced directly by its own 400 error responses.",
    },
    {
      id: "elasticsearch-cluster-disk-full",
      label: "The Elasticsearch cluster has run out of disk space, rejecting new writes.",
      explanation:
        "A disk-full condition in Elasticsearch typically produces a cluster-wide read-only block affecting every index and service, not a specific \"total fields limit exceeded\" error scoped to one index's mapping - the evidenced error message is explicitly about field count, not storage capacity.",
    },
  ],
  correctOptionId: "dynamic-mapping-field-limit-exceeded",
  resolution: `\`elasticsearch-fluentd-write-errors\` shows the exact rejection message:
\`"Limit of total fields [1000] has been exceeded while adding new fields
contributed by document"\`, first appearing exactly a week ago and
affecting a growing share of event-tracker's documents since.
\`event-tracker-changelog\` shows what shipped that same week: a new
\`custom_properties\` event type carrying an open-ended, user-defined
key-value map, with one distinct key per experiment/test combination in
use - effectively unbounded in how many unique key names it can
introduce over time. \`dynamic-mapping-notes\` explains how those two facts
connect: Elasticsearch's default dynamic mapping creates a brand-new
indexed field for every distinct JSON key it encounters, and enforces a
hard cap (\`index.mapping.total_fields.limit\`, defaulting to 1000) on how
many mapped fields an index can ever accumulate. Every new
\`custom_properties.<experiment_key>\` seen for the first time consumes one
more slot toward that cap - and once it's exhausted, any document
introducing yet another genuinely new key gets rejected outright with a
400, while documents that only reuse already-seen keys continue to index
normally. That's exactly the pattern observed: an increasing share of
event-tracker's documents failing, since an increasing share of them are
the ones unlucky enough to be first to use a not-yet-seen experiment/test
key combination.

Fluentd itself is working correctly the whole time - it's faithfully
relaying documents to Elasticsearch and getting real, specific 400
rejections back for some of them, which don't manifest as a Fluentd
crash or restart at all.

The fix is disabling dynamic mapping for the open-ended
\`custom_properties\` object specifically (indexing it as unmapped/flattened
content instead of individually-mapped fields), rather than raising the
field limit indefinitely, which would just delay the same problem:

\`\`\`json
{
  "mappings": {
    "properties": {
      "custom_properties": { "type": "flattened" }
    }
  }
}
\`\`\`

Any application field that accepts arbitrary, caller-defined keys is a
direct risk to an index's field-mapping budget under Elasticsearch's
default dynamic mapping - it should almost always be mapped as
\`flattened\` (or explicitly excluded from dynamic mapping) rather than left
to generate a new field per unique key indefinitely.`,
};
