import type { Scenario } from "./types";

export const sigtermNeverArrived: Scenario = {
  id: "sigterm-never-arrived",
  title: "The SIGTERM That Never Arrived",
  subtitle: "checkout-api takes exactly 30 seconds to shut down, every single time",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "containers", "graceful-shutdown"],
  briefing: `Every rollout of "checkout-api" (a Spring Boot service, running on Java 25,
rebuilt last sprint to move off the old base image) drops a handful of
in-flight requests for about 30 seconds. The team already enabled Spring
Boot's graceful shutdown and confirmed it's in the deployed config - it
should let in-flight requests finish and exit in a couple of seconds. It
doesn't seem to be happening: every old pod sits in "Terminating" for the
*entire* terminationGracePeriodSeconds, then disappears.`,
  constraints: [
    "The container image is built from a Dockerfile that isn't part of this console's world - you can't inspect it directly here. Diagnose from the Pod's own lifecycle timing and events, then reason about what in a Dockerfile could produce exactly this signature.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "checkout-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/checkout-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "checkout" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "9c1d2e3f4a5b" }, health: { status: "Healthy" } },
        age: "4h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: {
          replicas: 3,
          strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
          template: {
            spec: {
              terminationGracePeriodSeconds: 30,
              containers: [
                {
                  name: "checkout-api",
                  image: "registry.internal/checkout-api:1.42.0",
                  ports: [{ containerPort: 8080 }],
                  readinessProbe: { httpGet: { path: "/actuator/health/readiness", port: 8080 }, periodSeconds: 5 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-api-config", namespace: "checkout" },
        spec: {
          data: {
            "application.yml":
              "server:\n  shutdown: graceful\nspring:\n  lifecycle:\n    timeout-per-shutdown-phase: 25s\n",
          },
        },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: "checkout-api-7c9b8d6f5-old1",
          namespace: "checkout",
          labels: { app: "checkout-api" },
        },
        status: {
          phase: "Running",
          startTime: "2026-09-15T00:02:11Z",
          containerStatuses: [
            { name: "checkout-api", ready: false, restartCount: 0, state: { running: { startedAt: "2026-09-15T00:02:14Z" } } },
          ],
        },
        events: [
          { type: "Normal", reason: "Killing", age: "18s", message: "Stopping container checkout-api" },
        ],
        logs: {
          "checkout-api": [
            "2026-09-15T03:14:01.203Z INFO  c.e.checkout.OrderController - completed order req-88213 in 41ms",
            "2026-09-15T03:14:01.980Z INFO  c.e.checkout.OrderController - completed order req-88214 in 37ms",
            "2026-09-15T03:14:02.410Z INFO  c.e.checkout.OrderController - completed order req-88215 in 29ms",
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-api-8d7c6b5f4-prev1", namespace: "checkout", labels: { app: "checkout-api" } },
        status: {
          phase: "Failed",
          containerStatuses: [
            {
              name: "checkout-api",
              ready: false,
              restartCount: 0,
              state: { terminated: { reason: "Error", exitCode: 137, startedAt: "2026-09-14T21:58:03Z", finishedAt: "2026-09-14T21:58:33Z" } },
              lastState: {
                terminated: {
                  reason: "Error",
                  exitCode: 137,
                  signal: 9,
                  startedAt: "2026-09-14T21:58:03Z",
                  finishedAt: "2026-09-14T21:58:33Z",
                },
              },
            },
          ],
        },
        events: [
          { type: "Normal", reason: "Killing", age: "2h", message: "Stopping container checkout-api" },
        ],
        logs: {
          checkout: [
            "2026-09-14T21:58:02.884Z INFO  c.e.checkout.OrderController - completed order req-77120 in 33ms",
            "2026-09-14T21:58:03.001Z INFO  c.e.checkout.OrderController - completed order req-77121 in 28ms",
          ],
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "`kubectl get pod checkout-api-8d7c6b5f4-prev1 -n checkout -o yaml` - look at `startedAt`/`finishedAt` on the terminated container state. How long did shutdown actually take, and how does that compare to `terminationGracePeriodSeconds` on the Deployment?",
    "`kubectl logs checkout-api-7c9b8d6f5-old1 -n checkout` - a Spring Boot app with graceful shutdown enabled logs something like `Commencing graceful shutdown` the moment it receives the signal to stop. Is that line anywhere?",
    "Exit code 137 is 128 + signal 9 (SIGKILL) - that's Kubernetes force-killing the container after the grace period ran out, not the process exiting on its own. Something is stopping SIGTERM from ever reaching the JVM in the first place.",
  ],
  options: [
    {
      id: "shell-form-entrypoint",
      label:
        "The image's ENTRYPOINT runs `java` via a shell (shell form), so the container's PID 1 is the shell, not the JVM - Kubernetes' SIGTERM goes to the shell, which doesn't forward it, so the JVM never starts shutting down and just gets SIGKILLed at the end of the grace period.",
      explanation:
        "This matches everything in evidence: `checkout-api-config` already has `server.shutdown: graceful` configured correctly, yet the terminated pod's `lastState` shows exit code 137 (SIGKILL) with `finishedAt` exactly `terminationGracePeriodSeconds` (30s) after `startedAt` of the terminate, and the logs never show Spring Boot's graceful-shutdown log line at all - the JVM was never told to stop. A Dockerfile using shell-form `ENTRYPOINT java -jar app.jar` (instead of exec-form `ENTRYPOINT [\"java\", \"-jar\", \"app.jar\"]`, or a PID-1 init like tini) is the classic cause: `/bin/sh -c '...'` becomes PID 1 and swallows the signal.",
    },
    {
      id: "graceful-not-enabled",
      label: "`server.shutdown: graceful` isn't actually applied, so Spring Boot exits immediately without waiting for in-flight requests.",
      explanation:
        "`checkout-api-config`'s `application.yml` already sets `server.shutdown: graceful` with a 25s timeout-per-shutdown-phase - it's configured correctly. If this setting were missing, the pod would exit almost instantly on SIGTERM, not take the full 30-second grace period every time.",
    },
    {
      id: "grace-period-too-short",
      label: "`terminationGracePeriodSeconds: 30` is too short for in-flight checkout requests to finish.",
      explanation:
        "The grace period isn't being spent draining requests at all - the logs show the last requests completing in tens of milliseconds well before termination starts. The full 30 seconds is being consumed waiting for a process that never responds to the stop signal, not by slow in-flight work.",
    },
    {
      id: "missing-prestop",
      label: "There's no `preStop` hook, so the load balancer keeps sending new traffic to the pod after it starts terminating.",
      explanation:
        "A missing `preStop` hook could explain a few failed requests right as termination begins, but it doesn't explain the container itself sitting unresponsive for the entire grace period and then being SIGKILLed (exit code 137) - that's a signal-delivery problem inside the container, not a load-balancer timing gap.",
    },
  ],
  correctOptionId: "shell-form-entrypoint",
  resolution: `\`checkout-api-8d7c6b5f4-prev1\`'s \`lastState.terminated\` shows \`exitCode: 137\`
(128 + signal 9, i.e. SIGKILL) with \`finishedAt\` exactly 30 seconds after
\`startedAt\` of the shutdown - the full \`terminationGracePeriodSeconds\`. The
running pod's logs never show Spring Boot's graceful-shutdown log line
(\`Commencing graceful shutdown...\`) even though \`checkout-api-config\`
correctly sets \`server.shutdown: graceful\`. Put together: the JVM is
correctly configured to shut down gracefully, but it never finds out it's
supposed to.

This is the classic container PID 1 problem. If the Dockerfile uses
shell-form:

\`\`\`dockerfile
ENTRYPOINT java -jar app.jar
\`\`\`

Docker/Kubernetes runs that as \`/bin/sh -c "java -jar app.jar"\`. The shell
becomes PID 1 inside the container, and \`java\` runs as its child. Kubernetes
sends SIGTERM to PID 1 - the shell - which by default does not forward
signals to its child processes. The JVM never receives SIGTERM, never runs
its shutdown hooks, and after \`terminationGracePeriodSeconds\` elapses,
Kubernetes has no choice but to send SIGKILL, which the JVM (or any process)
cannot catch or handle at all - hence exit code 137, every time, on the
dot.

The fix belongs in the Dockerfile: use exec-form so \`java\` itself becomes
PID 1 and receives signals directly,

\`\`\`dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
\`\`\`

(or run an init process like \`tini\` as PID 1 if the entrypoint needs a
shell for variable expansion). Either way, once SIGTERM reaches the JVM
directly, Spring Boot's graceful shutdown kicks in and pods finish
terminating in a couple of seconds instead of the full grace period.`,
};
