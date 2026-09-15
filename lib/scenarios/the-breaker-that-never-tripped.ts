import type { Scenario } from "./types";

export const theBreakerThatNeverTripped: Scenario = {
  id: "the-breaker-that-never-tripped",
  title: "The Breaker That Never Tripped",
  subtitle: "checkout-recommendations kept hammering a fully-down partner API for twenty straight minutes",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "resilience4j", "circuit-breaker"],
  briefing: `A partner recommendation API went completely down for twenty minutes
this morning. "checkout-recommendations" has a circuit breaker specifically
meant to stop calling a dead dependency and fall back gracefully - but for
the entire outage, it kept sending requests at full volume, each one
slowly timing out, dragging checkout latency up across the board.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-recommendations", namespace: "commerce", labels: { app: "checkout-recommendations" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "checkout-recommendations", image: "registry.internal/checkout-recommendations:2.9.1" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "15d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-recommendations-7v8w9x0y1-z2a3b", namespace: "commerce", labels: { app: "checkout-recommendations" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-recommendations", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-recommendations": [
            "2026-09-15T09:40:01.884Z ERROR c.e.commerce.PartnerRecClient - call to partner-rec-api failed: connection timed out",
            "2026-09-15T09:52:40.220Z ERROR c.e.commerce.PartnerRecClient - call to partner-rec-api failed: connection timed out",
            "2026-09-15T09:52:41.010Z INFO  i.g.r.c.i.CircuitBreakerStateMachine - CircuitBreaker 'partnerRec' recorded failure, failure rate now 41.00%",
          ],
        },
        age: "15d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-recommendations-notes", namespace: "commerce" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "resilience4j:\n  circuitbreaker:\n    instances:\n      partnerRec:\n        sliding-window-type: COUNT_BASED\n        sliding-window-size: 100\n        minimum-number-of-calls: 100\n        failure-rate-threshold: 80\n        wait-duration-in-open-state: 30s\n",
            "notes.md":
              "checkout-recommendations only calls partner-rec-api for about 15% of\ncheckout sessions (the rest use a cheaper on-box heuristic), so under\nnormal traffic it takes several minutes to accumulate 100 calls in the\nsliding window at all. `failure-rate-threshold: 80` means 80 of those 100\ncalls need to fail before the breaker opens.",
          },
        },
        age: "15d",
      },
    ],
  },
  hints: [
    "`kubectl logs checkout-recommendations-7v8w9x0y1-z2a3b -n commerce` - the circuit breaker is recording failures and computing a failure rate. What's that rate, and what threshold does it need to cross to actually open?",
    "`kubectl get configmap checkout-recommendations-notes -n commerce -o yaml` - `minimum-number-of-calls: 100` on a call this only happens for 15% of checkout sessions. How long does it take to even accumulate 100 calls in the window?",
    "A circuit breaker's failure-rate threshold is only evaluated once the sliding window has enough calls in it - both the window size and the failure-rate threshold matter together, not separately.",
  ],
  options: [
    {
      id: "threshold-and-window-too-large-for-actual-traffic",
      label:
        "`partnerRec`'s circuit breaker needs 100 calls in its sliding window before it evaluates anything, and 80% of those need to fail before it opens - but this endpoint is only called for about 15% of checkout sessions, so during the outage it took minutes just to accumulate enough calls to evaluate, and the failure rate (41% at one point in the logs) never got close to the 80% threshold needed to actually trip the breaker, so it kept sending live traffic at a fully-down dependency for the entire incident.",
      explanation:
        "The log shows the breaker actively tracking failures - `failure rate now 41.00%` - well below the configured `failure-rate-threshold: 80`. `checkout-recommendations-notes` explains why the rate stayed so low despite every visible call failing: `minimum-number-of-calls: 100` combined with this endpoint's naturally low call volume (15% of sessions) means the sliding window fills slowly, and a mix of older successful calls sitting in that same 100-call window diluted the failure rate well below what was needed to open the breaker.",
    },
    {
      id: "circuit-breaker-not-wired-to-the-client",
      label: "The circuit breaker annotation isn't actually wired to PartnerRecClient's method at all.",
      explanation:
        "The logs explicitly show `CircuitBreakerStateMachine` recording failures against the `'partnerRec'` instance in direct response to `PartnerRecClient`'s failed calls - the wiring is working and the breaker is tracking state correctly, it just never crosses its configured threshold.",
    },
    {
      id: "wait-duration-in-open-state-too-short",
      label: "`wait-duration-in-open-state: 30s` is too short, so the breaker keeps closing again almost immediately.",
      explanation:
        "The breaker never reaches the open state at all during this incident - the failure rate logged (41%) never crosses the 80% threshold needed to open it in the first place, so how long it would stay open once opened isn't the relevant setting here.",
    },
    {
      id: "partner-api-returning-200-with-errors",
      label: "partner-rec-api is returning HTTP 200 responses with error payloads, which the breaker doesn't count as failures.",
      explanation:
        "The logged failures are `connection timed out` exceptions - genuine call failures that the circuit breaker is explicitly recording as failures (the failure rate is climbing) - not successful HTTP responses containing error bodies being misclassified as successes.",
    },
  ],
  correctOptionId: "threshold-and-window-too-large-for-actual-traffic",
  resolution: `The circuit breaker was working exactly as configured - the log shows it
actively recording failures and computing a failure rate: \`failure rate
now 41.00%\`. The problem is what it was configured *to*. The
\`failure-rate-threshold\` is 80%, and \`checkout-recommendations-notes\`
explains why the observed rate never got close: \`partnerRec\` is only
called for about 15% of checkout sessions, and the sliding window needs
\`minimum-number-of-calls: 100\` before the breaker evaluates anything at
all. During the twenty-minute outage, the window filled slowly with a mix
of new failing calls and older successful ones still sitting inside the
same 100-call window - diluting the failure rate well below the 80%
needed to actually open the breaker, even while every call the team could
see was failing outright.

The fix is sizing the breaker's window and threshold to match this
endpoint's real call volume, and lowering the bar for tripping on a
clearly dead dependency:

\`\`\`yaml
resilience4j:
  circuitbreaker:
    instances:
      partnerRec:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 20
        minimum-number-of-calls: 10
        failure-rate-threshold: 50
        wait-duration-in-open-state: 30s
\`\`\`

A circuit breaker's defaults (or values copied from a much higher-volume
call site) need to be checked against the *actual* call volume of the
endpoint they're protecting - a window and threshold sized for a
high-traffic path can leave a lower-traffic one effectively unprotected,
happily calling a fully-down dependency for as long as the outage lasts.`,
};
