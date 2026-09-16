import type { Scenario } from "../types";

export const theBlockingJdbcInWebflux: Scenario = {
  id: "the-blocking-jdbc-in-webflux",
  title: "The Blocking JDBC in WebFlux",
  subtitle: "activity-feed-api's whole reactive pipeline grinds to a halt under load that should barely register",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "webflux", "reactive"],
  briefing: `"activity-feed-api" was built on WebFlux specifically to handle high
concurrency with a small number of threads. Under real traffic, though,
it falls over at request volumes that should be well within a reactive
stack's comfort zone - throughput flatlines and latency climbs sharply,
even though CPU usage stays surprisingly low.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "activity-feed-api", namespace: "social", labels: { app: "activity-feed-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "activity-feed-api", image: "registry.internal/activity-feed-api:1.9.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "9d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "activity-feed-api-8t9u0v1w2-x3y4z", namespace: "social", labels: { app: "activity-feed-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "activity-feed-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "activity-feed-api": [
            "2026-09-15T13:00:01.114Z INFO  c.e.social.FeedHandler - handling feed request for user-88213 on reactor-http-nio-3",
            "2026-09-15T13:00:04.884Z WARN  r.n.FluxReceive - reactor-http-nio-3 has not been able to poll new work in 3708ms, blocking calls suspected",
            "2026-09-15T13:00:04.886Z INFO  c.e.social.ModerationFlagStore - checked moderation flags for user-88213 via JdbcTemplate (blocking call, 3690ms under contention)",
          ],
        },
        age: "9d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "activity-feed-api-notes", namespace: "social" },
        spec: {
          data: {
            "FeedHandler.java.excerpt":
              "public Mono<FeedResponse> getFeed(String userId) {\n    return feedRepository.findRecentActivity(userId)  // reactive, R2DBC\n        .collectList()\n        .map(activities -> {\n            boolean flagged = moderationFlagStore.isFlagged(userId); // <-\n            // ModerationFlagStore was written before this service moved\n            // to WebFlux, and still uses plain JdbcTemplate internally -\n            // a blocking call, made from inside a .map() operator that\n            // runs directly on one of Netty's small, fixed pool of\n            // event-loop threads\n            return buildResponse(activities, flagged);\n        });\n}\n",
          },
        },
        age: "9d",
      },
    ],
  },
  hints: [
    "`kubectl logs activity-feed-api-8t9u0v1w2-x3y4z -n social` - `reactor-http-nio-3 has not been able to poll new work` is Reactor Netty warning about a blocked event-loop thread. What's blocking it?",
    "Netty's event loop is a small, fixed pool of threads shared across *every* in-flight request - a blocking call made from inside a reactive operator on one of those threads doesn't just slow down its own request, it stalls everything else scheduled on that same thread.",
    "`kubectl get configmap activity-feed-api-notes -n social -o yaml` - `ModerationFlagStore.isFlagged` is called from inside a `.map()` operator. What does it actually do internally, and is that operator running on an event-loop thread?",
  ],
  options: [
    {
      id: "blocking-jdbctemplate-call-on-netty-event-loop-thread",
      label:
        "`ModerationFlagStore.isFlagged()` uses a plain, blocking `JdbcTemplate` call internally, and it's invoked from inside a `.map()` operator that runs directly on one of Reactor Netty's small, fixed pool of event-loop threads - so every call blocks that thread for however long the JDBC query takes, and because the same small handful of event-loop threads service *every* concurrent request, even a modest number of concurrent feed requests is enough to exhaust them and stall the whole reactive pipeline, explaining both the low CPU (threads are blocked waiting, not computing) and the sharp throughput collapse well below what WebFlux should handle.",
      explanation:
        "Reactor Netty's own warning names the mechanism directly: `has not been able to poll new work in 3708ms, blocking calls suspected` - and the very next line confirms exactly that: `checked moderation flags ... via JdbcTemplate (blocking call, 3690ms under contention)`. `activity-feed-api-notes` shows where: `ModerationFlagStore.isFlagged()` is called from inside a `.map()` operator in `FeedHandler`, which by default executes on the same event-loop thread that received the request - a thread from a small, fixed pool shared across all concurrent requests. Blocking even one of those threads for several seconds is enough to starve every other request scheduled on it, which is exactly why throughput collapses at request volumes that shouldn't stress a properly non-blocking reactive pipeline at all.",
    },
    {
      id: "r2dbc-connection-pool-too-small",
      label: "The R2DBC connection pool backing `feedRepository` is simply too small for the traffic.",
      explanation:
        "The warning and the follow-up log line both attribute the delay specifically to `ModerationFlagStore`'s JDBC call, not to `feedRepository`'s R2DBC queries - there's no pool-exhaustion signal for the reactive datasource anywhere in the evidence, only a blocking call flagged on the event-loop thread itself.",
    },
    {
      id: "too-few-replicas-for-reactive-workload",
      label: "Two replicas isn't enough to handle activity-feed-api's traffic, reactive or not.",
      explanation:
        "More replicas would only multiply the number of small, fixed event-loop thread pools available - each one would still individually stall the moment a blocking JDBC call runs on one of its own event-loop threads, so this wouldn't resolve the underlying architectural mismatch, only delay hitting the same wall.",
    },
    {
      id: "moderationflagstore-query-itself-slow",
      label: "`ModerationFlagStore`'s underlying SQL query is simply slow and needs an index.",
      explanation:
        "Reactor Netty's own warning is specifically about a thread being unable to poll for new work at all - a symptom of *blocking* an event-loop thread, not merely a slow-but-non-blocking query; even a well-indexed, fast blocking call made from this same code path would still stall the event loop for its duration, just less severely.",
    },
  ],
  correctOptionId: "blocking-jdbctemplate-call-on-netty-event-loop-thread",
  resolution: `Reactor Netty's own warning names the failure mode directly: \`reactor-http-nio-3
