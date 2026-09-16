import type { Scenario } from "./types";

export const prestopMissingConnectionDrain: Scenario = {
  id: "prestop-missing-connection-drain",
  title: "The Rollout That Dropped In-Flight Requests",
  subtitle: "every deploy of payment-processor drops a handful of real transactions, right on schedule",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["rollout", "endpoints", "connection-draining"],
  briefing: `Every rolling deploy of "payment-processor" - even routine, low-risk ones -
correlates with a small but consistent handful of failed transactions,
always right as old pods are terminating. The team has ruled out anything
wrong with the new code itself; the failures happen on deploys that
change nothing but a log-level flag.`,
  constraints: [
    "The failed transactions are all in-flight requests that were already being handled by a pod at the moment it started terminating - not new requests being routed somewhere broken.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payment-processor", namespace: "payments3", labels: { app: "payment-processor" } },
        spec: {
          replicas: 4,
          strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1, maxSurge: 1 } },
          template: { spec: { containers: [{ name: "payment-processor", lifecycle: {} }], terminationGracePeriodSeconds: 30 } },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payment-processor-2j3k4l-m5n6o", namespace: "payments3", labels: { app: "payment-processor" } },
        status: { phase: "Terminating", containerStatuses: [{ name: "payment-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "payment-processor": [
            "2026-09-15T16:00:00.010Z INFO  c.e.payments.Server - SIGTERM received, shutting down immediately",
            "2026-09-15T16:00:00.015Z ERROR c.e.payments.TxHandler - connection aborted mid-request for transaction tx_88213",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rollout-mechanics-notes", namespace: "payments3" },
        spec: {
          data: {
            "notes.md":
              "When a pod is deleted during a rollout, two things happen in parallel,\nnot in strict sequence: the kubelet sends SIGTERM to the container\nimmediately, *and* the Endpoints/EndpointSlice controller removes the\npod's IP from the Service's list of ready endpoints - but that removal\nhas to propagate through the API server to every node's kube-proxy\n(and any watching ingress controllers) before those components stop\nsending new traffic to the pod, which takes anywhere from a few hundred\nmilliseconds up to a couple of seconds in this cluster under normal\nload. payment-processor's container has no `preStop` hook configured at\nall, and its own server shuts down and stops accepting/completing\nrequests the instant it receives SIGTERM - so for that endpoint-\npropagation window, kube-proxy is still actively routing some new and\nin-flight connections to a pod that has already begun shutting down and\nrefusing to finish them.\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "The terminating pod's own log shows it shutting down immediately upon SIGTERM, with a request aborted mid-flight right at that moment. What's supposed to happen between a pod being marked for deletion and it actually stopping?",
    "`kubectl get configmap rollout-mechanics-notes -n payments3 -o yaml` - does the pod removal from Service Endpoints happen at the exact same instant as SIGTERM being sent, or does one lag behind the other?",
    "Does payment-processor's pod spec define a `preStop` hook to delay actual shutdown until traffic has genuinely stopped being routed to it?",
  ],
  options: [
    {
      id: "no-prestop-hook-endpoint-removal-lags-sigterm",
      label:
        "payment-processor's pod has no `preStop` hook configured, so its container shuts down and stops handling requests the instant it receives SIGTERM - but Endpoints/EndpointSlice removal and kube-proxy's own propagation of that removal take a short but real amount of time to catch up cluster-wide, so for that brief window, some in-flight and newly-routed connections still land on a pod that's already refusing to finish them, producing exactly the small, consistent handful of dropped transactions on every rollout.",
      explanation:
        "`rollout-mechanics-notes` explains the exact race: SIGTERM delivery and Endpoints removal happen in parallel, not in sequence, and endpoint removal propagating to every kube-proxy takes real (if brief) time. The terminating pod's own log confirms it shuts down immediately on SIGTERM with no grace period used at all, aborting an in-flight transaction at that exact moment - consistent with a pod that stops serving before traffic has actually stopped being routed to it, which is exactly the gap a `preStop` hook exists to cover.",
    },
    {
      id: "load-balancer-health-check-too-slow",
      label: "The load balancer's own health check interval is too slow to detect the terminating pod in time.",
      explanation:
        "This failure is about in-cluster Service/Endpoints routing (kube-proxy), which reacts to the pod's removal from Endpoints directly rather than through periodic external health checks - a cloud load balancer's own health-check cadence isn't the relevant mechanism for how kube-proxy decides where to route in-cluster traffic.",
    },
    {
      id: "terminationgraceperiod-too-short",
      label: "The pod's terminationGracePeriodSeconds (30s) is set too short for in-flight requests to finish.",
      explanation:
        "The pod's own log shows it shutting down and aborting the in-flight request essentially immediately upon SIGTERM, not being forcibly killed after running out of its 30-second grace period - the grace period was never the constraint here, since nothing in the application was using that time to drain existing work at all.",
    },
    {
      id: "maxunavailable-set-too-permissively",
      label: "The Deployment's `maxUnavailable: 1` setting is too aggressive for a payment-critical service.",
      explanation:
        "`maxUnavailable` controls how many pods can be down for readiness/availability purposes during a rollout - it doesn't affect how quickly an individual terminating pod stops accepting or aborts in-flight requests, which is the actual mechanism causing the dropped transactions here, driven instead by the SIGTERM-vs-endpoint-removal timing race.",
    },
  ],
  correctOptionId: "no-prestop-hook-endpoint-removal-lags-sigterm",
  resolution: `\`rollout-mechanics-notes\` lays out the race condition precisely: when a
pod is deleted, SIGTERM delivery to the container and the pod's removal
from Service Endpoints happen in parallel, not in a guaranteed sequence
- and endpoint removal has to propagate through the API server to every
node's kube-proxy before they actually stop routing new traffic there,
which takes a real, if brief, amount of time. payment-processor's
container has no \`preStop\` hook at all, so it shuts down and stops
serving the instant SIGTERM arrives - its own log shows exactly this,
aborting an in-flight transaction the moment it receives the signal,
with no grace period used to let existing work finish or new traffic
stop arriving first. For that brief endpoint-propagation window,
kube-proxy on some nodes is still actively routing connections to a pod
that's already refusing to complete them.

The standard fix is a \`preStop\` hook that sleeps briefly before the
container actually begins shutting down, giving endpoint removal time to
propagate cluster-wide first, combined with the application handling
SIGTERM by finishing in-flight work rather than aborting it immediately:

\`\`\`yaml
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: payment-processor
      lifecycle:
        preStop:
          exec:
            command: ["sleep", "5"]
\`\`\`

The 5-second sleep gives kube-proxy (and any ingress controllers) time
to stop sending new traffic to the pod before it starts actually
shutting down, while the application itself should be changed to finish
handling any request already in flight when SIGTERM arrives, rather than
aborting it outright. This exact pattern - a small number of dropped
requests on every rollout, correlating with pod termination rather than
anything about the new code - is one of the most common and most
overlooked gaps in a Kubernetes rolling update, and it needs both a
\`preStop\` delay and graceful in-app SIGTERM handling together to fully
close.`,
};
