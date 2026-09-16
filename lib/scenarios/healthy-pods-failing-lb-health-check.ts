import type { Scenario } from "./types";

export const healthyPodsFailingLbHealthCheck: Scenario = {
  id: "healthy-pods-failing-lb-health-check",
  title: "Healthy Pods Failing A Health Check",
  subtitle: "every pod passes its own readiness probe. the cloud load balancer thinks all of them are down.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["load-balancer", "health-check", "kubernetes"],
  briefing: `"orders-api" just moved to a new LoadBalancer Service configuration as
part of routing consolidation work. All of its pods are Running, Ready,
and passing their Kubernetes readiness probes without issue. The cloud
load balancer, however, considers every single target unhealthy and is
refusing to send any traffic through at all.`,
  constraints: [
    "Every pod behind the Service responds correctly to a direct curl from inside the cluster, on the exact path and port the readiness probe uses.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "orders-api", namespace: "orders2", labels: { app: "orders-api" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "orders-api", readinessProbe: { httpGet: { path: "/healthz", port: 8080 } } }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "orders-api",
          namespace: "orders2",
          annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-healthcheck-path": "/status",
            "service.beta.kubernetes.io/aws-load-balancer-healthcheck-port": "traffic-port",
          },
        },
        spec: { type: "LoadBalancer", selector: { app: "orders-api" }, ports: [{ name: "https", port: 443, targetPort: 8443 }] },
        age: "45m",
        events: [
          { type: "Warning", reason: "TargetHealthCheckFailed", age: "40m", message: "target unhealthy: health checks failed with 'HTTP 404' against path /status on port 8443" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "orders-api-routes-notes", namespace: "orders2" },
        spec: {
          data: {
            "notes.md":
              "orders-api serves its Kubernetes readiness endpoint, `/healthz`, only\non its internal HTTP port 8080 - a separate, unauthenticated management\nport not exposed through the Service at all. Its actual public-facing\napplication routes (including everything real traffic uses) are served\non port 8443 over HTTPS, and that server has no route registered at\n`/status` - only under `/api/v1/*` paths. `/status` was carried over\nfrom a previous, different service's health-check convention when this\nService's annotations were copied as a starting template during the\nrouting consolidation.\n",
          },
        },
        age: "45m",
      },
    ],
  },
  hints: [
    "The Service's own event shows the load balancer's health check getting a 404 - against which path, and on which port?",
    "`kubectl get configmap orders-api-routes-notes -n orders2 -o yaml` - is `/status` actually a real route the application serves, and on which port?",
    "The Kubernetes readiness probe checks `/healthz` on port 8080 - a completely different path *and* port than what the cloud load balancer's own health check is configured to hit (`/status` on `traffic-port`, i.e. 8443). These are two entirely independent health checks.",
  ],
  options: [
    {
      id: "lb-healthcheck-path-doesnt-exist-on-app-port",
      label:
        "The cloud load balancer's own health check is configured to hit `/status` on port 8443 (the Service's `traffic-port`), but orders-api's application server on 8443 only serves routes under `/api/v1/*` and has no `/status` route at all - it returns a 404, which the load balancer correctly treats as unhealthy; this is a completely separate check from the Kubernetes readiness probe (which hits a different path, `/healthz`, on a different port, 8080), so the pods can be genuinely Ready from Kubernetes's perspective while still failing the load balancer's own, independently-configured check.",
      explanation:
        "The Service's own event states the exact failure: an HTTP 404 against `/status` on port 8443. `orders-api-routes-notes` confirms `/status` was never a real route on the application's public port at all - it was copied over from an unrelated service's health-check convention during the routing consolidation. The Kubernetes readiness probe passes because it correctly checks a completely different path and port (`/healthz` on 8080) that the application does serve - the two health checks are entirely independent, and only the cloud load balancer's own is misconfigured.",
    },
    {
      id: "targetport-mismatch-8443-vs-8080",
      label: "The Service's `targetPort` (8443) doesn't match the port the application actually listens on.",
      explanation:
        "The constraint confirms every pod responds correctly to a direct curl on the exact path and port the health check uses - the application genuinely does listen and serve traffic on 8443, just without a `/status` route specifically; the port itself is correct, only the health-check path is wrong.",
    },
    {
      id: "security-group-blocking-lb-to-pod",
      label: "A security group is blocking the load balancer from reaching the pods on port 8443 at all.",
      explanation:
        "The load balancer's health check is confirmed to be reaching the pods successfully and getting a real HTTP response back (a 404) - a security group or network-level block would typically produce a connection timeout with no response at all, not an actual HTTP status code being returned and evaluated.",
    },
    {
      id: "readiness-probe-and-lb-check-need-to-match-exactly",
      label: "The Kubernetes readiness probe and the load balancer's health check must always use the identical path and port, and this Service violates that.",
      explanation:
        "There's no requirement that a cloud load balancer's own health check match the Kubernetes readiness probe exactly - they're independent mechanisms and commonly check different things (an internal management endpoint versus a public-facing one). The actual problem is that the load balancer's configured path simply doesn't exist as a route on the port it's checking, not that the two checks differ from each other in principle.",
    },
  ],
  correctOptionId: "lb-healthcheck-path-doesnt-exist-on-app-port",
  resolution: `The Service's own event states the failure precisely: an HTTP 404
against \`/status\` on port 8443. \`orders-api-routes-notes\` explains why:
\`/status\` was carried over as a leftover from a different service's
health-check convention when this Service's annotations were copied as a
starting template during the routing consolidation - orders-api's
application server on port 8443 never actually registered that route at
all, only paths under \`/api/v1/*\`. The Kubernetes readiness probe, by
contrast, correctly checks \`/healthz\` on an entirely separate internal
port, 8080, which the application *does* serve - which is exactly why
Kubernetes considers every pod Ready while the cloud load balancer,
running its own independent check against a different path and port,
considers every target unhealthy.

The fix is pointing the load balancer's health-check annotation at a
route that actually exists on the port it's checking:

\`\`\`yaml
metadata:
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-path: "/api/v1/health"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-port: "traffic-port"
\`\`\`

(or, if a dedicated health endpoint should be exposed publicly, adding a
real \`/status\` route to the application on the public port instead).
Cloud load balancer health-check annotations and the Kubernetes readiness
probe are entirely independent configurations, easy to lose sync between
when one gets copied as a template from an unrelated service - worth
verifying the load balancer's configured health-check path actually
resolves to a real route on the exact port it's checking, every time a
Service's health-check annotations are set up or changed.`,
};
