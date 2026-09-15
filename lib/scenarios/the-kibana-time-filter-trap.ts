import type { Scenario } from "./types";

export const theKibanaTimeFilterTrap: Scenario = {
  id: "the-kibana-time-filter-trap",
  title: "The Kibana Time Filter Trap",
  subtitle: "the error everyone remembers seeing an hour ago isn't in Kibana's \"last hour\" search",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["elk", "kibana", "logging"],
  briefing: `Three engineers distinctly remember seeing a burst of "PaymentTimeoutException"
errors from "billing-worker" about an hour ago while actively watching
\`kubectl logs\`. Searching Kibana for the exact same error, filtered to
"last hour," returns nothing at all.`,
  constraints: [
    "The error genuinely happened - it's independently confirmed in kubectl logs history and in a screenshot someone took at the time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-worker", namespace: "billing", labels: { app: "billing-worker" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "billing-worker-8n9o0p1q2-r3s4t", namespace: "billing", labels: { app: "billing-worker" } },
        status: { phase: "Running", containerStatuses: [{ name: "billing-worker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "billing-worker": [
            "2026-09-15T08:15:02.114Z ERROR c.e.billing.PaymentProcessor - PaymentTimeoutException processing invoice inv-6631",
            "2026-09-15T08:15:14.884Z ERROR c.e.billing.PaymentProcessor - PaymentTimeoutException processing invoice inv-6632",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "logging-pipeline-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "The Logstash pipeline for this namespace has been running roughly\n50-70 minutes behind on ingestion since a downstream Elasticsearch\nreindex operation started this morning, competing for the same cluster\nresources. The index template's `@timestamp` field is set from Logstash's\nown processing time (when the pipeline actually indexes the event), not\nfrom a timestamp parsed out of the original log line itself.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs billing-worker-8n9o0p1q2-r3s4t -n billing` - the log lines have their own real timestamp. Does that necessarily match when the event actually gets indexed into Elasticsearch?",
    "`kubectl get configmap logging-pipeline-notes -n logging -o yaml` - what is Kibana's `@timestamp` field actually populated from, and is the pipeline caught up right now?",
    "If ingestion is running significantly behind, and Kibana's time filter is based on when a document was indexed rather than when the original event happened, what happens to a search for 'the last hour' of *event* time?",
  ],
  options: [
    {
      id: "at-timestamp-is-ingestion-time-not-event-time",
      label:
        "The Logstash pipeline is running 50-70 minutes behind on ingestion due to resource contention with an Elasticsearch reindex, and `@timestamp` is set from Logstash's own processing time rather than the timestamp embedded in the original log line - so an error that happened an hour ago (by its real, embedded timestamp) is only being indexed right around now, and doesn't fall inside Kibana's 'last hour' filter measured against `@timestamp` at all.",
      explanation:
        "`logging-pipeline-notes` confirms both halves directly: `@timestamp` reflects Logstash's own processing/ingestion time, not the event's real occurrence time, and the pipeline is running 50-70 minutes behind schedule right now. An error that occurred (by its own embedded timestamp) an hour ago is only being indexed into Elasticsearch around the present moment, given that backlog - which means its `@timestamp` value is close to *now*, not an hour ago. Kibana's 'last hour' filter operates on `@timestamp`, so a document that's only being indexed right now easily satisfies 'last hour' by ingestion time - but a search for something an on-call engineer expects to find within 'the last hour' of *real event time* comes up empty if they were searching an hour that's already scrolled past the ingestion-time window, or found unexpectedly if they broaden the range - either way, event time and `@timestamp` have quietly stopped meaning the same thing.",
    },
    {
      id: "elasticsearch-dropped-documents",
      label: "Elasticsearch silently dropped these specific log documents during the reindex.",
      explanation:
        "There's no evidence of dropped documents - the pipeline is confirmed to simply be running significantly behind, not losing data. The documents are still in the process of being indexed; they just haven't landed yet as of when the search was run.",
    },
    {
      id: "wrong-kibana-index-pattern",
      label: "The Kibana index pattern being searched doesn't include this namespace's logs.",
      explanation:
        "This isn't about searching the wrong index - once the delayed documents do land, they land in the same index pattern as everything else from this namespace. The issue is specifically about what time range they land under, not whether they're indexed at all.",
    },
    {
      id: "log-level-filtered-out",
      label: "A Logstash filter is silently dropping ERROR-level logs for this service.",
      explanation:
        "There's no indication of severity-based filtering here - the notes describe a pipeline that's simply running behind on ingestion volume/timing, not one that's selectively excluding certain log levels from being processed at all.",
    },
  ],
  correctOptionId: "at-timestamp-is-ingestion-time-not-event-time",
  resolution: `\`logging-pipeline-notes\` explains both pieces directly: this Logstash
pipeline is running 50-70 minutes behind schedule due to resource
contention with an unrelated Elasticsearch reindex operation, and
critically, \`@timestamp\` - the field Kibana's time filter searches
against - is populated from Logstash's own *processing* time, not a
timestamp parsed out of the original log line. Those two facts compound:
an error that genuinely happened an hour ago, by its own real embedded
timestamp, is only being picked up and indexed by Logstash right around
now, given the backlog - so its \`@timestamp\` value lands close to the
present moment, not an hour in the past. Searching "last hour" in Kibana
is really searching "documents indexed in the last hour," which, during a
significant ingestion delay, stops corresponding to "events that happened
in the last hour" at all - some very recent-by-\`@timestamp\` documents are
actually quite old by real event time, and some genuinely recent events
haven't been indexed yet at any timestamp.

There's no fix available from this read-only console for the pipeline's
current backlog (it needs the reindex contention resolved or the pipeline
given dedicated resources to catch up), but the more durable fix is
making \`@timestamp\` reflect the actual event time going forward, using a
\`date\` filter in the Logstash pipeline to parse the timestamp already
embedded in the log line itself:

\`\`\`ruby
filter {
  date {
    match => ["log_timestamp", "ISO8601"]
    target => "@timestamp"
  }
}
\`\`\`

Once \`@timestamp\` reflects when something actually happened rather than
when the pipeline got around to processing it, a Kibana search for "the
last hour" stays meaningful even during an ingestion delay - it's the
delay itself that becomes visible as a gap, instead of silently
relabeling old events as new ones.`,
};
