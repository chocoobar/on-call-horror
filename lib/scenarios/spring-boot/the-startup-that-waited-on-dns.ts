import type { Scenario } from "../types";

export const theStartupThatWaitedOnDns: Scenario = {
  id: "the-startup-that-waited-on-dns",
  title: "The Startup That Waited on DNS",
  subtitle: "settlement-processor takes almost five minutes to start whenever it's the first pod up after a namespace-wide rollout",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "startup", "spring-boot"],
  briefing: `During a coordinated namespace-wide rollout this morning, "settlement-processor"
took nearly five minutes to become ready - normally it's up in under 15
seconds. It only happens when it starts before the internal service it
depends on, "ledger-core," has any endpoints registered yet. Once
ledger-core is up, restarting settlement-processor again is instant.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "settlement-processor", namespace: "payments", labels: { app: "settlement-processor" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "settlement-processor", image: "registry.internal/settlement-processor:6.6.6" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "settlement-processor-0q1r2s3t4-u5v6w", namespace: "payments", labels: { app: "settlement-processor" } },
        status: { phase: "Running", startTime: "2026-09-15T02:00:00Z", containerStatuses: [{ name: "settlement-processor", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-15T02:04:52Z" } } }] },
        logs: {
          "settlement-processor": [
            "2026-09-15T02:00:02.110Z INFO  o.s.b.SpringApplication - Starting SettlementProcessorApplication",
            "2026-09-15T02:00:02.410Z INFO  c.e.payments.LedgerCoreClient - resolving ledger-core.payments.svc.cluster.local",
            "2026-09-15T02:00:32.514Z WARN  c.e.payments.LedgerCoreClient - DNS resolution failed, retrying (attempt 1)",
            "2026-09-15T02:04:41.220Z INFO  c.e.payments.LedgerCoreClient - DNS resolution succeeded after 5 attempts (service now has endpoints)",
            "2026-09-15T02:04:52.884Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
          ],
        },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "settlement-processor-notes", namespace: "payments" },
        spec: {
          data: {
            "LedgerCoreClient.java.excerpt":
              "@Component\npublic class LedgerCoreClient {\n    @PostConstruct\n    void warmUp() {\n        // eagerly resolves and pings ledger-core at startup so the\n        // first real request doesn't pay a cold-start DNS/connection\n        // cost - retries with a fixed 30s backoff, up to 10 times,\n        // synchronously, blocking the rest of context initialization\n        int attempt = 0;\n        while (!tryResolveAndPing() && attempt++ < 10) {\n            sleepUninterruptibly(Duration.ofSeconds(30));\n        }\n    }\n}\n",
          },
        },
        age: "4h",
      },
    ],
  },
  hints: [
    "`kubectl logs settlement-processor-0q1r2s3t4-u5v6w -n payments` - `Tomcat started on port 8080` is the very last line. Everything before it happens during context initialization, blocking the web server from starting at all.",
    "The DNS resolution succeeds right when `ledger-core` finally has endpoints - a Kubernetes Service with no ready backing pods yet simply won't resolve to anything for a client trying to reach it.",
    "`kubectl get configmap settlement-processor-notes -n payments -o yaml` - `warmUp()` runs in `@PostConstruct`, synchronously, with a 30-second sleep between each of up to 10 retry attempts. Do the math on how long that could take in the worst case.",
  ],
  options: [
    {
      id: "synchronous-warmup-blocks-startup-on-unready-dependency",
      label:
        "`LedgerCoreClient.warmUp()` synchronously retries resolving and pinging `ledger-core` inside `@PostConstruct`, with a fixed 30-second sleep between attempts - so whenever settlement-processor starts before ledger-core's Service has any ready endpoints to resolve to, the entire application context (and therefore the readiness-gating Tomcat startup) is blocked for as many 30-second cycles as it takes ledger-core to come up, exactly the roughly-five-minute delay observed during the coordinated rollout.",
      explanation:
        "The logs show `Tomcat started on port 8080` as the very last line, arriving only after DNS resolution to `ledger-core` finally succeeds - almost five minutes and five attempts later. `settlement-processor-notes` shows why that blocks everything: `warmUp()` runs synchronously in `@PostConstruct`, sleeping 30 seconds between each retry, and context initialization (which Tomcat's startup depends on) can't proceed until it returns. When settlement-processor happens to start before ledger-core has any ready pods to resolve to, this retry loop becomes the critical path for the entire application's startup.",
    },
    {
      id: "dns-server-itself-degraded",
      label: "The cluster's internal DNS server (CoreDNS) was degraded during the rollout.",
      explanation:
        "DNS resolution succeeding at the exact moment `ledger-core`'s own endpoints become available - and being instant on a subsequent restart once ledger-core is already up - points at the *target* service having no endpoints yet, not at the DNS resolver infrastructure itself being unhealthy.",
    },
    {
      id: "readiness-probe-misconfigured-for-startup",
      label: "settlement-processor's readiness probe settings are too strict for a cold start.",
      explanation:
        "The delay happens entirely before Tomcat even starts listening at all - no readiness probe could report ready sooner, because there's no web server yet to answer one; the bottleneck is inside application startup itself, not in how the probe evaluates it.",
    },
    {
      id: "ledger-core-slow-to-schedule",
      label: "ledger-core's own pods were simply slow to get scheduled during the rollout.",
      explanation:
        "That's a real contributing factor to the *timing* of this specific incident, but it doesn't explain the underlying design problem: settlement-processor's own startup sequence has no tolerance for a dependency being briefly unready, which is what turns any such delay into a blocked, five-minute startup instead of a fast one that proceeds and warms up in the background.",
    },
  ],
  correctOptionId: "synchronous-warmup-blocks-startup-on-unready-dependency",
  resolution: `\`Tomcat started on port 8080\` is the very last line in the startup log,
and it lands nearly five minutes after the process begins - right after
\`LedgerCoreClient\` finally reports \`DNS resolution succeeded after 5
attempts (service now has endpoints)\`. Everything before that line
happens during Spring's context initialization, which the embedded web
server (and therefore readiness) can't start until it completes.

\`settlement-processor-notes\` shows exactly what's in the way:
\`LedgerCoreClient.warmUp()\`, running in \`@PostConstruct\`, synchronously
retries resolving and pinging \`ledger-core\` up to 10 times with a fixed
30-second sleep between attempts - intended to warm up the connection so
the first real request doesn't pay a cold-start cost. That's a reasonable
goal, but doing it synchronously and blocking context initialization means
that whenever settlement-processor happens to start *before* ledger-core
has any ready endpoints (exactly what a coordinated namespace-wide
rollout can produce), the entire application is held hostage to
ledger-core's own startup timeline, in 30-second increments.

The fix is moving the warm-up off the startup critical path so a
temporarily-unready dependency delays only the warm-up, not the whole
application:

\`\`\`java
@Component
public class LedgerCoreClient implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {
        // runs after the context (and web server) are already up;
        // readiness can go green immediately, this just improves the
        // very first real request's latency once ledger-core is ready
        executor.execute(this::warmUp);
    }
}
\`\`\`

Any \`@PostConstruct\` (or other startup-blocking) code that depends on
another in-cluster service being ready is fragile by construction during
coordinated rollouts, restarts, or autoscaling events - it should either
run asynchronously after startup or fail fast with a short, bounded retry
budget rather than one long enough to stall the whole deployment.`,
};
