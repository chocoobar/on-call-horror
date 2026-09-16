import type { Scenario } from "../types";

export const theMemoryLimiterThatDroppedSilently: Scenario = {
  id: "the-memory-limiter-that-dropped-silently",
  title: "The Memory Limiter That Dropped Silently",
  subtitle: "trace volume for the whole cluster craters every afternoon, right when everyone's busiest",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["opentelemetry", "collector", "memory-limiter"],
  briefing: `Every weekday afternoon, right during peak traffic, the total volume of
traces landing in Tempo drops noticeably across every service - not to
zero, but down significantly, before recovering in the evening as
traffic tapers off. The OpenTelemetry Collector's own pods stay Running
the whole time, never restarting, never OOMKilled.`,
  constraints: [
    "Every instrumented service's own span-emission rate (measured client-side via SDK metrics) stays proportional to real traffic throughout - the services themselves never stop trying to send spans.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "otel-collector", namespace: "observability", labels: { app: "otel-collector" } },
        spec: {
          replicas: 4,
          template: {
            spec: {
              containers: [
                { name: "otel-collector", resources: { limits: { memory: "2Gi" }, requests: { memory: "1Gi" } } },
              ],
            },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "otel-collector-config", namespace: "observability" },
        spec: {
          data: {
            "config.yaml":
              "processors:\n  memory_limiter:\n    check_interval: 5s\n    limit_mib: 1800\n    spike_limit_mib: 500\n    # memory_limiter sits ahead of batch/export in the pipeline - once\n    # measured memory exceeds limit_mib, it begins REFUSING new incoming\n    # data (returning an error upstream, and for gRPC-received data,\n    # dropping/refusing it) until memory drops back under the limit\n    # minus spike_limit_mib.\n  batch:\n    send_batch_size: 8192\nservice:\n  pipelines:\n    traces:\n      processors: [memory_limiter, batch]\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "collector-memory-behavior-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "Collector memory usage tracks trace volume closely, and peak afternoon\ntraffic pushes each Collector replica's memory usage up against the\n`memory_limiter` processor's 1800MiB limit - comfortably under the pod's\n2Gi hard limit, so the pod is never OOMKilled by Kubernetes. Once\n`memory_limiter` starts refusing incoming data to protect itself from\nexceeding its configured limit, it does so silently from the sending\nservice's perspective in this setup: the Collector's gRPC receiver\nreturns a `RESOURCE_EXHAUSTED` error, and the OpenTelemetry SDK's\nexporter, configured here with retry disabled\n(`otlp.retry.enabled = false` in each service's SDK config, set months\nago as an unrelated latency optimization to avoid blocking application\nrequests on span export retries), simply drops the batch and moves on\nrather than retrying - with no application-visible error, since span\nexport failures don't propagate up as request failures.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap otel-collector-config -n observability -o yaml` - what does the `memory_limiter` processor actually do once measured memory exceeds `limit_mib`? Does it wait, queue, or refuse new data?",
    "`kubectl get configmap collector-memory-behavior-notes -n observability -o yaml` - is the Collector pod ever actually OOMKilled, or does `memory_limiter` step in before that happens? And what does each service's SDK do when its export gets refused?",
    "If the SDK's retry is disabled and a refused export doesn't propagate as an application-visible error, a Collector protecting itself from memory pressure can drop a meaningful share of traces with no signal anywhere in the pipeline that anything was lost.",
  ],
  options: [
    {
      id: "memory-limiter-refuses-data-sdk-drops-silently-no-retry",
      label:
        "Peak afternoon traffic pushes each Collector replica's memory usage up against the `memory_limiter` processor's configured 1800MiB limit - well under the pod's 2Gi hard limit, so it's never OOMKilled - and once triggered, `memory_limiter` refuses incoming data to protect itself; with each service's OpenTelemetry SDK configured months ago with export retry disabled as a latency optimization, a refused export is simply dropped rather than retried, with no application-visible error, explaining exactly why trace volume craters every afternoon at peak load with the Collector pods themselves staying healthy and Running the whole time.",
      explanation:
        "`otel-collector-config` confirms `memory_limiter` refuses new data once its `limit_mib` is exceeded, sitting ahead of batching/export in the pipeline. `collector-memory-behavior-notes` confirms Collector memory usage tracks peak traffic up against that limit (well under the pod's 2Gi hard limit, so no OOMKill occurs), and that retry is disabled in each service's SDK config, causing refused exports to be silently dropped with no propagated application error - fully consistent with every instrumented service's own span-emission rate staying proportional to real traffic (they're still trying to send, exactly as confirmed) while the Collector, protecting its own memory, silently refuses to accept a share of what's sent during peak load.",
    },
    {
      id: "collector-pods-oomkilled-and-restarting",
      label: "The Collector pods are being OOMKilled and restarting during peak load, losing in-flight data.",
      explanation:
        "The scenario explicitly confirms Collector pods stay Running the entire time, never restarting or getting OOMKilled - `memory_limiter` is specifically designed to intervene and refuse new data before memory pressure ever reaches the point of triggering an actual OOM kill, which is exactly what's happening here instead.",
    },
    {
      id: "services-stop-emitting-spans-under-load",
      label: "Instrumented services themselves stop emitting spans under peak load to reduce application overhead.",
      explanation:
        "Every service's own span-emission rate, measured client-side via SDK metrics, is confirmed to stay proportional to real traffic throughout - the services keep trying to send spans at a normal, proportional rate; the loss happens downstream, at the Collector, refusing to accept some of what's sent.",
    },
    {
      id: "tempo-ingestion-rate-limiting-during-peak",
      label: "Tempo itself is rate-limiting ingestion from the Collector fleet during peak hours.",
      explanation:
        "There's no evidence of a Tempo-side rate limit here - the evidenced mechanism is entirely upstream of Tempo, inside the Collector's own `memory_limiter` processor refusing data before it's ever batched and exported, which is a sufficient and directly configured explanation without needing to assume a separate Tempo-side limit.",
    },
  ],
  correctOptionId: "memory-limiter-refuses-data-sdk-drops-silently-no-retry",
  resolution: `\`otel-collector-config\` shows the \`memory_limiter\` processor configured
with \`limit_mib: 1800\`, sitting ahead of batching and export in the
pipeline - once measured memory exceeds that limit, it begins refusing
new incoming data rather than queuing or waiting, specifically to protect
the Collector process from exceeding its memory budget.
\`collector-memory-behavior-notes\` confirms Collector memory usage tracks
trace volume closely, and peak afternoon traffic pushes it right up
against that 1800MiB limit - comfortably under the pod's 2Gi hard limit,
which is exactly why the pods are never OOMKilled or restarted; \`memory_limiter\`
does its job and intervenes well before that point. The consequence is
what makes this invisible: the Collector's gRPC receiver returns a
\`RESOURCE_EXHAUSTED\` error for refused data, and each service's OpenTelemetry
SDK, configured months ago with export retry disabled as an unrelated
latency optimization, simply drops the refused batch and moves on rather
than retrying - with no application-visible error, since a failed span
export was never designed to propagate up as a request failure. Every
service keeps emitting spans proportional to real traffic the entire
time, exactly as confirmed - the loss happens silently, downstream, every
single afternoon that traffic is high enough to trigger the limiter.

Two independent gaps combine here: a memory limiter that protects the
Collector (correctly) at the cost of silently dropping data, and a
disabled-retry SDK configuration that turns "temporarily refused" into
"permanently lost" with no error trail anywhere.

The fix has a few angles: give the Collector fleet more memory headroom
(or more replicas) so peak load doesn't reach the limiter's threshold,
re-enable bounded retry in the SDK so a brief refusal gets a second
chance rather than an immediate silent drop, and alert directly on the
Collector's own refused-data metric:

\`\`\`yaml
processors:
  memory_limiter:
    limit_mib: 3200
    spike_limit_mib: 800
\`\`\`

\`\`\`promql
increase(otelcol_processor_refused_spans_total[5m]) > 0
\`\`\`

\`memory_limiter\` doing its job and refusing data under pressure is
working as designed - but without visibility into how often it's
triggering, and without any retry on the sending side, "protecting the
Collector" and "silently losing a chunk of every afternoon's traces" end
up being the exact same thing.`,
};
