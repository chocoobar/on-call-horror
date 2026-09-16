import type { Scenario } from "../types";

export const theProbeThatStartedTooSoon: Scenario = {
  id: "the-probe-that-started-too-soon",
  title: "The Probe That Started Too Soon",
  subtitle: "inventory-api flaps in and out of the load balancer during every deploy",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "spring-boot", "probes"],
  briefing: `Every rollout of "inventory-api" causes a burst of 502s for a few seconds,
even though the new pods eventually settle in and work fine. Kubernetes
shows the new pods becoming Ready almost immediately after starting - well
before the app itself claims to be ready to serve traffic.`,
  constraints: [
    "The application itself starts up fine and isn't crashing - the issue is specifically about when Kubernetes decides to send it traffic.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-api", namespace: "inventory", labels: { app: "inventory-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "inventory-api",
                  image: "registry.internal/inventory-api:7.0.0",
                  readinessProbe: { httpGet: { path: "/actuator/health", port: 8080 }, initialDelaySeconds: 5, periodSeconds: 5 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "inventory-api-8h9i0j1k2-l3m4n", namespace: "inventory", labels: { app: "inventory-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "inventory-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "inventory-api": [
            "2026-09-15T10:00:04.881Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
            "2026-09-15T10:00:04.902Z INFO  c.e.inventory.Application - Started Application in 4.9 seconds",
            "2026-09-15T10:00:12.114Z INFO  c.e.inventory.StockCache - warming stock cache from database...",
            "2026-09-15T10:00:19.660Z INFO  c.e.inventory.StockCache - stock cache warm, 84213 SKUs loaded",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inventory-api-config", namespace: "inventory" },
        spec: {
          data: {
            "notes.md":
              "`/actuator/health` (the general health endpoint, aggregating all\nHealthIndicators) reports UP as soon as the Tomcat web server and the\ndatabase connection pool are both up - it does not know anything about\n`StockCache`'s in-memory warm-up step, which happens afterward and takes\nanother 5-8 seconds. Every request that arrives before the cache is warm\ngets served from an empty cache and returns a 502 from the client's\nperspective (the app itself returns a fast 'no stock data' response the\nupstream treats as a failure).\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs inventory-api-8h9i0j1k2-l3m4n -n inventory` - compare the timestamp Tomcat starts against the timestamp the stock cache actually finishes warming up.",
    "`kubectl get deployment inventory-api -n inventory -o yaml` - what endpoint does the readinessProbe actually check, and what does that endpoint really verify?",
    "`kubectl get configmap inventory-api-config -n inventory -o yaml` - does `/actuator/health` know anything about `StockCache`'s warm-up state?",
  ],
  options: [
    {
      id: "readiness-probe-doesnt-check-cache-warmup",
      label:
        "The readiness probe checks the generic `/actuator/health` endpoint, which reports UP as soon as Tomcat and the database pool are up - about 15 seconds before `StockCache` actually finishes warming up - so Kubernetes marks the pod Ready and routes real traffic to it during the exact window where it would serve empty-cache responses that look like failures upstream.",
      explanation:
        "The logs show Tomcat starting at 10:00:04 while the stock cache doesn't finish warming until 10:00:19 - a 15-second gap. `inventory-api-config` confirms `/actuator/health`'s aggregated status has no awareness of `StockCache`'s warm-up at all; it only reflects the web server and datasource. The readiness probe passes during exactly that gap, Kubernetes adds the pod to the load balancer, and any request landing in that window gets a fast, cache-miss response the caller sees as a failure - which is precisely the burst of errors observed on every rollout.",
    },
    {
      id: "database-connection-pool-slow",
      label: "The database connection pool takes too long to establish connections on startup.",
      explanation:
        "The logs show Tomcat and the app fully started at 4.9 seconds, well within normal range, with no indication of any delay establishing database connectivity - the actual gap is entirely attributable to the separate stock cache warm-up step that starts afterward.",
    },
    {
      id: "load-balancer-caching-old-endpoints",
      label: "The load balancer is caching a stale list of healthy endpoints from before the deploy.",
      explanation:
        "There's no indication the load balancer is using outdated endpoint information - it's correctly and promptly routing traffic to pods Kubernetes has actually marked Ready; the problem is that Kubernetes marks them Ready too early relative to when they can actually serve correct responses.",
    },
    {
      id: "too-few-replicas-during-rollout",
      label: "The Deployment doesn't have enough replicas available during a rolling update to absorb the load.",
      explanation:
        "The errors are specific to requests landing on a pod during its own cache warm-up window, not a general capacity shortfall during the rollout - even with more replicas available, any newly-Ready pod would still serve incorrect responses for the same 15-second gap before its own cache finishes warming.",
    },
  ],
  correctOptionId: "readiness-probe-doesnt-check-cache-warmup",
  resolution: `The logs place Tomcat's startup at 10:00:04 and \`StockCache\`'s warm-up
finishing at 10:00:19 - a real, consistent 15-second gap. \`/actuator/health\`,
which the readiness probe checks, aggregates Spring Boot's built-in
HealthIndicators (web server, datasource, disk space, and similar) - it
has no idea \`StockCache\` exists or that it needs time to warm up. The
probe reports UP the moment the generic indicators are satisfied, well
before the cache is actually usable, so Kubernetes marks the pod Ready and
routes real traffic to it during precisely the window where it would
serve fast, technically-successful-but-functionally-wrong empty-cache
responses that the caller treats as failures.

The fix is making readiness reflect the thing that actually needs to be
ready - a custom \`HealthIndicator\` for the cache, wired into a dedicated
readiness probe:

\`\`\`java
@Component
public class StockCacheHealthIndicator implements HealthIndicator {
    private final StockCache cache;
    public Health health() {
        return cache.isWarm() ? Health.up().build() : Health.down().build();
    }
}
\`\`\`

\`\`\`yaml
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
\`\`\`

(with \`management.endpoint.health.probes.enabled: true\` and the cache
indicator registered under the \`readiness\` group). Once the readiness
check genuinely depends on the cache being warm, Kubernetes won't add a
pod to the load balancer until it can actually serve correct answers,
closing the gap that produces a burst of errors on every rollout.`,
};
