import type { Scenario } from "../types";

export const theGracefulShutdownTimeoutTooShort: Scenario = {
  id: "the-graceful-shutdown-timeout-too-short",
  title: "The Graceful Shutdown Timeout Too Short",
  subtitle: "report-export-api cuts off a handful of long-running exports on every single deploy",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "graceful-shutdown", "spring-boot"],
  briefing: `"report-export-api" generates large CSV exports on request, some of which
take up to a minute to stream back to the client. Graceful shutdown is
enabled and generally works - most in-flight requests finish cleanly
during a rollout - but any export still running past a certain point gets
cut off mid-stream, every time, producing a truncated file the client has
no way to know is incomplete.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "report-export-api", namespace: "reporting", labels: { app: "report-export-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              terminationGracePeriodSeconds: 20,
              containers: [{ name: "report-export-api", image: "registry.internal/report-export-api:2.3.0" }],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-export-api-7i8j9k0l1-m2n3o", namespace: "reporting", labels: { app: "report-export-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "report-export-api", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [{ type: "Normal", reason: "Killing", age: "5m", message: "Stopping container report-export-api" }],
        logs: {
          "report-export-api": [
            "2026-09-15T10:00:00.010Z INFO  c.e.reporting.ExportController - starting export exp-3390 for quarterly-sales, estimated 45s",
            "2026-09-15T10:00:03.114Z INFO  o.s.b.w.e.tomcat.GracefulShutdown - Commencing graceful shutdown, waiting for active requests to complete",
            "2026-09-15T10:00:15.220Z WARN  o.s.b.w.e.tomcat.GracefulShutdown - Graceful shutdown timeout expired, forcing shutdown - 1 request still active",
            "2026-09-15T10:00:15.230Z INFO  c.e.reporting.ExportController - export exp-3390 terminated mid-stream at 12s of an estimated 45s",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "report-export-api-config", namespace: "reporting" },
        spec: {
          data: {
            "application.yaml": "server:\n  shutdown: graceful\nspring:\n  lifecycle:\n    timeout-per-shutdown-phase: 10s\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl logs report-export-api-7i8j9k0l1-m2n3o -n reporting` - graceful shutdown starts, then times out 12 seconds later and force-kills a request still in progress. Compare that to how long a typical export actually takes.",
    "`kubectl get configmap report-export-api-config -n reporting -o yaml` - `spring.lifecycle.timeout-per-shutdown-phase` bounds how long graceful shutdown will wait before giving up on remaining in-flight requests, no matter how close they are to finishing.",
    "`terminationGracePeriodSeconds: 20` on the Deployment also matters here - it needs to be long enough to cover whatever `timeout-per-shutdown-phase` is set to, plus a little slack.",
  ],
  options: [
    {
      id: "shutdown-phase-timeout-shorter-than-longest-request",
      label:
        "`spring.lifecycle.timeout-per-shutdown-phase` is set to 10s, far shorter than the up-to-a-minute an export can legitimately take, so graceful shutdown correctly waits for in-flight requests but gives up and force-terminates any export still running once that 10-second window closes - which for a typical 45-second export, is almost every single time a rollout happens to land mid-export.",
      explanation:
        "The log shows graceful shutdown starting, then explicitly timing out and force-killing the one remaining active request after roughly 12 seconds (\"Graceful shutdown timeout expired, forcing shutdown - 1 request still active\") - and `report-export-api-config` confirms `timeout-per-shutdown-phase: 10s`, nowhere near long enough to cover a request the application itself estimated at 45 seconds when it started. Graceful shutdown isn't failing to engage - it's engaging and then giving up too soon for this specific workload's actual duration.",
    },
    {
      id: "graceful-shutdown-not-enabled",
      label: "`server.shutdown: graceful` isn't actually taking effect.",
      explanation:
        "The log explicitly shows graceful shutdown commencing (\"Commencing graceful shutdown, waiting for active requests to complete\") - it's working correctly and doing exactly what it's supposed to; the problem is the timeout budget it's given to wait, not whether it's enabled at all.",
    },
    {
      id: "termination-grace-period-irrelevant-here",
      label: "The container's `terminationGracePeriodSeconds` is what's cutting the export short.",
      explanation:
        "At 20 seconds, the pod's own termination grace period is longer than the 10-second `timeout-per-shutdown-phase` that's actually triggering the cutoff - Spring's own shutdown-phase timeout is the one being hit first and is the binding constraint here, not the Kubernetes-level grace period.",
    },
    {
      id: "client-side-connection-drop",
      label: "The client's own HTTP connection is timing out and dropping the download early.",
      explanation:
        "The application's own log explicitly attributes the cutoff to its graceful shutdown timeout expiring server-side (\"forcing shutdown\"), not to any client-side connection behavior - this is the server actively terminating the response mid-stream during a deploy.",
    },
  ],
  correctOptionId: "shutdown-phase-timeout-shorter-than-longest-request",
  resolution: `The log shows graceful shutdown working exactly as designed, just against
too short a budget: it commences correctly (\`Commencing graceful
shutdown, waiting for active requests to complete\`), waits, and then
explicitly gives up (\`Graceful shutdown timeout expired, forcing shutdown
- 1 request still active\`) about twelve seconds later - cutting off an
export that had only reached 12 of its estimated 45 seconds.
\`report-export-api-config\` confirms why: \`spring.lifecycle.timeout-per-shutdown-phase\`
is set to \`10s\`, a value that was likely fine for a typical fast REST API
but was never revisited for a service whose whole purpose is generating
exports that can legitimately run for the better part of a minute.

The fix is sizing the shutdown timeout (and the pod's own termination
grace period, which needs to comfortably exceed it) to the service's
actual longest-running request, not a generic default:

\`\`\`yaml
spring:
  lifecycle:
    timeout-per-shutdown-phase: 75s
\`\`\`

\`\`\`yaml
spec:
  terminationGracePeriodSeconds: 90
\`\`\`

Graceful shutdown's timeout is a real, hard ceiling - it doesn't
automatically scale to whatever the slowest legitimate request happens to
be, it has to be set deliberately for the workload the service actually
handles. A generic default copied from a typical low-latency API is
exactly the kind of setting that looks fine until a service does
something the default was never sized for, like a long-running streaming
export.`,
};
