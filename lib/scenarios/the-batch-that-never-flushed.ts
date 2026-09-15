import type { Scenario } from "./types";

export const theBatchThatNeverFlushed: Scenario = {
  id: "the-batch-that-never-flushed",
  title: "The Batch That Never Flushed",
  subtitle: "traces for low-traffic-service show up in Tempo up to twenty minutes late",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["opentelemetry", "collector", "tracing"],
  briefing: `An engineer debugging a one-off slow request on "notifications-worker" -
a low-traffic internal service - keeps refreshing the tracing backend and
finding nothing, for a request they know just happened. Twenty minutes
later, the trace finally shows up, perfectly intact. High-traffic services
never seem to have this delay at all.`,
  constraints: [
    "The OpenTelemetry Collector itself is healthy and not restarting - this isn't a crash or connectivity issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "otel-collector", namespace: "observability", labels: { app: "otel-collector" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "otel-collector-config", namespace: "observability" },
        spec: {
          data: {
            "config.yaml":
              "processors:\n  batch:\n    send_batch_size: 8192\n    timeout: 30s\n    # NOTE: no send_batch_max_size set, and no separate timeout override\n    # per pipeline - one shared batch processor config for every service's\n    # traces, high-traffic and low-traffic alike.\nexporters:\n  otlp:\n    endpoint: tempo-distributor:4317\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlp]\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "batch-processor-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "The `batch` processor holds spans in memory and flushes them to the\nexporter when *either* `send_batch_size` spans have accumulated, *or*\n`timeout` has elapsed since the batch started - whichever comes first.\nnotifications-worker produces roughly 15-20 spans per minute. At 8192\nspans per batch, its batch practically never fills on size alone -\nit's almost always the 30s timeout doing the flushing... except the\ntimeout only starts counting from when the *first* span of a new batch\narrives, and with `timeout: 30s` actually configured cluster-wide but\nan internal collector default multiplying effective idle-flush behavior\nunder very low throughput, batches for low-traffic services have been\nobserved sitting for multiple back-to-back timeout cycles before a\nflush is finally triggered by a burst of unrelated but co-batched traffic.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap otel-collector-config -n observability -o yaml` - is there a separate batch config for low-traffic services, or does everything share the same `send_batch_size` and `timeout`?",
    "`kubectl get configmap batch-processor-notes -n observability -o yaml` - roughly how many spans per minute does notifications-worker produce, versus the configured `send_batch_size`?",
    "The batch processor flushes on whichever condition is hit first - size or timeout. For a service producing only a handful of spans a minute against an 8192-span threshold, which condition is realistically ever going to be the one that fires, and how reliably?",
  ],
  options: [
    {
      id: "shared-batch-config-mismatched-for-low-traffic",
      label:
        "One shared `batch` processor config (`send_batch_size: 8192`, `timeout: 30s`) is applied to every service's traces regardless of volume - for a low-traffic service like notifications-worker producing only 15-20 spans a minute, the size threshold is essentially unreachable on its own, so its spans sit waiting on timeout-driven flush behavior that isn't reliably firing every 30 seconds under such low throughput, producing the long, inconsistent delays that high-traffic services (which fill batches on size alone) never experience.",
      explanation:
        "`otel-collector-config` confirms a single `batch` processor config, with no per-service or per-pipeline override, applied uniformly. `batch-processor-notes` shows notifications-worker's low volume (15-20 spans/minute) makes the 8192-span size threshold effectively unreachable, leaving the 30s timeout as the only realistic flush trigger - and that timeout-driven flushing has been observed not firing reliably every cycle under very low throughput, exactly matching the up-to-20-minute delays reported, while high-traffic services never see this because they fill batches on size long before any timeout matters.",
    },
    {
      id: "tempo-ingestion-delay",
      label: "Tempo's own ingestion pipeline is slow to index and make traces queryable.",
      explanation:
        "High-traffic services' traces appear promptly through the exact same Tempo ingestion path, which rules out a general Tempo-side indexing delay - the delay is specific to how long low-traffic spans sit inside the Collector's batch processor before being exported at all.",
    },
    {
      id: "otlp-exporter-retrying-silently",
      label: "The OTLP exporter to Tempo is silently retrying failed exports, delaying delivery.",
      explanation:
        "The Collector is confirmed healthy with no connectivity issues, and there's no indication of export failures - the delay traces back to how long spans sit unflushed inside the batch processor before an export is even attempted, not to retries on a failing export.",
    },
    {
      id: "notifications-worker-not-flushing-spans",
      label: "notifications-worker's own SDK isn't flushing spans to the Collector promptly.",
      explanation:
        "The delay pattern - fine for high-traffic services, bad for low-traffic ones, using the same Collector config - points at the Collector's shared batching behavior rather than at any one service's own SDK export behavior, which would be expected to affect all services similarly regardless of their traffic volume.",
    },
  ],
  correctOptionId: "shared-batch-config-mismatched-for-low-traffic",
  resolution: `\`otel-collector-config\` shows a single, shared \`batch\` processor
configuration - \`send_batch_size: 8192\`, \`timeout: 30s\` - applied
uniformly to every service's traces, with no per-pipeline override.
\`batch-processor-notes\` shows why that hurts a low-traffic service
specifically: notifications-worker produces only 15-20 spans a minute, so
the 8192-span size threshold is practically unreachable on its own - a
batch would need to sit open for hours of accumulation to hit it by size
alone. That leaves the 30-second timeout as the only realistic flush
trigger, and under very low, bursty throughput that timeout hasn't been
firing as reliably every single cycle as it would under a steadier load,
letting spans accumulate across several missed cycles before something
finally triggers a flush - exactly the erratic, up-to-20-minute delays
observed. High-traffic services never hit this because they fill batches
on size well before the timeout is ever relevant.

The fix is giving low-traffic pipelines their own batch processor tuned
for their actual volume, rather than sharing one config built around
high-traffic assumptions:

\`\`\`yaml
processors:
  batch/low-traffic:
    send_batch_size: 50
    timeout: 5s
  batch/high-traffic:
    send_batch_size: 8192
    timeout: 30s
service:
  pipelines:
    traces/notifications-worker:
      receivers: [otlp]
      processors: [batch/low-traffic]
      exporters: [otlp]
\`\`\`

A single batch configuration tuned for a busy service's throughput
quietly becomes a delivery-latency problem for a quiet one - splitting
pipelines (or lowering the shared size threshold and timeout to fit the
quietest service in the mix) keeps low-traffic traces from waiting behind
a size threshold they'll never reach on their own.`,
};