has not been able to poll new work in 3708ms, blocking calls suspected\`.
The very next log line confirms exactly what blocked it: \`checked
moderation flags for user-88213 via JdbcTemplate (blocking call, 3690ms
under contention)\`.

\`activity-feed-api-notes\` shows where that blocking call sits in the
pipeline: \`FeedHandler.getFeed()\` calls \`moderationFlagStore.isFlagged()\`
from inside a \`.map()\` operator, chained directly onto the reactive
\`feedRepository\` query. \`ModerationFlagStore\` predates this service's
move to WebFlux and still uses a plain, blocking \`JdbcTemplate\`
internally - and by default, a \`.map()\` operator executes on whichever
thread the upstream signal arrives on, which here is one of Reactor
Netty's small, fixed pool of event-loop threads. That pool is shared
across *every* concurrent request the service handles; blocking even one
of those threads for the duration of a JDBC call means every other
request scheduled on that same thread is stuck waiting too. Because the
pool is small by design (that's the whole point of a reactive,
non-blocking architecture), it takes surprisingly few concurrent blocking
calls to exhaust it entirely - CPU stays low because threads are parked
waiting on I/O, not computing anything.

The fix is moving the blocking call off the event-loop thread entirely,
onto a dedicated bounded scheduler meant for exactly this:

\`\`\`java
public Mono<FeedResponse> getFeed(String userId) {
    return feedRepository.findRecentActivity(userId)
        .collectList()
        .zipWith(
            Mono.fromCallable(() -> moderationFlagStore.isFlagged(userId))
                .subscribeOn(Schedulers.boundedElastic()) // runs the
                                                             // blocking
                                                             // call on a
                                                             // dedicated
                                                             // pool, not
                                                             // the
                                                             // event loop
        )
        .map(tuple -> buildResponse(tuple.getT1(), tuple.getT2()));
}
\`\`\`

The longer-term fix is migrating \`ModerationFlagStore\` to a non-blocking
client (R2DBC, or a reactive HTTP call) entirely - \`boundedElastic()\`
unblocks the event loop immediately, but every blocking call still
consumes a thread from its own separate, finite pool, and needs the same
scrutiny anywhere it's used inside a reactive pipeline.`,
};
