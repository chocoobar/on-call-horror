import type { Scenario } from "../types";

export const theHpaMetricsServerGap: Scenario = {
  id: "the-hpa-metrics-server-gap",
  title: "The HPA Metrics Server Gap",
  subtitle: "checkout-worker is visibly struggling under load, and its HPA hasn't scaled it in over an hour",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "hpa", "metrics"],
  briefing: `"checkout-worker" is under real, sustained load - queue depth climbing,
response times up. Its HorizontalPodAutoscaler is configured correctly
and has scaled it appropriately for over a year. For the last hour it
hasn't scaled at all, stuck at its current replica count despite clearly
needing more.`,
  constraints: [
    "checkout-worker's own pods are healthy and running - this isn't a crash or deployment issue, purely a scaling one.",
  ],
  world: {
    resources: [
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "checkout-worker-hpa", namespace: "checkout" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "checkout-worker" },
          minReplicas: 3,
          maxReplicas: 20,
          metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 70 } } }],
        },
        status: { currentReplicas: 4, desiredReplicas: 4 },
        events: [
          { type: "Warning", reason: "FailedGetResourceMetric", age: "3m", message: "failed to get cpu utilization: unable to get metrics for resource cpu: unable to fetch metrics from resource metrics API: the server is currently unable to handle the request" },
        ],
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "metrics-server", namespace: "kube-system", labels: { app: "metrics-server" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 0, updatedReplicas: 1, availableReplicas: 0 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "metrics-server-6n7o8p9q0-r1s2t", namespace: "kube-system", labels: { app: "metrics-server" } },
        status: { phase: "Running", containerStatuses: [{ name: "metrics-server", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
        logs: { "metrics-server": ["2026-09-15T09:50:00Z FATAL server.Main - failed to list nodes: context deadline exceeded, giving up after 5 retries"] },
        age: "1h5m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "metrics-server-incident-notes", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "metrics-server started crash-looping about 65 minutes ago after an\nunrelated API server certificate rotation temporarily disrupted its\nwatch connection in a way it doesn't recover from cleanly on its own -\nit needs a restart to re-establish a working connection, which nothing\nhas triggered yet. With metrics-server down, the entire `metrics.k8s.io`\nAPI is unavailable cluster-wide, which every resource-based HPA (CPU/\nmemory) depends on - checkout-worker-hpa isn't broken itself, it simply\nhas no CPU data to make a scaling decision with, so it holds its last\nknown replica count rather than guessing.\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl describe hpa checkout-worker-hpa -n checkout` - check its own recent Events, not just the target replica count.",
    "`kubectl get deployment metrics-server -n kube-system` - is the thing that actually supplies CPU/memory metrics to every HPA in the cluster healthy right now?",
    "A resource-based HPA (CPU or memory) has no metric of its own - it depends entirely on the metrics API. What does an HPA do when that API is unreachable?",
  ],
  options: [
    {
      id: "metrics-server-down-hpa-has-no-data",
      label:
        "metrics-server has been crash-looping for over an hour after an API server certificate rotation disrupted its watch connection in a way it can't recover from without a restart - with it down, the entire `metrics.k8s.io` API is unavailable cluster-wide, and checkout-worker-hpa (like every CPU/memory-based HPA in the cluster) has no metric data to act on, so it correctly holds its last known replica count rather than scaling blindly, which is exactly what its own `FailedGetResourceMetric` event describes.",
      explanation:
        "checkout-worker-hpa's own event names the exact failure: \"unable to fetch metrics from resource metrics API: the server is currently unable to handle the request.\" `metrics-server`'s own pod confirms it's been crash-looping for over an hour, and its logs show a connection failure dating from a cert rotation event. `metrics-server-incident-notes` ties it together: this is a cluster-wide dependency for every resource-based HPA, not something specific to checkout-worker - the HPA itself is configured correctly and would resume scaling normally the instant real metrics become available again.",
    },
    {
      id: "hpa-hit-max-replicas",
      label: "checkout-worker-hpa has already hit its `maxReplicas` ceiling of 20.",
      explanation:
        "`status.currentReplicas` and `desiredReplicas` both show 4, nowhere near the configured `maxReplicas: 20` - the HPA isn't capped by its own ceiling, it's stuck because it has no metric data to compute a desired replica count from at all.",
    },
    {
      id: "checkout-worker-deployment-paused",
      label: "checkout-worker's Deployment rollout is paused, preventing the HPA from applying new replica counts.",
      explanation:
        "There's no indication the Deployment is paused, and a paused rollout would show up as a distinct condition on the Deployment itself, not as an HPA event about failing to fetch a CPU metric - the actual blocker, per the HPA's own event, is missing metric data, not an inability to apply a replica change it has already decided on.",
    },
    {
      id: "cpu-target-utilization-too-high",
      label: "The HPA's target CPU utilization of 70% is set too high to trigger scaling under this load.",
      explanation:
        "A too-high target would still allow scaling eventually once load is extreme enough - it wouldn't produce a `FailedGetResourceMetric` event, which specifically means the HPA has no CPU data at all to compare against any target, regardless of what that target's threshold is set to.",
    },
  ],
  correctOptionId: "metrics-server-down-hpa-has-no-data",
  resolution: `checkout-worker-hpa's own event says it directly: "unable to fetch
metrics from resource metrics API: the server is currently unable to
handle the request." That's not a problem with checkout-worker or its
HPA configuration - it's the entire \`metrics.k8s.io\` API being
unreachable, confirmed by \`metrics-server\` itself sitting in
\`CrashLoopBackOff\` for over an hour. \`metrics-server-incident-notes\`
explains the trigger: an API server certificate rotation disrupted its
watch connection in a way it doesn't recover from without an actual
restart, and nothing has restarted it since. Every resource-based
(CPU/memory) HPA in the cluster depends on metrics-server for its data -
with it down, checkout-worker-hpa has nothing to compute a scaling
decision from, and correctly holds its last known replica count rather
than guessing, which is the safe, intended behavior, not a malfunction.

There's no live fix from this read-only console, but the actual recovery
is simply restarting metrics-server so it re-establishes a clean
connection:

\`\`\`bash
kubectl rollout restart deployment/metrics-server -n kube-system
\`\`\`

Once it's healthy again, every HPA cluster-wide (not just
checkout-worker's) resumes scaling on real data within a scrape interval
or two. Given how much silently depends on metrics-server - every
resource-based HPA, plus anything using \`kubectl top\` - it's worth
alerting directly on its own health (crash-looping, or the
\`metrics.k8s.io\` API being unavailable) rather than only noticing when a
downstream HPA stops scaling and someone has to trace the chain back
manually, as happened here.`,
};
