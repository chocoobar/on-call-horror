import type { Scenario } from "../types";

export const theStaleEndpoint: Scenario = {
  id: "the-stale-endpoint",
  title: "The Stale Endpoint",
  subtitle: "every deploy of orders-api causes a brief burst of \"connection reset\" errors",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["kubernetes", "endpoints", "rolling-deploy"],
  briefing: `Every rolling deploy of "orders-api" causes a burst of "connection reset
by peer" errors from callers, lasting just a few seconds. The new pods
come up healthy well before the burst ends, and the deploy itself always
reports success.`,
  constraints: [
    "This isn't about slow application startup - the new pods are already Ready and serving traffic correctly before the errors even start.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "orders-api", namespace: "orders", labels: { app: "orders-api" } },
        spec: { replicas: 4, template: { spec: { terminationGracePeriodSeconds: 30, containers: [{ name: "orders-api", image: "registry.internal/orders-api:9.1.0" }] } } },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "orders-api", namespace: "orders", labels: { app: "orders-api" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.70.80", selector: { app: "orders-api" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rollout-networking-notes", namespace: "orders" },
        spec: {
          data: {
            "notes.md":
              "During a rolling update, when an old pod is terminated: Kubernetes\nsends SIGTERM to the container *and* removes the pod from the Service's\nEndpoints list, in parallel, at roughly the same moment - not\nsequentially. kube-proxy on every node then has to notice the Endpoints\nchange and update its own local iptables/IPVS rules before it stops\nrouting new connections to that pod. That propagation is normally fast\n(well under a second) but is not instantaneous or synchronized with\nSIGTERM delivery.\n\norders-api's container has no `preStop` hook configured, and\n`terminationGracePeriodSeconds` is 30s (the default). The application\nstops accepting new connections and starts closing its listening socket\nalmost immediately upon receiving SIGTERM.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap rollout-networking-notes -n orders -o yaml` - what two things happen 'in parallel, at roughly the same moment' when a pod is terminated during a rollout?",
    "Removing a pod from a Service's Endpoints and that change actually propagating to every node's kube-proxy rules are two different steps, seconds or fractions of a second apart - not one atomic operation.",
    "`kubectl get deployment orders-api -n orders -o yaml` - is there a `preStop` hook giving the pod any grace period between 'marked for removal from Endpoints' and 'actually stops accepting connections'?",
  ],
  options: [
    {
      id: "no-prestop-delay-before-sigterm",
      label:
        "SIGTERM and Endpoints removal happen at roughly the same moment, but kube-proxy across the cluster takes a brief window to actually propagate that Endpoints change into routing rules - with no `preStop` hook, orders-api stops accepting connections almost immediately on SIGTERM, so any node whose kube-proxy hasn't caught up yet keeps sending new connections to a pod that's already refusing them, producing a burst of resets right at that boundary on every rollout.",
      explanation:
        "`rollout-networking-notes` describes exactly this race: Endpoints removal and SIGTERM delivery aren't sequenced relative to each other, and kube-proxy's propagation of the Endpoints change to actual routing rules takes a brief but real amount of time. Without a `preStop` hook, the pod stops accepting new connections essentially the instant it receives SIGTERM - faster than every node's kube-proxy is guaranteed to have already removed it from rotation. Any connection routed to it during that narrow gap gets reset. This reproduces identically on every rollout because the race condition itself is structural, not caused by anything unusual about a particular deploy.",
    },
    {
      id: "readiness-probe-too-slow-on-new-pods",
      label: "The readiness probe on new pods is too slow, so traffic arrives before they're truly ready.",
      explanation:
        "The new pods are confirmed already Ready and serving correctly before the error burst even starts - this isn't about new pods coming up too early, the errors are tied to *old* pods being removed, not new ones being added.",
    },
    {
      id: "service-selector-briefly-empty",
      label: "The Service's selector briefly matches zero pods during the transition between old and new ReplicaSets.",
      explanation:
        "A rolling update with `maxUnavailable`/`maxSurge` defaults keeps some old and some new pods matching the same selector throughout the rollout - the Service never has zero matching endpoints at any point, only a changing mix of which specific pods are currently valid.",
    },
    {
      id: "clusterip-changed-during-rollout",
      label: "The Service's ClusterIP changes during the rollout, causing clients to briefly connect to a stale address.",
      explanation:
        "A Service's ClusterIP is stable for the Service's entire lifetime and never changes during a normal rolling update of the Deployment behind it - clients connecting to the same, unchanged ClusterIP the whole time rules this out as the source of the resets.",
    },
  ],
  correctOptionId: "no-prestop-delay-before-sigterm",
  resolution: `\`rollout-networking-notes\` lays out the exact race: when a pod is
terminated during a rollout, Kubernetes sends it SIGTERM and removes it
from the Service's Endpoints list at roughly the same time - not one
strictly before the other. Removing an Endpoint doesn't instantly stop
traffic, though: every node's kube-proxy has to separately notice that
change and update its own local routing rules (iptables or IPVS), which
takes a small but real amount of time to propagate cluster-wide. Without
a \`preStop\` hook, orders-api has no built-in delay between "received
SIGTERM" and "stopped accepting connections" - it starts shutting down
essentially immediately. Any node whose kube-proxy hasn't yet caught up to
the Endpoints removal can still route a brand-new connection to a pod
that's already refusing it, and that connection gets reset. This is a
structural race in how rolling updates work by default, which is exactly
why it reproduces on every single deploy rather than being an occasional
fluke.

The standard fix is a \`preStop\` hook that sleeps briefly before the
container actually starts shutting down - giving Endpoints removal time
to propagate everywhere before the pod stops accepting new connections:

\`\`\`yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"]
terminationGracePeriodSeconds: 35   # grace period + the preStop sleep
\`\`\`

The pod keeps its listening socket open and keeps serving requests
normally throughout that sleep - it just delays when SIGTERM (and any
real shutdown logic) actually happens, giving the cluster's routing state
a moment to fully catch up first. A few seconds of \`preStop\` delay on
every pod termination is a small, standard cost for eliminating this
window entirely.`,
};
