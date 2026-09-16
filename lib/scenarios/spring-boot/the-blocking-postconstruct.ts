import type { Scenario } from "../types";

export const theBlockingPostconstruct: Scenario = {
  id: "the-blocking-postconstruct",
  title: "The Blocking @PostConstruct",
  subtitle: "feature-flag-gateway takes almost three minutes to become ready, every single deploy",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "startup", "spring-boot"],
  briefing: `"feature-flag-gateway" used to be ready within about 10 seconds of
starting. After last sprint's change to preload all flag definitions at
boot "so the first request is fast," every rollout now takes nearly three
minutes before the readiness probe goes green - well past what anyone
expected, and rollouts are starting to trip the deployment's own timeout.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "feature-flag-gateway", namespace: "platform", labels: { app: "feature-flag-gateway" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "feature-flag-gateway",
                  image: "registry.internal/feature-flag-gateway:4.0.2",
                  readinessProbe: { httpGet: { path: "/actuator/health/readiness", port: 8080 }, periodSeconds: 5, failureThreshold: 6 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 3, availableReplicas: 1 },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "feature-flag-gateway-7h6g5f4e3-d2c1b", namespace: "platform", labels: { app: "feature-flag-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "feature-flag-gateway", ready: false, restartCount: 0, state: { running: { startedAt: "2026-09-15T10:00:01Z" } } }] },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "1m", message: "Readiness probe failed: HTTP probe failed with statuscode: 503" },
        ],
        logs: {
          "feature-flag-gateway": [
            "2026-09-15T10:00:01.100Z INFO  o.s.b.SpringApplication - Starting FeatureFlagGatewayApplication",
            "2026-09-15T10:00:01.240Z INFO  c.e.flags.FlagPreloader - preloading all flag definitions synchronously in @PostConstruct",
            "2026-09-15T10:02:48.910Z INFO  c.e.flags.FlagPreloader - preloaded 14200 flag definitions from flag-store (one HTTP call per flag)",
            "2026-09-15T10:02:49.310Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
          ],
        },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "feature-flag-gateway-notes", namespace: "platform" },
        spec: {
          data: {
            "FlagPreloader.java.excerpt":
              "@PostConstruct\npublic void preload() {\n    for (String flagId : flagStore.listIds()) {\n        cache.put(flagId, flagStore.fetch(flagId)); // one blocking HTTP\n                                                       // call per flag,\n                                                       // 14,200 of them\n    }\n}\n",
          },
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "`kubectl logs feature-flag-gateway-7h6g5f4e3-d2c1b -n platform` - Tomcat (and therefore the readiness endpoint) doesn't start until *after* `FlagPreloader` finishes. How long does that gap actually take?",
    "`@PostConstruct` methods run during application context initialization, before the embedded web server starts listening at all - anything slow in there blocks the whole startup sequence, not just one bean.",
    "`kubectl get configmap feature-flag-gateway-notes -n platform -o yaml` - how many flags are being loaded, and how are they being fetched?",
  ],
  options: [
    {
      id: "synchronous-postconstruct-blocks-server-start",
      label:
        "`FlagPreloader.preload()` runs synchronously in `@PostConstruct`, making one blocking HTTP call per flag for all 14,200 flags before the method returns - and since `@PostConstruct` runs during context initialization, the embedded Tomcat server (and therefore the readiness endpoint) doesn't even start listening until that entire loop finishes, turning what should be a background warm-up into the critical path for startup.",
      explanation:
        "The logs show a roughly 2 minute 47 second gap between `FlagPreloader` starting and Tomcat starting - `Tomcat started on port 8080` only appears *after* `preloaded 14200 flag definitions` logs. `feature-flag-gateway-notes` shows why: the preload loop makes one blocking HTTP call per flag inside `@PostConstruct`, which runs before the web server is initialized at all, so nothing can respond to a readiness check - successfully or otherwise - until every single one of those 14,200 calls completes.",
    },
    {
      id: "readiness-probe-misconfigured",
      label: "The readiness probe's `failureThreshold` and `periodSeconds` are simply too aggressive for this app.",
      explanation:
        "Loosening the probe's tolerance would only delay when Kubernetes gives up waiting - it wouldn't change the nearly three-minute gap before Tomcat even starts listening, which is a startup-ordering problem inside the app itself, not a probe-tuning problem.",
    },
    {
      id: "flag-store-service-degraded",
      label: "The downstream flag-store service is degraded and responding slowly to each request.",
      explanation:
        "There's no indication of individual slow responses or timeouts in the logs - the total time is explained simply by making 14,200 sequential HTTP calls, one at a time, each presumably at a normal individual latency, before startup can proceed.",
    },
    {
      id: "too-many-flags-for-the-service",
      label: "14,200 flags is simply too many for this service to reasonably manage.",
      explanation:
        "The flag count itself isn't inherently a problem - a bulk fetch, a background/async preload, or lazy-on-demand loading could all handle this volume without blocking startup; the issue is specifically doing it as 14,200 sequential blocking calls inside `@PostConstruct` before the server can start.",
    },
  ],
  correctOptionId: "synchronous-postconstruct-blocks-server-start",
  resolution: `The logs show \`Tomcat started on port 8080\` landing nearly three minutes
*after* \`FlagPreloader\` begins - and \`preloaded 14200 flag definitions\`
appears right before it, in between. \`feature-flag-gateway-notes\` explains
why that ordering matters so much: \`@PostConstruct\` methods run as part
of Spring's application context initialization, which completes *before*
the embedded web server (and therefore any readiness endpoint) starts
listening at all. \`FlagPreloader.preload()\` makes one blocking HTTP call
per flag, sequentially, for all 14,200 flags - so the entire loop has to
finish before Tomcat can even bind its port, let alone serve a successful
readiness check.

The fix is getting the preload off the startup critical path - either
move it to run asynchronously after the context is up, or batch-fetch
instead of one call per flag:

\`\`\`java
@Component
public class FlagPreloader implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {
        // runs after the context (and web server) is fully up;
        // readiness can report true immediately, this warms the
        // cache in the background instead of blocking startup
        executor.execute(this::preloadAll);
    }

    private void preloadAll() {
        cache.putAll(flagStore.fetchAll()); // one bulk call, not 14,200
    }
}
\`\`\`

Anything genuinely slow inside \`@PostConstruct\` - a loop of blocking
network calls especially - delays the entire application's readiness, not
just the one bean doing the work, because context initialization has to
finish before the server can start listening for any request at all.`,
};
