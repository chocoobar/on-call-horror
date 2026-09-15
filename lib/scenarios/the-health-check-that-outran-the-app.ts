import type { Scenario } from "./types";

export const theHealthCheckThatOutranTheApp: Scenario = {
  id: "the-health-check-that-outran-the-app",
  title: "The Health Check That Outran The App",
  subtitle: "every fresh deploy gets marked unhealthy and yanked from rotation before it ever gets a chance",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["load-balancer", "health-check", "rollout"],
  briefing: `"search-indexer" takes about 25 seconds to warm its in-memory index cache
on startup before it's actually ready to serve traffic well. Ever since it
moved behind a cloud LoadBalancer Service, every fresh pod gets marked
unhealthy by the load balancer and pulled from rotation within the first
15 seconds of starting - even though the pod goes on to become perfectly
healthy and serves traffic fine once it's actually given the chance.`,
  constraints: [
    "search-indexer's own container never crashes or restarts during this - kubectl shows it Running the entire time, just never receiving real traffic.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-indexer", namespace: "search2", labels: { app: "search-indexer" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "search-indexer",
                  readinessProbe: { httpGet: { path: "/healthz", port: 8080 }, initialDelaySeconds: 30, periodSeconds: 10 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "search-indexer",
          namespace: "search2",
          annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-healthcheck-interval": "5",
            "service.beta.kubernetes.io/aws-load-balancer-healthcheck-unhealthy-threshold": "2",
          },
        },
        spec: { type: "LoadBalancer", externalTrafficPolicy: "Local", selector: { app: "search-indexer" }, ports: [{ port: 443, targetPort: 8080 }] },
        age: "2d",
        events: [
          { type: "Warning", reason: "TargetHealthCheckFailed", age: "40s", message: "target unhealthy: health checks failed with 'Connection refused', target deregistered after 2 consecutive failures (10s)" },
        ],
      },
    ],
  },
  hints: [
    "`kubectl get svc search-indexer -n search2 -o yaml` - look at the AWS load-balancer health-check annotations. What interval and unhealthy-threshold do they set?",
    "A 5-second interval with a 2-failure threshold means the load balancer gives up on a target after only 10 seconds. Compare that against how long search-indexer actually takes to warm up (about 25 seconds) before it can serve real traffic.",
    "This is a *separate* health check from the Kubernetes readiness probe (which has a 30s initial delay) - the cloud load balancer runs its own independent health-check loop directly against the target, with its own timing.",
  ],
  options: [
    {
      id: "lb-healthcheck-too-aggressive-for-warmup",
      label:
        "The LoadBalancer Service's own AWS health-check annotations configure a 5-second check interval with only a 2-failure unhealthy threshold - deregistering a target after just 10 seconds of failed checks - but search-indexer genuinely takes about 25 seconds to finish warming its cache and start serving well; the load balancer's own health check gives up and pulls the target from rotation long before the pod is actually ready, independent of the Kubernetes readiness probe's more patient 30-second initial delay.",
      explanation:
        "The Service's own event log shows exactly this: a target deregistered after 2 consecutive failures over 10 seconds, per the `healthcheck-interval: 5` and `healthcheck-unhealthy-threshold: 2` annotations. That's a cloud-load-balancer-level health check, entirely separate from and faster than the Kubernetes readiness probe's own 30-second initial delay - the pod is still legitimately warming up when the load balancer already gives up on it and stops sending it traffic.",
    },
    {
      id: "readiness-probe-path-wrong",
      label: "The Kubernetes readiness probe is checking the wrong path or port entirely.",
      explanation:
        "The readiness probe's path and port (`/healthz` on 8080) match the container correctly, and the Deployment reports 3/3 ready replicas - the readiness probe itself is functioning fine. The failure being described is a separate, faster health check enforced directly by the cloud load balancer, not the Kubernetes-level readiness gate.",
    },
    {
      id: "external-traffic-policy-local-issue",
      label: "externalTrafficPolicy: Local is preventing traffic from reaching any pod.",
      explanation:
        "externalTrafficPolicy: Local affects which node-local health check and routing behavior applies once a target is considered healthy - it doesn't explain why a target is being marked unhealthy and deregistered in the first place, which is what the Service's own event describes happening well before that would even be relevant.",
    },
    {
      id: "search-indexer-crashlooping",
      label: "search-indexer's container is crash-looping during startup under load.",
      explanation:
        "search-indexer is confirmed to stay Running throughout, with zero restarts - it isn't crashing at all, it's simply not being given traffic by the load balancer during its legitimate, successful warm-up period.",
    },
  ],
  correctOptionId: "lb-healthcheck-too-aggressive-for-warmup",
  resolution: `The Service's own event log shows the mechanism directly: a target gets
deregistered "after 2 consecutive failures (10s)" - driven by the AWS
load-balancer annotations setting a 5-second health-check interval and a
2-failure unhealthy threshold. That's a completely separate, and much
faster, health-check loop than the Kubernetes readiness probe, which
patiently waits a 30-second initial delay before even checking. search-
indexer legitimately needs about 25 seconds to warm its cache before it
can serve real traffic well - well past the cloud load balancer's own
10-second patience, but comfortably within the readiness probe's own
timing. The load balancer gives up and stops sending the target traffic
long before the pod is actually ready, even though the pod itself never
crashes and does go on to become healthy.

The fix is loosening the cloud load balancer's own health-check timing to
tolerate the pod's real warm-up time, independent of (and at least as
patient as) the Kubernetes readiness probe:

\`\`\`yaml
metadata:
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-interval: "10"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-unhealthy-threshold: "3"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-healthy-threshold: "2"
\`\`\`

giving roughly 30 seconds of grace (3 x 10s) before a target is
deregistered - comfortably past the pod's real warm-up window. Any time a
Service sits behind a cloud load balancer, its own independent
health-check configuration needs to be tuned to the application's actual
startup behavior, separately from (and not assumed to match) whatever the
Kubernetes-level readiness probe is already configured with.`,
};
