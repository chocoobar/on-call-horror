import type { Scenario } from "../types";

export const theGracefulShutdownThatWasnt: Scenario = {
  id: "the-graceful-shutdown-that-wasnt",
  title: "The Graceful Shutdown That Wasn't",
  subtitle: "every rolling deploy of payments-api drops a handful of in-flight requests",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "rollout", "termination"],
  briefing: `"payments-api" processes credit card charges that can take a couple of
seconds to complete. Every rolling deploy - even routine ones with no
code risk - produces a small burst of failed charges right as old pods
are terminated. It's not huge, but at this volume it's real money and
real support tickets.`,
  constraints: [
    "The application code has proper SIGTERM handling that stops accepting new work and waits for in-flight requests to finish - that part is confirmed already implemented and working correctly when given enough time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payments-api", namespace: "payments", labels: { app: "payments-api" } },
        spec: {
          replicas: 6,
          template: {
            spec: { terminationGracePeriodSeconds: 5, containers: [{ name: "payments-api", image: "registry.internal/payments-api:6.4.0" }] },
          },
        },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payments-api-2n3o4p5q6-r7s8t", namespace: "payments", labels: { app: "payments-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "payments-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "payments-api": [
            "2026-09-15T11:20:00.001Z INFO  server.Shutdown - SIGTERM received, refusing new connections",
            "2026-09-15T11:20:00.002Z INFO  server.Shutdown - waiting for 4 in-flight requests to complete (avg charge processing time: ~2.8s)",
            "2026-09-15T11:20:05.010Z WARN  server.Shutdown - forcibly killed by SIGKILL before in-flight requests finished",
          ],
        },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "payments-api-perf-notes", namespace: "payments" },
        spec: {
          data: {
            "notes.md":
              "payments-api's own SIGTERM handler stops accepting new connections\nimmediately and drains in-flight requests, which average 2.8 seconds to\ncomplete for a charge (occasionally up to 4-5s under load). This has\nalways been true - the shutdown handler hasn't changed.\n",
          },
        },
        age: "9mo",
      },
    ],
  },
  hints: [
    "`kubectl logs payments-api-2n3o4p5q6-r7s8t -n payments` - the app's own shutdown handler is logging exactly what happens to it during termination.",
    "`kubectl get deployment payments-api -n payments -o yaml` - check `terminationGracePeriodSeconds` against how long a typical in-flight request takes to finish, per the app's own logs.",
    "Kubernetes sends SIGTERM, waits up to `terminationGracePeriodSeconds`, then sends an unstoppable SIGKILL regardless of what the process is doing.",
  ],
  options: [
    {
      id: "grace-period-shorter-than-request-time",
      label:
        "payments-api's `terminationGracePeriodSeconds` is set to just 5 seconds, but charge processing averages 2.8s and occasionally runs 4-5s under load - the app's SIGTERM handler works exactly as designed and does start draining in-flight requests, but Kubernetes sends an unstoppable SIGKILL at the 5-second mark regardless of whether draining finished, forcibly killing any request still in flight at that instant.",
      explanation:
        "The pod's own log shows the shutdown sequence precisely: SIGTERM received, draining begins, and then \"forcibly killed by SIGKILL before in-flight requests finished\" at exactly the 5-second mark - `terminationGracePeriodSeconds: 5`. `payments-api-perf-notes` confirms requests routinely take 2.8s and sometimes 4-5s, meaning any request that's slow or starts late in the shutdown window has no realistic chance to finish inside a 5-second grace period, independent of the shutdown handler being correctly implemented.",
    },
    {
      id: "sigterm-handler-missing",
      label: "payments-api doesn't handle SIGTERM at all, so it's killed abruptly on every deploy.",
      explanation:
        "The logs show SIGTERM being received and handled correctly - the app immediately stops accepting new connections and begins waiting for in-flight requests, which is exactly proper SIGTERM handling. It's the grace period given to finish that handling that's too short, not an absent handler.",
    },
    {
      id: "readiness-probe-not-removing-from-service",
      label: "The pod's readiness probe isn't removing it from the Service's endpoints before termination, so new traffic keeps arriving during shutdown.",
      explanation:
        "The dropped requests here are *in-flight* ones that were already being processed when SIGTERM arrived, not new requests routed in during shutdown - the app's own log confirms it immediately refuses new connections. The failure mode is about not enough time to finish existing work, not new work arriving unexpectedly.",
    },
    {
      id: "deployment-maxunavailable-too-aggressive",
      label: "The Deployment's rolling update strategy terminates too many pods simultaneously.",
      explanation:
        "How many pods terminate at once affects overall capacity during a rollout, but it doesn't affect whether a given *individual* pod's own in-flight requests survive its own termination - that's governed entirely by `terminationGracePeriodSeconds` versus how long those requests take, which is the exact mismatch shown in the logs.",
    },
  ],
  correctOptionId: "grace-period-shorter-than-request-time",
  resolution: `The pod's own shutdown log is a complete play-by-play:
SIGTERM received, the app correctly stops accepting new connections and
starts draining, and then at the exact 5-second mark it's "forcibly
killed by SIGKILL before in-flight requests finished." That 5 seconds is
\`terminationGracePeriodSeconds\` - Kubernetes' hard ceiling on how long it
waits after SIGTERM before sending an unstoppable SIGKILL, no matter what
the process is doing. \`payments-api-perf-notes\` confirms charge
processing averages 2.8s and occasionally runs 4-5s under load, so any
request unlucky enough to be in-flight and slower than average when
shutdown starts simply gets cut off - not because the shutdown handler is
broken, but because it was never given enough time to actually finish.

The fix is straightforward: give the grace period real headroom over the
app's own worst-case in-flight duration.

\`\`\`yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 30
\`\`\`

30 seconds comfortably covers even outlier 4-5s charges with margin to
spare, while still being a reasonable amount of time for a rolling
deploy to wait per pod. \`terminationGracePeriodSeconds\` defaults to 30
seconds in Kubernetes for exactly this reason - 5 seconds is an
unusually aggressive value that only makes sense for workloads with no
real in-flight work to protect, which payments-api is definitely not.`,
};
