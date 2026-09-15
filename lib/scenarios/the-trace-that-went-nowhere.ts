import type { Scenario } from "./types";

export const theTraceThatWentNowhere: Scenario = {
  id: "the-trace-that-went-nowhere",
  title: "The Trace That Went Nowhere",
  subtitle: "every distributed trace for checkout-api ends mid-request, right before the slow part",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["tracing", "opentelemetry", "async"],
  briefing: `On-call is trying to root-cause a real latency spike on "checkout-api"
using distributed tracing, exactly as intended. Every trace for a slow
request tells the same frustrating story: a clean, fast span for the
initial HTTP handling, and then... nothing. The actual slow work
downstream never shows up as part of the same trace.`,
  constraints: [
    "The downstream work is confirmed to be happening and to be genuinely slow (visible in that service's own logs) - it just never appears connected to the originating request's trace.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-api-7g8h9i0j1-k2l3m", namespace: "checkout", labels: { app: "checkout-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-api": [
            "2026-09-15T10:00:00.100Z INFO  [traceId=7f3a9c,spanId=01] c.e.checkout.OrderController - received checkout request",
            "2026-09-15T10:00:00.110Z INFO  [traceId=7f3a9c,spanId=01] c.e.checkout.OrderController - dispatching async fraud check",
            "2026-09-15T10:00:00.115Z INFO  [traceId=7f3a9c,spanId=01] c.e.checkout.OrderController - request accepted, returning 202",
            "2026-09-15T10:00:07.884Z INFO  [traceId=,spanId=] c.e.checkout.FraudCheckWorker - fraud check completed for order-9921 in 7760ms",
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-api-tracing-notes", namespace: "checkout" },
        spec: {
          data: {
            "OrderController.java.excerpt":
              "@PostMapping(\"/checkout\")\npublic ResponseEntity<?> checkout(@RequestBody Order order) {\n    log.info(\"received checkout request\");\n    executorService.submit(() -> fraudCheckWorker.check(order));  // hands\n        // off to a plain, unwrapped ExecutorService - the OpenTelemetry\n        // agent's context propagation only follows a request thread\n        // automatically; it does not automatically follow a Runnable\n        // submitted to a manually-created thread pool.\n    return ResponseEntity.accepted().build();\n}\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl logs checkout-api-7g8h9i0j1-k2l3m -n checkout` - the initial request logs carry a real `traceId`. What does the `FraudCheckWorker` log line's `traceId` look like by comparison?",
    "`kubectl get configmap checkout-api-tracing-notes -n checkout -o yaml` - look at how the async fraud check work actually gets dispatched.",
    "OpenTelemetry's automatic instrumentation propagates trace context along the current thread (and a few well-known async wrappers it explicitly supports) - it isn't magic that follows any and every hand-off to a different thread, especially a plain `ExecutorService.submit(Runnable)` with no context-carrying wrapper.",
  ],
  options: [
    {
      id: "context-not-propagated-to-plain-executor",
      label:
        "`OrderController` hands the fraud check off to a plain `ExecutorService.submit(...)`, and the OpenTelemetry agent's automatic context propagation doesn't follow a bare `Runnable` onto a manually-managed thread pool - the async work genuinely runs and genuinely takes ~7.7 seconds, but it starts a disconnected trace (or none at all) instead of continuing the original request's trace, which is exactly why the two ends of the same logical operation never show up connected.",
      explanation:
        "The logs make the disconnect visible directly: the initial request carries a real `traceId=7f3a9c`, while the `FraudCheckWorker` log line that actually reports the slow 7760ms operation has an empty `traceId=`. `checkout-api-tracing-notes` explains exactly why - the work is submitted to a plain `ExecutorService`, and automatic OpenTelemetry instrumentation only propagates trace context along mechanisms it explicitly understands (the original thread, or specific supported async wrappers), not an arbitrary hand-off to a manually created thread pool. The slow work is real and is happening exactly where the trace goes quiet - it's just invisible to tracing because nothing carried the context across that particular boundary.",
    },
    {
      id: "tracing-backend-dropping-spans",
      label: "The tracing backend (e.g. Jaeger or Tempo) is dropping spans under load.",
      explanation:
        "The fast initial span is present and complete every time, and the downstream work's own application logs confirm it ran successfully with a real duration - what's missing is a *connection* between the two, not spans being dropped after being correctly created and sent.",
    },
    {
      id: "sampling-rate-too-low",
      label: "The tracing sampling rate is set too low, so most of this trace was never captured.",
      explanation:
        "The problem is consistent and total - the async portion is *never* connected to its parent trace, on every single request - rather than the intermittent, statistical pattern a sampling rate that's merely too low would produce.",
    },
    {
      id: "fraud-check-worker-not-instrumented",
      label: "FraudCheckWorker's code isn't instrumented for tracing at all.",
      explanation:
        "The empty `traceId=` field in its log line is still a real, populated logging pattern reflecting the current trace context (or lack thereof) - if the class had no tracing instrumentation at all, that log field wouldn't be wired up to attempt reporting a trace ID in the first place. It's participating in tracing, just with no context to report because none was propagated to it.",
    },
  ],
  correctOptionId: "context-not-propagated-to-plain-executor",
  resolution: `The two log lines side by side make the break visible directly: the
initial request carries \`traceId=7f3a9c\`; the \`FraudCheckWorker\` line
reporting the actual slow 7760ms operation carries an empty \`traceId=\`.
\`checkout-api-tracing-notes\` explains exactly why - \`OrderController\`
hands the fraud check off via a plain \`executorService.submit(...)\` onto a
manually-created thread pool. Automatic OpenTelemetry instrumentation
propagates trace context along paths it explicitly understands: the
current thread, and a handful of well-supported async abstractions
(certain reactive/async wrappers, some standard executors when
instrumented). A bare, hand-rolled \`ExecutorService\` submission isn't one
of them by default - the \`Runnable\` that actually runs the slow work
starts with no trace context attached at all, so it either begins a
disconnected trace of its own or (as the empty field shows) none.

The real, slow work is genuinely happening exactly where the original
trace goes quiet - this isn't a tracing backend problem or a missing
instrumentation problem, it's a context-propagation gap at one specific
async boundary.

The fix is manually propagating the context across that boundary, using
OpenTelemetry's context API to wrap the submitted task:

\`\`\`java
Context callingContext = Context.current();
executorService.submit(callingContext.wrap(() -> fraudCheckWorker.check(order)));
\`\`\`

(or, more durably, switching to a context-propagating executor wrapper
provided by the OpenTelemetry instrumentation library, so every future use
of this executor is covered automatically instead of needing a manual
wrap at every call site.) Once the context crosses the thread boundary
correctly, the async fraud check shows up as a child span of the original
request's trace, and root-causing latency across this async hand-off
stops requiring manually correlating two separate services' logs by hand.`,
};
