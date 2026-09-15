import type { Scenario } from "./types";

export const theValueFrozenAtBoot: Scenario = {
  id: "the-value-frozen-at-boot",
  title: "The @Value Frozen at Boot",
  subtitle: "rate-limiter-api ignores every config-server push to raise the request limit",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 10,
  tags: ["java25", "spring-cloud-config", "configuration"],
  briefing: `Ops bumped "rate-limiter-api"'s configured request limit from 100 to 500
in config-server ahead of a marketing push, confirmed the change synced
successfully, and even saw the \`/actuator/refresh\` call return 200. Five
minutes later, customers are still getting throttled at 100 requests -
the old limit, as if nothing changed at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "rate-limiter-api", namespace: "gateway", labels: { app: "rate-limiter-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "rate-limiter-api", image: "registry.internal/rate-limiter-api:3.1.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "rate-limiter-api-4w5x6y7z8-a9b0c", namespace: "gateway", labels: { app: "rate-limiter-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "rate-limiter-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "rate-limiter-api": [
            "2026-09-15T09:00:00.110Z INFO  c.e.gateway.RateLimitFilter - initialized with limit=100 requests/min",
            "2026-09-15T09:15:02.884Z INFO  o.s.c.e.event.RefreshEventListener - Refresh keys changed: [rate.limit.perMinute]",
            "2026-09-15T09:20:11.010Z WARN  c.e.gateway.RateLimitFilter - rejecting request from 203.0.113.44, limit exceeded (limit=100)",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rate-limiter-api-notes", namespace: "gateway" },
        spec: {
          data: {
            "RateLimitFilter.java.excerpt":
              "@Component\npublic class RateLimitFilter extends OncePerRequestFilter {\n\n    @Value(\"${rate.limit.perMinute}\")\n    private int limit; // read once when the bean is constructed - no\n                        // @RefreshScope on this class, so this field\n                        // never changes again after startup\n\n    @PostConstruct\n    void log() {\n        logger.info(\"initialized with limit={} requests/min\", limit);\n    }\n}\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl logs rate-limiter-api-4w5x6y7z8-a9b0c -n gateway` - `RefreshEventListener` confirms the refresh event fired and picked up the new key. Does the rejection message right after it use the old limit or the new one?",
    "`kubectl get configmap rate-limiter-api-notes -n gateway -o yaml` - is `RateLimitFilter` annotated `@RefreshScope`? What does a plain `@Value` field do when a refresh event fires on a bean that isn't refresh-scoped?",
    "`/actuator/refresh` reloads the `Environment` and notifies refresh-scoped beans to recreate themselves - it doesn't reach into every bean's already-injected `@Value` fields.",
  ],
  options: [
    {
      id: "value-field-not-refresh-scoped",
      label:
        "`RateLimitFilter` reads its limit into a plain `@Value` field with no `@RefreshScope` on the class, so the value is bound once when the bean is constructed at startup and never again; `/actuator/refresh` genuinely updates the underlying `Environment` (the refresh event fires and names the right key), but nothing tells this specific bean's already-injected field to re-read it, so it keeps enforcing the old limit indefinitely.",
      explanation:
        "The log shows the refresh event firing and correctly naming `rate.limit.perMinute` as changed - config-server, the sync, and the refresh trigger are all working. But the very next rejection five minutes later still cites `limit=100`. `rate-limiter-api-notes` shows why: `RateLimitFilter` isn't `@RefreshScope`, so its `@Value`-injected `limit` field was bound once at construction and is now just a plain `int` field - the refresh event has nothing to act on inside this particular bean.",
    },
    {
      id: "config-server-sync-failed",
      label: "config-server itself never actually synced the new value from the config repo.",
      explanation:
        "The log explicitly shows `Refresh keys changed: [rate.limit.perMinute]` - proof that the new value did reach the application's environment and was correctly detected as changed. The problem is downstream of that: the bean holding the old value was never told to re-read it.",
    },
    {
      id: "cdn-cached-old-response",
      label: "A CDN or edge cache in front of the gateway is serving stale rate-limit decisions.",
      explanation:
        "Rate limiting here is enforced inside the application itself (`RateLimitFilter`, a `OncePerRequestFilter`), not by anything cacheable at an edge layer - the rejection log line comes directly from the application's own in-process filter re-evaluating the (stale) `limit` field on every request.",
    },
    {
      id: "wrong-config-key-pushed",
      label: "Ops pushed the new value under the wrong config key entirely.",
      explanation:
        "The refresh event log explicitly names `rate.limit.perMinute` - the exact key `RateLimitFilter` binds to - as having changed, which confirms the correct key was updated; the value simply never reached the already-constructed bean holding the old copy.",
    },
  ],
  correctOptionId: "value-field-not-refresh-scoped",
  resolution: `The refresh mechanism itself worked correctly - the log shows \`Refresh
keys changed: [rate.limit.perMinute]\`, confirming config-server synced
the new value and the application's \`Environment\` picked it up. But the
very next rejection, five minutes later, still cites \`limit=100\`.

\`rate-limiter-api-notes\` shows the gap: \`RateLimitFilter\` injects its
limit with a plain \`@Value("${rate.limit.perMinute}")\` field and has no
\`@RefreshScope\` annotation on the class. Spring Cloud's \`/actuator/refresh\`
updates the underlying \`Environment\` and notifies *refresh-scoped* beans
to tear themselves down and get recreated with fresh values - it has no
mechanism to reach into an already-injected \`@Value\` field on an ordinary
singleton bean. \`RateLimitFilter\` was constructed once at startup, bound
\`limit = 100\` at that moment, and has had no reason to ever look at that
property again since.

The fix is adding \`@RefreshScope\` so the bean itself gets recreated (and
re-reads its \`@Value\` fields) on the next refresh event:

\`\`\`java
@RefreshScope
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    @Value("${rate.limit.perMinute}")
    private int limit;
}
\`\`\`

Any bean that reads a config value via \`@Value\` and is expected to pick up
config-server pushes without a full restart needs \`@RefreshScope\` - a
successful refresh event in the logs only proves the *environment* updated,
not that every bean depending on it did too.`,
};
