import type { Scenario } from "./types";

export const theBufferThatGaveUp: Scenario = {
  id: "the-buffer-that-gave-up",
  title: "The Buffer That Gave Up",
  subtitle: "an hour of checkout-service logs is just missing, and nothing in the pipeline ever reported an error",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["fluentd", "buffer-overflow", "logging"],
  briefing: `A post-incident review needs checkout-service's logs from a specific
hour yesterday afternoon, during a brief but real traffic surge. They're
simply not in Elasticsearch - not slow to appear, genuinely absent, for
that service specifically, for that exact hour. Every other service's
logs for the same hour are present and complete.`,
  constraints: [
    "checkout-service's pods never restarted during that window, and its own on-disk container log files (checked via `kubectl exec` + direct file access) still contain the full hour of expected log lines.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-service", namespace: "checkout", labels: { app: "checkout-service" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        metadata: { name: "fluentd", namespace: "logging", labels: { app: "fluentd" } },
        spec: {},
        status: { desiredNumberScheduled: 12, numberReady: 12 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fluentd-checkout-output-config", namespace: "logging" },
        spec: {
          data: {
            "checkout.conf":
              "<match kubernetes.checkout.**>\n  @type elasticsearch\n  host elasticsearch.logging.svc\n  <buffer>\n    @type memory\n    chunk_limit_size 8MB\n    queue_limit_length 32\n    overflow_action drop_oldest_chunk\n    retry_max_times 5\n    retry_wait 5s\n  </buffer>\n</match>",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fluentd-buffer-overflow-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "checkout-service's log output volume roughly tripled during yesterday's\ntraffic surge. This match block uses an in-memory buffer (not disk-\nbacked) with `queue_limit_length 32` (max 32 chunks x 8MB = 256MB total\nbuffered before Elasticsearch acknowledges receipt) and\n`overflow_action drop_oldest_chunk` - when the buffer fills faster than\nchunks can be flushed to Elasticsearch (which was, separately, running\nslightly elevated write latency during the same window due to an\nunrelated shard rebalance), Fluentd's configured behavior is to silently\ndrop the *oldest* buffered chunk to make room for new log lines, rather\nthan blocking ingestion or erroring loudly. Fluentd's own internal\nmetrics do record a nonzero `buffer_queue_length` overflow counter\nduring this window, but nothing was alerting on it.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap fluentd-checkout-output-config -n logging -o yaml` - what does this output block do when its buffer fills up faster than Elasticsearch can accept new chunks?",
    "`kubectl get configmap fluentd-buffer-overflow-notes -n logging -o yaml` - what happened to checkout-service's log volume during the surge, and was anything else making Elasticsearch slower to accept writes at the same time?",
    "`overflow_action drop_oldest_chunk` doesn't fail loudly or block - it silently discards already-buffered log data to keep ingesting new lines, which is exactly the kind of failure that leaves no error anywhere in the pipeline for anyone to notice.",
  ],
  options: [
    {
      id: "in-memory-buffer-overflow-dropped-oldest-chunk",
      label:
        "checkout-service's log volume roughly tripled during the traffic surge while Elasticsearch was separately running elevated write latency from an unrelated shard rebalance - Fluentd's in-memory buffer for checkout-service's logs filled faster than it could flush, and with `overflow_action drop_oldest_chunk` configured, it silently discarded the oldest buffered log chunks to keep accepting new lines rather than blocking or erroring, which is exactly why an hour of logs is genuinely missing from Elasticsearch while checkout-service's own on-disk container logs (upstream of Fluentd's buffer) remain completely intact.",
      explanation:
        "`fluentd-checkout-output-config` confirms `overflow_action drop_oldest_chunk` on a memory buffer with a bounded `queue_limit_length`. `fluentd-buffer-overflow-notes` confirms checkout-service's log volume roughly tripled during the surge, Elasticsearch had separately elevated write latency at the same time, and Fluentd's own internal overflow counter shows real, nonzero drops during exactly this window - explaining precisely why checkout-service's logs specifically, for exactly that hour, are missing from Elasticsearch, while its own on-disk container logs (read by Fluentd but never modified by this drop) remain fully intact and every other, lower-volume service's logs came through unaffected.",
    },
    {
      id: "elasticsearch-index-rollover-lost-the-hour",
      label: "An Elasticsearch index rollover during that hour caused the data to be misrouted and lost.",
      explanation:
        "There's no evidence of an index routing issue - every other service's logs for the exact same hour, going through the same Elasticsearch cluster and presumably similar index rollover behavior, are present and complete, which points at something specific to checkout-service's own pipeline rather than a cluster-wide indexing event.",
    },
    {
      id: "kubelet-log-rotation-deleted-the-file",
      label: "kubelet's container log rotation deleted the relevant log file before Fluentd could read it.",
      explanation:
        "checkout-service's own on-disk container log files are confirmed, checked directly, to still contain the full hour of expected log lines - the source logs were never rotated away or lost at the file level; the loss happened specifically inside Fluentd's own buffering and delivery to Elasticsearch.",
    },
    {
      id: "checkout-service-pods-restarted-losing-logs",
      label: "checkout-service's pods restarted during the surge, losing buffered log data along with the old containers.",
      explanation:
        "The scenario explicitly confirms checkout-service's pods never restarted during that window - there's no pod-level log loss here. Fluentd's own buffer, a separate component from the application pods entirely, is where the confirmed overflow and drop actually occurred.",
    },
  ],
  correctOptionId: "in-memory-buffer-overflow-dropped-oldest-chunk",
  resolution: `\`fluentd-checkout-output-config\` shows checkout-service's log output uses
an in-memory Fluentd buffer with a bounded \`queue_limit_length\` and
\`overflow_action drop_oldest_chunk\`. \`fluentd-buffer-overflow-notes\` fills
in what actually happened: checkout-service's log volume roughly tripled
during yesterday's traffic surge, right as Elasticsearch was separately
experiencing elevated write latency from an unrelated shard rebalance -
a genuinely unlucky overlap of higher input volume and slower output
throughput at the same time. With the buffer filling faster than it
could flush, Fluentd did exactly what \`drop_oldest_chunk\` tells it to do:
silently discarded the oldest already-buffered chunks to make room for
newer log lines, rather than blocking ingestion (which risks backing
pressure up to the application) or erroring loudly. Fluentd's own
internal metrics genuinely recorded a nonzero buffer-overflow counter
during exactly this window - the evidence was there the whole time,
simply not alerted on by anyone. checkout-service's own on-disk container
logs, read by Fluentd but never modified by its own internal buffer
drops, remain completely intact - confirming the loss happened
specifically inside the shipping pipeline, not at the source.

Every other service's logs for the same hour survived because their
combined volume never filled their buffers faster than Elasticsearch
(even slowed) could keep up - checkout-service's surge, landing right on
top of Elasticsearch's own slowdown, was the specific combination that
tipped this one pipeline over.

The fix is switching to a disk-backed buffer (giving much more headroom
before overflow) and alerting directly on Fluentd's own buffer-overflow
metric:

\`\`\`xml
<buffer>
  @type file
  path /var/log/fluentd-buffers/checkout
  chunk_limit_size 8MB
  total_limit_size 2GB
  overflow_action block
  retry_max_times 10
</buffer>
\`\`\`

\`\`\`promql
increase(fluentd_output_status_buffer_queue_length{tag=~"kubernetes.checkout.*"}[5m]) > 0
\`\`\`

A disk-backed buffer with a much larger total limit, paired with an
alert on the overflow counter Fluentd was already emitting the whole
time, turns a silent, retroactively-discovered hour of missing logs into
a visible, actionable warning the moment it starts happening.`,
};
