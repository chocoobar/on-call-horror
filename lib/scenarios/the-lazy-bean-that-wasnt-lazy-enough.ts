import type { Scenario } from "./types";

export const theLazyBeanThatWasntLazyEnough: Scenario = {
  id: "the-lazy-bean-that-wasnt-lazy-enough",
  title: "The Lazy Bean That Wasn't Lazy Enough",
  subtitle: "tax-calculation-api's very first request after every deploy times out, without fail",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "spring-boot", "startup"],
  briefing: `Every deploy of "tax-calculation-api" produces exactly one alert: the
first real request the new pod receives after passing its readiness
check times out at the client's 5-second limit. Every request after that
is fast. It's a small, tolerable blip today, but it's happening on every
single rollout without exception, and nobody's been able to pin down why
the very first request is special.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "tax-calculation-api", namespace: "finance", labels: { app: "tax-calculation-api" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "tax-calculation-api", image: "registry.internal/tax-calculation-api:3.7.0" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "tax-calculation-api-3d4e5f6g7-h8i9j", namespace: "finance", labels: { app: "tax-calculation-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "tax-calculation-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "tax-calculation-api": [
            "2026-09-15T14:00:10.110Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
            "2026-09-15T14:00:45.884Z INFO  c.e.finance.TaxRateEngine - lazily initializing TaxRateEngine, loading 60000 jurisdiction tax rules from disk",
            "2026-09-15T14:00:51.220Z INFO  c.e.finance.TaxRateEngine - TaxRateEngine ready (5336ms)",
            "2026-09-15T14:00:51.230Z INFO  c.e.finance.TaxController - request req-1 completed in 5340ms",
          ],
        },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tax-calculation-api-notes", namespace: "finance" },
        spec: {
          data: {
            "TaxRateEngine.java.excerpt":
              "@Lazy\n@Component\npublic class TaxRateEngine {\n    public TaxRateEngine() {\n        loadJurisdictionRules(); // loads and parses 60,000 tax rules from\n                                   // a bundled resource file - takes\n                                   // several seconds\n    }\n}\n\n// @Lazy delays bean *creation* until first injection point is actually\n// used - readiness has nothing to do with when that first happens\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl logs tax-calculation-api-3d4e5f6g7-h8i9j -n finance` - Tomcat (and readiness) comes up well before `TaxRateEngine` finishes initializing. What triggers `TaxRateEngine`'s constructor to actually run?",
    "`@Lazy` delays when a bean gets *created*, not how long its constructor takes once something finally asks for it. What's the very first thing that asks for `TaxRateEngine`?",
    "`kubectl get configmap tax-calculation-api-notes -n finance -o yaml` - readiness passing only means the web server is listening; it says nothing about whether every lazily-initialized bean has already paid its own one-time startup cost.",
  ],
  options: [
    {
      id: "lazy-bean-defers-expensive-init-to-first-real-request",
      label:
        "`TaxRateEngine` is marked `@Lazy`, which defers its expensive constructor (loading and parsing 60,000 jurisdiction tax rules from disk, ~5 seconds) until the very first time something actually needs it - which happens to be the first real request the pod receives, since readiness passing only confirms Tomcat is listening, not that every lazily-initialized bean has already paid its startup cost; that first unlucky request eats the full 5-second initialization on top of its own work and blows past the client's timeout.",
      explanation:
        "The logs show `Tomcat started on port 8080` (readiness-eligible) well before `TaxRateEngine`'s own initialization even begins - it only starts, and takes 5336ms, right as `request req-1` comes in, which then completes in 5340ms total, almost entirely eaten by that one-time load. `tax-calculation-api-notes` confirms `TaxRateEngine` is `@Lazy`, and explains precisely what that annotation defers: bean *creation*, triggered by first use, with no relationship at all to whether the pod has already been marked ready.",
    },
    {
      id: "tomcat-connector-warmup-delay",
      label: "Tomcat's own connector needs a brief warm-up period after starting before it can serve requests quickly.",
      explanation:
        "The 5-second delay is explicitly attributed in the logs to `TaxRateEngine` loading 60,000 jurisdiction rules from disk, a real, measurable application-level initialization cost - not to any generic connector warm-up behavior, which wouldn't take multiple seconds or appear as a named log line like this.",
    },
    {
      id: "jit-compilation-cold-start",
      label: "JIT compilation hasn't warmed up yet, so the first request runs on slower interpreted bytecode.",
      explanation:
        "JIT warm-up produces a broad, gradual improvement across many early requests, not one single request eating a clean, fully-attributed 5-second block that the logs explicitly tie to a specific bean's one-time disk-loading constructor finishing right as that request completes.",
    },
    {
      id: "readiness-probe-race-condition",
      request_never_mind: undefined,
      label: "The readiness probe is racing ahead of the application actually being fully warmed up.",
      explanation:
        "Readiness accurately reflects what it's designed to check: that the web server is listening and able to accept connections - it was never meant to guarantee every lazily-initialized bean has already paid its startup cost, which is a distinct, application-level concern that `@Lazy` explicitly creates here.",
    },
  ],
  correctOptionId: "lazy-bean-defers-expensive-init-to-first-real-request",
  resolution: `The logs lay the timeline out cleanly: \`Tomcat started on port 8080\`
(readiness-eligible) comes first, well before \`TaxRateEngine\` even begins
initializing. \`TaxRateEngine\`'s own load doesn't start until 35 seconds
later, and takes 5336ms - finishing at almost exactly the same moment
\`request req-1\` completes, in a total of 5340ms. That first request paid
the engine's entire one-time startup cost on top of its own work.

\`tax-calculation-api-notes\` explains why: \`TaxRateEngine\` is annotated
\`@Lazy\`, which tells Spring to defer *creating* the bean until the first
time something actually needs it, rather than eagerly during context
initialization. That's often a reasonable optimization for a bean that's
rarely used - but here, "the first time something needs it" turns out to
be the very first real tax-calculation request the pod ever receives,
since readiness passing only confirms the web server is listening; it has
no relationship to whether any lazily-initialized bean has already been
constructed.

The fix is deciding deliberately when the expensive initialization should
happen, rather than letting it default to "whenever the first unlucky
caller triggers it" - either eagerly during startup (delaying readiness
slightly, on the team's own terms) or explicitly warmed in the background
after startup:

\`\`\`java
@Component
public class TaxRateEngine {
    public TaxRateEngine() {
        loadJurisdictionRules(); // @Lazy removed - now initializes
                                   // eagerly during context startup,
                                   // adding ~5s to startup instead of
                                   // to the first real request
    }
}
\`\`\`

\`@Lazy\` trades startup latency for first-use latency - it's the right
choice for something genuinely optional, but for something every request
path depends on, it just moves an unavoidable cost onto whichever caller
happens to be unlucky enough to trigger it first.`,
};
