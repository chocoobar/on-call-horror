import type { Scenario } from "./types";

export const theStructuredConcurrencyOrphan: Scenario = {
  id: "the-structured-concurrency-orphan",
  title: "The Structured Concurrency Orphan",
  subtitle: "trip-pricing-api sometimes returns a full quote built from a partial, silently-failed set of fare lookups",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "structured-concurrency", "virtual-threads"],
  briefing: `"trip-pricing-api" fans out to three independent fare providers concurrently
using Java 25's structured concurrency, combines whichever results come
back, and returns a single quote. Occasionally, customers get a quote
that's obviously too low - missing one provider's fare entirely - with no
error, no timeout logged, and no indication anything went wrong.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "trip-pricing-api", namespace: "travel", labels: { app: "trip-pricing-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "trip-pricing-api", image: "registry.internal/trip-pricing-api:1.0.2" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "trip-pricing-api-1m2n3o4p5-q6r7s", namespace: "travel", labels: { app: "trip-pricing-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "trip-pricing-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "trip-pricing-api": [
            "2026-09-15T14:00:01.114Z INFO  c.e.travel.FareAggregator - fanning out to 3 fare providers for quote qte-90112",
            "2026-09-15T14:00:01.980Z ERROR c.e.travel.SkyFareClient - fetch failed: 503 Service Unavailable from sky-fare-provider",
            "2026-09-15T14:00:02.114Z INFO  c.e.travel.FareAggregator - returning quote qte-90112 with 2 of 3 fares combined (no error surfaced)",
          ],
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "trip-pricing-api-notes", namespace: "travel" },
        spec: {
          data: {
            "FareAggregator.java.excerpt":
              "try (var scope = StructuredTaskScope.open()) {\n    Subtask<Fare> sky = scope.fork(() -> skyFareClient.fetch(trip));\n    Subtask<Fare> land = scope.fork(() -> landFareClient.fetch(trip));\n    Subtask<Fare> rail = scope.fork(() -> railFareClient.fetch(trip));\n\n    scope.join(); // waits for all subtasks, but does NOT itself\n                    // throw if one subtask failed - that's a separate\n                    // step\n\n    // missing: scope.throwIfFailed() (or checking each Subtask's own\n    // state() before calling .get()) - the code goes straight to\n    // reading results, and silently skips any subtask whose state()\n    // isn't SUCCESS instead of propagating its failure\n    List<Fare> fares = Stream.of(sky, land, rail)\n        .filter(t -> t.state() == Subtask.State.SUCCESS)\n        .map(Subtask::get)\n        .toList();\n    return combine(fares); // combines whatever succeeded, silently\n}\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl logs trip-pricing-api-1m2n3o4p5-q6r7s -n travel` - `SkyFareClient` throws a real error, but the very next line returns a quote with only 2 of 3 fares and says explicitly 'no error surfaced.' Where does that swallowed failure go?",
    "`kubectl get configmap trip-pricing-api-notes -n travel -o yaml` - `scope.join()` waits for every subtask to finish, but does it, on its own, throw if one of them failed?",
    "The code filters subtasks by `state() == Subtask.State.SUCCESS` before reading results - what happens to a subtask whose state is `FAILED` under that filter?",
  ],
  options: [
    {
      id: "join-without-throwiffailed-swallows-subtask-failure",
      label:
        "`FareAggregator` calls `scope.join()`, which waits for every forked subtask to complete but does not itself propagate a subtask's failure - the code never calls `scope.throwIfFailed()` (or otherwise checks for failure) and instead just filters subtasks down to whichever succeeded, silently dropping any that threw, so a real, logged exception from one provider (`SkyFareClient`'s 503) never stops the aggregator from happily combining and returning a partial, artificially low quote as if nothing had gone wrong.",
      explanation:
        "The log shows `SkyFareClient` throwing a genuine, logged `503 Service Unavailable` error, and the very next line shows `FareAggregator` returning a quote built from only 2 of 3 fares, explicitly noting 'no error surfaced.' `trip-pricing-api-notes` shows exactly why: `scope.join()` alone doesn't propagate a child subtask's failure - the code needed an explicit `scope.throwIfFailed()` (or per-subtask state checking that actually acts on a `FAILED` state) to stop and report the problem. Instead, it filters for `SUCCESS` subtasks only, silently discarding the failed one and combining whatever's left into a complete-looking result.",
    },
    {
      id: "skyfareclient-retry-exhausted-silently",
      label: "SkyFareClient has an internal retry mechanism that's silently exhausting its attempts.",
      explanation:
        "The log shows a single, direct failure from `SkyFareClient` with no retry attempts logged at all - the problem isn't retries being exhausted quietly, it's that this one clearly-logged failure never gets propagated out of the structured concurrency scope that caught it.",
    },
    {
      id: "virtual-thread-pinning-during-fanout",
      label: "One of the fare provider calls is pinning its virtual thread, causing the fan-out to partially stall.",
      explanation:
        "There's no pinned-thread warning or unusual delay in the logs - the failure is a clean, fast HTTP error response from the provider, and the actual defect is in how `FareAggregator` handles a subtask's *failure* outcome, not in any thread-pinning or stalling behavior.",
    },
    {
      id: "combine-method-drops-a-fare-randomly",
      label: "The `combine()` method itself has a bug that randomly drops one fare from the result.",
      explanation:
        "`combine()` only ever receives the list of fares that already passed the `SUCCESS`-state filter - by the time it runs, the sky fare has already been excluded upstream because its subtask failed, not because `combine()` dropped a valid, successfully-fetched fare.",
    },
  ],
  correctOptionId: "join-without-throwiffailed-swallows-subtask-failure",
  resolution: `The logs show the failure happening in plain sight: \`SkyFareClient\`
throws a real, clearly logged \`503 Service Unavailable\`. And yet the very
next line shows \`FareAggregator\` returning a completed-looking quote with
only 2 of the 3 fares combined, explicitly noting "no error surfaced" -
the failure was seen and then quietly dropped rather than acted on.

\`trip-pricing-api-notes\` shows exactly where that happens:
\`FareAggregator\` opens a \`StructuredTaskScope\`, forks all three fare
lookups, and calls \`scope.join()\` to wait for them. \`join()\` on its own
only waits - it does not throw or otherwise signal that a subtask failed;
that's a separate, deliberate step (\`scope.throwIfFailed()\`, or
individually inspecting each \`Subtask\`'s \`state()\`). This code skips that
step entirely and instead filters subtasks down to \`state() ==
Subtask.State.SUCCESS\` before reading any results - which quietly
excludes the failed sky-fare subtask from the list handed to \`combine()\`,
producing a fully-formed, seemingly-complete quote that's actually
missing a third of its real cost.

The fix is making a subtask's failure a first-class outcome the
aggregator has to handle, not one it can silently filter past:

\`\`\`java
try (var scope = StructuredTaskScope.open(
        StructuredTaskScope.Joiner.<Fare>allSuccessfulOrThrow())) {
    Subtask<Fare> sky = scope.fork(() -> skyFareClient.fetch(trip));
    Subtask<Fare> land = scope.fork(() -> landFareClient.fetch(trip));
    Subtask<Fare> rail = scope.fork(() -> railFareClient.fetch(trip));

    List<Fare> fares = scope.join(); // throws immediately if any
                                       // subtask failed - forces an
                                       // explicit decision instead of a
                                       // silent partial result
    return combine(fares);
} catch (FailedException e) {
    throw new QuoteUnavailableException("one or more fare providers failed", e);
}
\`\`\`

Structured concurrency makes it easy to fan out cleanly, but \`join()\`
alone is not the same as "and fail loudly if something went wrong" -
that has to be either an explicit \`Joiner\` policy or an explicit
\`throwIfFailed()\`/per-subtask check, or a genuine partial failure will
silently pass for a complete success.`,
};
