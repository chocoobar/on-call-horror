import type { Scenario } from "./types";

export const theWebclientWithNoTimeout: Scenario = {
  id: "the-webclient-with-no-timeout",
  title: "The WebClient With No Timeout",
  subtitle: "shipment-tracker's connection pool slowly fills up and stops accepting new requests every afternoon",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "webclient", "networking"],
  briefing: `"shipment-tracker" calls a third-party carrier API to fetch live tracking
updates. Every afternoon around the carrier's own peak load, shipment-tracker
starts timing out on requests that don't even touch the carrier API - as
if it's simply run out of capacity. Restarting the pod fixes it instantly,
every time, for another few hours.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipment-tracker", namespace: "logistics", labels: { app: "shipment-tracker" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "shipment-tracker", image: "registry.internal/shipment-tracker:3.0.4" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipment-tracker-7r6s5t4u3-v2w1x", namespace: "logistics", labels: { app: "shipment-tracker" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipment-tracker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipment-tracker": [
            "2026-09-15T15:40:02.114Z INFO  c.e.logistics.CarrierClient - fetching tracking for shipment SHP-88213 from carrier-api",
            "2026-09-15T15:44:58.980Z WARN  reactor.netty.http.client.PoolAcquireTimeoutException - Pool#acquire(...) has been pending for more than the configured timeout of 45000ms",
            "2026-09-15T15:44:58.982Z ERROR c.e.logistics.OrderStatusController - timed out fetching /orders/current-status, unrelated to carrier API",
          ],
        },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipment-tracker-notes", namespace: "logistics" },
        spec: {
          data: {
            "CarrierClient.java.excerpt":
              "@Bean\npublic WebClient carrierWebClient() {\n    return WebClient.builder()\n        .baseUrl(\"https://carrier-api.example.com\")\n        .build(); // no responseTimeout(), no connection-provider max\n                  // idle time - default Reactor Netty connection\n                  // pool is shared across ALL WebClient beans that\n                  // don't specify their own ConnectionProvider\n}\n",
            "notes.md":
              "This app uses the default, shared `ConnectionProvider` for every\n`WebClient` bean, including one used internally between `OrderStatusController`\nand another in-cluster service. Without an explicit `.responseTimeout()`,\na hung request to a slow carrier just holds its connection (and a slot in\nthe shared pool) open indefinitely, waiting for a response that may never\ncome.",
          },
        },
        age: "7d",
      },
    ],
  },
  hints: [
    "`kubectl logs shipment-tracker-7r6s5t4u3-v2w1x -n logistics` - `PoolAcquireTimeoutException` means a request is waiting for a connection *slot*, not for a response. What's holding those slots?",
    "The failing request in the second error line has nothing to do with the carrier API at all - what do the two log lines have in common?",
    "`kubectl get configmap shipment-tracker-notes -n logistics -o yaml` - is there a `.responseTimeout()` configured on `carrierWebClient`? What happens to a connection when a downstream call never responds and there's no timeout to give up on it?",
  ],
  options: [
    {
      id: "no-response-timeout-exhausts-shared-pool",
      label:
        "`carrierWebClient` has no `.responseTimeout()` configured, so a request to a slow carrier during its own peak load just holds a connection slot open indefinitely instead of failing fast; because the default Reactor Netty connection pool is shared across every `WebClient` bean in the app that doesn't specify its own provider, enough of those hung carrier calls eventually exhaust the shared pool and starve completely unrelated internal calls too.",
      explanation:
        "The `PoolAcquireTimeoutException` fires because a request is stuck waiting for a *connection slot*, not a response - and the very next failure is for an entirely unrelated internal endpoint, `/orders/current-status`, which never talks to the carrier API at all. `shipment-tracker-notes` explains the link: `carrierWebClient` has no `.responseTimeout()`, so slow carrier calls during its peak load hang onto pool connections indefinitely instead of failing and releasing them - and because the pool is shared across all `WebClient` beans by default, enough hung carrier requests are enough to starve every other caller of a connection slot too.",
    },
    {
      id: "carrier-api-outage",
      label: "The carrier API itself is having an outage during its peak load window.",
      explanation:
        "Even a real carrier-side outage wouldn't explain unrelated internal calls (`/orders/current-status`, which never touches the carrier API) timing out on pool acquisition - that failure mode is specific to a shared, exhaustible connection pool, not to one downstream dependency being unavailable.",
    },
    {
      id: "not-enough-replicas",
      label: "Two replicas isn't enough capacity to handle the afternoon traffic spike.",
      explanation:
        "A restart fixes the problem instantly and it recurs hours later on the same pod, which points at something accumulating and being reset by a restart - a fixed pool of connections filling up - rather than a raw capacity ceiling, which a restart wouldn't meaningfully change.",
    },
    {
      id: "carrier-api-rate-limiting",
      label: "The carrier API is rate-limiting shipment-tracker during its own peak load.",
      explanation:
        "Rate limiting would typically surface as an HTTP 429 response from the carrier, not a client-side `PoolAcquireTimeoutException` on a request that hasn't even gotten a connection yet - and it wouldn't explain a completely unrelated internal endpoint failing the same way.",
    },
  ],
  correctOptionId: "no-response-timeout-exhausts-shared-pool",
  resolution: `The exception itself is the clue: \`PoolAcquireTimeoutException\` means a
request timed out waiting for a *connection slot* from the pool, not
waiting for an HTTP response. And the very next failure, a few
milliseconds later, is for \`/orders/current-status\` - an endpoint that has
nothing to do with the carrier API at all. Two failures, two different
call paths, one shared resource being exhausted between them.

\`shipment-tracker-notes\` explains the setup: \`carrierWebClient\` is built
with no \`.responseTimeout()\`, so a request to a carrier that's slow (or
unresponsive) during its own peak load just sits there, holding its
connection open, with nothing to ever time it out and release that
connection back to the pool. And because this app never gives
\`carrierWebClient\` its own dedicated \`ConnectionProvider\`, it shares the
default Reactor Netty pool with every other \`WebClient\` bean in the
process - including the one used internally between \`OrderStatusController\`
and another service. Enough carrier calls hanging at once and there simply
aren't any connections left for anything else, carrier-related or not.

The fix is two-fold: give the carrier client an explicit response timeout
so slow calls fail and release their connection instead of hanging
forever, and give it its own isolated connection pool so a slow
third-party dependency can't starve unrelated internal traffic:

\`\`\`java
@Bean
public WebClient carrierWebClient() {
    ConnectionProvider carrierPool = ConnectionProvider.builder("carrier-pool")
        .maxConnections(50)
        .build();

    return WebClient.builder()
        .baseUrl("https://carrier-api.example.com")
        .clientConnector(new ReactorClientHttpConnector(
            HttpClient.create(carrierPool).responseTimeout(Duration.ofSeconds(5))))
        .build();
}
\`\`\`

Any \`WebClient\` calling an external dependency should get both an
explicit timeout and its own connection pool - without them, one slow
third party can quietly starve every other caller sharing the same
default pool.`,
};
