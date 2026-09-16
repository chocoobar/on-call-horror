import type { Scenario } from "../types";

export const theDeadlineThatEvaporated: Scenario = {
  id: "the-deadline-that-evaporated",
  title: "The Deadline That Evaporated",
  subtitle: "geo-routing-service keeps burning CPU on requests its own caller has already given up on",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "grpc", "spring-boot"],
  briefing: `"dispatch-api" calls "geo-routing-service" over gRPC with a strict 500ms
deadline per call, and gives up cleanly when it's exceeded. Under load,
though, "geo-routing-service" itself shows sustained high CPU doing real
route-calculation work for client requests that dispatch-api has already
long since abandoned and retried elsewhere - work that's now entirely
wasted, but nobody can find where the deadline information is supposed to
be lost.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "geo-routing-service", namespace: "dispatch", labels: { app: "geo-routing-service" } },
        spec: { replicas: 4, template: { spec: { containers: [{ name: "geo-routing-service", image: "registry.internal/geo-routing-service:2.3.0" }] } } },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "11d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "geo-routing-service-2h3i4j5k6-l7m8n", namespace: "dispatch", labels: { app: "geo-routing-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "geo-routing-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "geo-routing-service": [
            "2026-09-15T14:00:00.110Z INFO  c.e.dispatch.RouteGrpcService - received CalculateRoute for req-77201, client deadline 500ms",
            "2026-09-15T14:00:00.115Z INFO  c.e.dispatch.RouteEngine - starting route calculation (CPU-bound, typically 800ms-1.2s for complex routes)",
            "2026-09-15T14:00:00.620Z WARN  i.g.Context - client has already cancelled this call (deadline exceeded 120ms ago), continuing computation anyway",
            "2026-09-15T14:00:01.310Z INFO  c.e.dispatch.RouteEngine - route calculation completed for req-77201, discarding result (client gone)",
          ],
        },
        age: "11d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "geo-routing-service-notes", namespace: "dispatch" },
        spec: {
          data: {
            "RouteEngine.java.excerpt":
              "public RouteResult calculateRoute(RouteRequest request) {\n    // pure CPU-bound computation - no periodic check against the\n    // calling gRPC Context's deadline or cancellation state anywhere\n    // in this loop; once started, it always runs to completion\n    for (RoutingStep step : buildStepPlan(request)) {\n        applyStep(step);\n    }\n    return buildResult();\n}\n",
            "notes.md":
              "gRPC's `Context` (available via `Context.current()`) carries the\ncall's deadline and cancellation signal automatically for any code\nrunning within the scope of the RPC handler - but nothing reads it here.\n`RouteEngine.calculateRoute()` was written as a plain, synchronous,\nCPU-bound method with no awareness of gRPC at all, and has no periodic\ncheck against `Context.current().isCancelled()` anywhere in its\ncomputation loop.",
          },
        },
        age: "11d",
      },
    ],
  },
  hints: [
    "`kubectl logs geo-routing-service-2h3i4j5k6-l7m8n -n dispatch` - the server itself logs that the client already cancelled the call, then keeps computing anyway for another 700ms. What would it take to actually stop early?",
    "`kubectl get configmap geo-routing-service-notes -n dispatch -o yaml` - does `RouteEngine.calculateRoute()`'s computation loop ever check whether the call it's working on has been cancelled?",
    "gRPC's deadline propagation tells the server *that* the client gave up - it doesn't automatically stop a CPU-bound loop that never checks for it. Cancellation awareness has to be built into the computation itself.",
  ],
  options: [
    {
      id: "route-engine-never-checks-grpc-context-cancellation",
      label:
        "gRPC correctly propagates the client's deadline and cancellation signal to the server (the server's own log explicitly detects and reports the cancellation), but `RouteEngine.calculateRoute()` is a plain, CPU-bound loop with no periodic check against `Context.current().isCancelled()` anywhere in it - so even though the server *knows* the client gave up 120ms into a call, nothing in the computation itself ever looks, and it runs the full 1.3 seconds to completion regardless, burning real CPU on results that get thrown away the instant they're produced.",
      explanation:
        "The log shows the server itself detecting the cancellation in real time - `client has already cancelled this call (deadline exceeded 120ms ago), continuing computation anyway` - and then finishing the full computation nearly a second later before discarding the result. `geo-routing-service-notes` confirms `RouteEngine.calculateRoute()` never reads `Context.current().isCancelled()` at all during its computation loop; the deadline information reached the server just fine, it's simply never consulted by the code doing the actual CPU-bound work, which runs to completion unconditionally once started.",
    },
    {
      id: "dispatch-api-not-setting-a-deadline",
      label: "dispatch-api itself isn't actually setting a gRPC deadline on its calls.",
      explanation:
        "The server's own log confirms it received a real, specific deadline (`client deadline 500ms`) and later detected the resulting cancellation correctly - the deadline is being set and propagated exactly as intended; the gap is entirely on geo-routing-service's side, in never checking for the cancellation it already knows about.",
    },
    {
      id: "grpc-context-not-propagated-across-threads",
      label: "gRPC's `Context` isn't being propagated correctly across a thread boundary somewhere.",
      explanation:
        "The log shows the cancellation being detected and logged by the framework itself (`i.g.Context`), which proves `Context` propagation is working correctly - the issue is specifically that `RouteEngine`'s own computation logic never reads that already-correctly-propagated cancellation state.",
    },
    {
      id: "route-calculation-algorithm-too-slow",
      label: "RouteEngine's algorithm is simply too slow and needs to be optimized to fit within 500ms generally.",
      explanation:
        "Making the algorithm faster would help, but it doesn't address the core issue described - even a moderately fast algorithm will occasionally exceed a strict deadline under load, and the real waste here is continuing to compute for hundreds of milliseconds *after* already knowing the client is gone, which a faster algorithm alone wouldn't necessarily stop.",
    },
  ],
  correctOptionId: "route-engine-never-checks-grpc-context-cancellation",
  resolution: `The server's own log shows it knew, in real time, that the client had
given up: \`client has already cancelled this call (deadline exceeded
120ms ago), continuing computation anyway\`. And then it does exactly
that - continuing anyway - finishing the full route calculation nearly a
second later before finally discarding the now-useless result.

\`geo-routing-service-notes\` shows why: \`RouteEngine.calculateRoute()\` is a
plain, synchronous, CPU-bound method with no gRPC awareness built into
its computation loop at all. gRPC's \`Context\` mechanism correctly
propagates the call's deadline and cancellation state to any code running
within the RPC handler's scope - and the framework itself clearly has
access to that state, since it's the one logging the cancellation - but
nothing inside \`calculateRoute()\`'s step-by-step computation loop ever
reads \`Context.current().isCancelled()\` to actually act on it. Deadline
propagation and cancellation detection were never the missing piece here;
the missing piece is the computation itself checking for either.

The fix is making the computation loop periodically cancellation-aware,
so it can bail out early instead of running unconditionally to
completion:

\`\`\`java
public RouteResult calculateRoute(RouteRequest request) {
    Context context = Context.current();
    for (RoutingStep step : buildStepPlan(request)) {
        if (context.isCancelled()) {
            throw Status.CANCELLED
                .withDescription("client deadline exceeded, aborting route calculation")
                .asRuntimeException();
        }
        applyStep(step);
    }
    return buildResult();
}
\`\`\`

Checking cancellation once per meaningful unit of work (once per routing
step here, rather than continuously) is usually enough to turn "always
runs to completion" into "stops within a step or two of the client giving
up" - reclaiming real CPU for requests that are actually still being
waited on, instead of spending it on results nobody will ever see.`,
};
