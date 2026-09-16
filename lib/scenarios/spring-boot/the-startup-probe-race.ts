import type { Scenario } from "../types";

export const theStartupProbeRace: Scenario = {
  id: "the-startup-probe-race",
  title: "The Startup Probe Race",
  subtitle: "works every time locally, crash-loops on every pod in production",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "startup", "cpu-throttling"],
  briefing: `"quotes-api" starts in about 8 seconds on every developer's laptop and in
CI. In production, every pod crash-loops, killed by its startup probe
before the application context ever finishes refreshing.`,
  constraints: [
    "The application code and configuration are identical between local/CI and production - the only difference is the environment it's running in.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "quotes-api", namespace: "quotes", labels: { app: "quotes-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "quotes-api",
                  image: "registry.internal/quotes-api:6.1.0",
                  resources: { requests: { cpu: "250m" }, limits: { cpu: "250m" } },
                  startupProbe: { httpGet: { path: "/actuator/health", port: 8080 }, periodSeconds: 2, failureThreshold: 10 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 3, availableReplicas: 0 },
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "quotes-api-9i0j1k2l3-m4n5o", namespace: "quotes", labels: { app: "quotes-api" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "quotes-api", ready: false, restartCount: 8, state: { waiting: { reason: "CrashLoopBackOff" } } }],
        },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "1m", message: "Startup probe failed: Get \"http://10.244.3.4:8080/actuator/health\": dial tcp 10.244.3.4:8080: connect: connection refused" },
        ],
        logs: {
          "quotes-api": [
            "2026-09-15T11:00:00.100Z INFO  o.s.b.SpringApplication - Starting Application v6.1.0 using Java 25",
            "2026-09-15T11:00:19.884Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
            "2026-09-15T11:00:19.902Z INFO  c.e.quotes.Application - Started Application in 19.8 seconds",
          ],
        },
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "quotes-api-notes", namespace: "quotes" },
        spec: {
          data: {
            "notes.md":
              "Local machines and CI runners typically have several full CPU cores\navailable to a single process during startup. This container's CPU\n`limits` is `250m` - a quarter of one core - enforced by the container\nruntime via CPU throttling (CFS bandwidth control), regardless of how\nmany cores the underlying node physically has.\n",
          },
        },
        age: "30m",
      },
    ],
  },
  hints: [
    "`kubectl logs quotes-api-9i0j1k2l3-m4n5o -n quotes` - how long does the app actually take to start here, versus the ~8 seconds it takes locally?",
    "`kubectl get deployment quotes-api -n quotes -o yaml` - look at `resources.limits.cpu` and `startupProbe.periodSeconds`/`failureThreshold` together. What's the total time budget the startup probe allows, and does it cover the real startup time seen in the logs?",
    "`kubectl get configmap quotes-api-notes -n quotes -o yaml` - a laptop or CI runner during a Spring Boot startup typically has multiple full cores to burn briefly; what happens to the same single-threaded-ish startup burst when it's capped to a quarter of a core?",
  ],
  options: [
    {
      id: "cpu-limit-throttles-startup-past-probe-budget",
      label:
        "A `250m` CPU limit throttles the JVM's inherently CPU-heavy, largely single-threaded startup burst (class loading, Spring context initialization) so severely that startup takes ~20 seconds instead of the ~8 it takes on an unconstrained laptop or CI runner - well past the startup probe's 20-second total budget (`periodSeconds: 2` x `failureThreshold: 10`), so Kubernetes kills the container before it ever finishes starting.",
      explanation:
        "The logs show the app genuinely takes 19.8 seconds to start in this environment - over double the ~8 seconds it takes locally - and the startup probe's total budget (`2s x 10 = 20s`) barely covers even that, with essentially zero margin, which is exactly consistent with a probe that fails right as startup is about to succeed. `quotes-api-notes` explains the mechanism: local machines and CI runners have multiple full cores available during the startup burst, while this container is capped to a quarter of one core - CPU throttling doesn't crash anything, it just makes CPU-bound work take proportionally longer, which is precisely what a JVM/Spring Boot cold start is.",
    },
    {
      id: "network-policy-blocking-self-probe",
      label: "A NetworkPolicy is blocking the kubelet's probe requests from reaching the pod.",
      explanation:
        "The probe failure is \"connection refused,\" which means the request reached the pod's network namespace and found no listener yet - a NetworkPolicy block would typically produce a timeout with no response at all, not a refused connection, and there's no NetworkPolicy involved in this scenario.",
    },
    {
      id: "different-jvm-version-in-production",
      label: "Production is running a different JVM version than local/CI.",
      explanation:
        "The startup log explicitly confirms Java 25 is running, matching every other environment - there's no version mismatch here; the app takes meaningfully longer to do the exact same startup work in this environment, which points at resource constraints, not a different runtime.",
    },
    {
      id: "actuator-endpoint-disabled",
      label: "The `/actuator/health` endpoint is disabled in the production configuration.",
      explanation:
        "The error is \"connection refused\" at the TCP level - nothing is listening on port 8080 yet at all, which is what an application still mid-startup looks like, not what a disabled or misconfigured endpoint on an already-running server would produce (that would return an HTTP error, not a refused connection).",
    },
  ],
  correctOptionId: "cpu-limit-throttles-startup-past-probe-budget",
  resolution: `The logs confirm real, measured startup time in this environment: 19.8
seconds, against roughly 8 seconds locally - not a hang, a genuinely
slower cold start. \`quotes-api-notes\` explains why: Spring Boot startup
(class loading, bean creation, context refresh) is CPU-intensive and
largely happens without much useful parallelism to spread across cores;
on a laptop or CI runner with several full cores free, that burst
finishes quickly. This container is limited to \`250m\` - a quarter of a
core - enforced via CPU throttling regardless of the node's actual core
count, so the exact same amount of CPU-bound work simply takes
proportionally longer to get through. The startup probe's total budget
(\`periodSeconds: 2\` × \`failureThreshold: 10\` = 20 seconds) was sized
around the ~8-second startup everyone had actually observed testing
locally, leaving it with almost no margin against the roughly 20 seconds
startup actually takes once CPU-limited - so it fails right as the app is
about to succeed, every time.

Two changes, both worth making together: give the startup probe a
realistic budget, and give startup itself more CPU to work with, since a
quarter-core limit is unusually tight for a JVM cold start even without a
probe involved:

\`\`\`yaml
resources:
  requests:
    cpu: 250m
  limits:
    cpu: "1"          # more headroom during startup's CPU burst
startupProbe:
  httpGet: { path: /actuator/health, port: 8080 }
  periodSeconds: 3
  failureThreshold: 20   # up to 60s to finish starting
\`\`\`

Startup time measured on an unconstrained laptop or CI runner is not a
reliable estimate for a container running under a tight CPU limit - any
probe timing budget derived from "how long does it take to start on my
machine" should be re-verified against the actual, resource-constrained
production environment before it's trusted.`,
};
