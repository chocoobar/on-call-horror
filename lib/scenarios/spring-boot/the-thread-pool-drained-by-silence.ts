import type { Scenario } from "../types";

export const theThreadPoolDrainedBySilence: Scenario = {
  id: "the-thread-pool-drained-by-silence",
  title: "The Thread Pool Drained by Silence",
  subtitle: "order-summary-api goes completely unresponsive for a few minutes, a few times a week",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "tomcat", "thread-pool"],
  briefing: `A few times a week, "order-summary-api" stops responding to *any* request
for two or three minutes at a time - not just the endpoint that calls out
to the warehouse system, everything, including a trivial health-check
route with no dependencies. Then it recovers on its own, with no restart
and no error logged about running out of anything.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "order-summary-api", namespace: "orders", labels: { app: "order-summary-api" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "order-summary-api", image: "registry.internal/order-summary-api:4.4.0" }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "12d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "order-summary-api-8y7z6a5b4-c3d2e", namespace: "orders", labels: { app: "order-summary-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "order-summary-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "order-summary-api": [
            "2026-09-15T13:02:10.110Z INFO  c.e.orders.WarehouseClient - requesting stock levels for order ORD-90211 from warehouse-legacy-soap",
            "2026-09-15T13:04:58.442Z WARN  o.a.tomcat.util.threads.ThreadPoolExecutor - request queue for connector [http-nio-8080] is full, rejecting connections",
            "2026-09-15T13:05:31.220Z ERROR c.e.orders.WarehouseClient - RestTemplate call to warehouse-legacy-soap timed out after connect+read: no timeout was configured, blocked 200000ms",
          ],
        },
        age: "12d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "order-summary-api-notes", namespace: "orders" },
        spec: {
          data: {
            "WarehouseClient.java.excerpt":
              "@Bean\npublic RestTemplate warehouseRestTemplate() {\n    return new RestTemplate(); // default: no connect timeout, no read\n                                // timeout - a hung call blocks its\n                                // Tomcat worker thread indefinitely\n}\n",
            "notes.md":
              "Tomcat's default worker thread pool (`server.tomcat.threads.max`, 200\nby default here) is shared across every endpoint on this connector,\nincluding the trivial health-check route. A blocking call with no\ntimeout ties up whichever worker thread picked up that request for as\nlong as the downstream stays silent - `warehouse-legacy-soap` is known to\noccasionally hang mid-response for minutes without closing the\nconnection.",
          },
        },
        age: "12d",
      },
    ],
  },
  hints: [
    "`kubectl logs order-summary-api-8y7z6a5b4-c3d2e -n orders` - the thread pool warning names the connector, not a specific endpoint. Every route on that connector shares the same pool of worker threads.",
    "What's `WarehouseClient` waiting on when it finally times out, and how long did it actually wait? Is there any timeout configured on that `RestTemplate`?",
    "`kubectl get configmap order-summary-api-notes -n orders -o yaml` - a Tomcat worker thread blocked on a call with no timeout can't serve any other request, including completely unrelated ones, until that call finally returns.",
  ],
  options: [
    {
      id: "untimed-blocking-call-exhausts-shared-thread-pool",
      label:
        "`warehouseRestTemplate` has no connect or read timeout configured, so a request to the occasionally-hanging `warehouse-legacy-soap` service can block its Tomcat worker thread for minutes at a time; because Tomcat's worker thread pool is shared across every endpoint on the connector, enough concurrent hung warehouse calls are enough to exhaust the whole pool, making completely unrelated endpoints - including the health check - unresponsive until the hung calls finally time out or return.",
      explanation:
        "The logs show the exact chain: a warehouse request starts, roughly three minutes pass, Tomcat's thread pool queue fills and starts rejecting connections, and only then does `WarehouseClient` report the call finally timing out - after blocking for 200,000ms (over three minutes) with no configured timeout to cut it off sooner. `order-summary-api-notes` confirms the thread pool is shared across every route on the connector, so enough of these hung, untimed calls are enough to starve capacity for every other endpoint, including ones with no dependency on the warehouse system at all.",
    },
    {
      id: "warehouse-legacy-soap-is-just-down",
      label: "The warehouse-legacy-soap service is simply down during these windows.",
      explanation:
        "A downstream outage on its own wouldn't explain the trivial, dependency-free health-check endpoint also becoming unresponsive - that symptom specifically points at a shared resource inside order-summary-api itself (its Tomcat worker pool) being exhausted, not at the warehouse system being unreachable.",
    },
    {
      id: "gc-pause-during-warehouse-calls",
      label: "A long GC pause is coinciding with warehouse calls and freezing the whole JVM.",
      explanation:
        "A true GC safepoint pause would stop every thread simultaneously and there'd be no way for the app to keep logging in the middle of it - here, the thread pool warning and the eventual timeout are both logged normally during the incident, which isn't consistent with the whole JVM being frozen by GC.",
    },
    {
      id: "connection-pool-to-database-exhausted",
      label: "The database connection pool is exhausted, blocking every request that needs a connection.",
      explanation:
        "There's no database-related error or pool-exhaustion warning anywhere in the logs - the evidence points specifically at Tomcat's HTTP worker thread pool filling up because of a hung outbound call to the warehouse system, not at a database layer issue.",
    },
  ],
  correctOptionId: "untimed-blocking-call-exhausts-shared-thread-pool",
  resolution: `The timeline in the logs tells the whole story: a warehouse request
starts, roughly three minutes pass in silence, Tomcat's own thread pool
queue fills up and starts rejecting new connections, and only *after*
that does \`WarehouseClient\` finally report the call timing out - having
blocked for 200,000ms with nothing configured to cut it off sooner.
\`order-summary-api-notes\` explains why that one hung call takes down
everything: \`warehouseRestTemplate\` is a plain \`new RestTemplate()\` with
no connect or read timeout, and Tomcat's worker thread pool is shared
across every route on the connector. A worker thread that picks up a
warehouse request and blocks on it for minutes simply isn't available to
serve anything else - the trivial health-check route included - and
enough concurrent hung calls are enough to exhaust the pool's full 200
threads and start rejecting connections outright.

The fix is giving every outbound call an explicit timeout, so a slow or
hanging downstream fails fast and releases its worker thread instead of
holding it hostage:

\`\`\`java
@Bean
public RestTemplate warehouseRestTemplate() {
    ClientHttpRequestFactorySettings settings = ClientHttpRequestFactorySettings.DEFAULTS
        .withConnectTimeout(Duration.ofSeconds(3))
        .withReadTimeout(Duration.ofSeconds(5));
    return new RestTemplateBuilder()
        .requestFactorySettings(settings)
        .build();
}
\`\`\`

A blocking HTTP client with no timeout is a liability precisely because
it shares its container's thread pool with everything else the service
does - one slow or silent downstream dependency is enough to starve every
unrelated endpoint on the same connector, however trivial.`,
};
