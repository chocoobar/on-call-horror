import type { Scenario } from "../types";

export const tcpVsHttpHealthCheckMismatch: Scenario = {
  id: "tcp-vs-http-health-check-mismatch",
  title: "Healthy At Layer 4, Broken At Layer 7",
  subtitle: "the load balancer has never once flagged this backend as unhealthy. it's been failing every request for twenty minutes.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["load-balancer", "health-check", "tcp"],
  briefing: `"pdf-renderer" started returning HTTP 500 on literally every request about
twenty minutes ago, after a bad config value was deployed. The cloud load
balancer in front of it has kept every pod marked healthy the entire
time and never pulled a single one from rotation.`,
  constraints: [
    "pdf-renderer's own pods are confirmed Running with no restarts - the process itself never crashes, it just returns a 500 for every request due to the bad config.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pdf-renderer", namespace: "documents", labels: { app: "pdf-renderer" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "22m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pdf-renderer-9k0l1m-n2o3p", namespace: "documents", labels: { app: "pdf-renderer" } },
        status: { phase: "Running", containerStatuses: [{ name: "pdf-renderer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pdf-renderer": [
            "2026-09-15T11:00:01.010Z ERROR c.e.documents.RenderEngine - font cache directory /var/cache/fonts-v2 does not exist, cannot initialize renderer",
            "2026-09-15T11:00:01.020Z INFO  c.e.documents.Server - listening on :8080",
            "2026-09-15T11:00:12.400Z ERROR c.e.documents.RequestHandler - render failed: renderer not initialized, returning 500",
          ],
        },
        age: "22m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "pdf-renderer",
          namespace: "documents",
          annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-healthcheck-protocol": "TCP",
            "service.beta.kubernetes.io/aws-load-balancer-healthcheck-port": "traffic-port",
          },
        },
        spec: { type: "LoadBalancer", selector: { app: "pdf-renderer" }, ports: [{ port: 443, targetPort: 8080 }] },
        age: "1y",
      },
    ],
  },
  hints: [
    "pdf-renderer's own logs show its listener successfully bound and accepting connections on port 8080, right alongside the error that causes every request to fail - what would a health check that only checks 'is the port open' actually see?",
    "`kubectl get svc pdf-renderer -n documents -o yaml` - what protocol is the load balancer's health check configured to use: TCP, or HTTP?",
    "A TCP-level health check only confirms something is listening and accepting connections on the port - it says nothing about what that something actually returns when asked to do real work.",
  ],
  options: [
    {
      id: "tcp-healthcheck-doesnt-see-http-500s",
      label:
        "The load balancer's health check is configured for plain TCP, which only confirms the port is open and accepting connections - pdf-renderer's server process starts up fine and keeps its listener bound (so the TCP check always passes), even though a missing font cache directory means every actual HTTP request fails with a 500; a TCP check has no concept of HTTP status codes at all, so it keeps every pod marked healthy regardless of whether it's actually serving successful responses.",
      explanation:
        "pdf-renderer's own logs confirm its listener binds and stays up successfully (\"listening on :8080\") even as it logs the underlying failure and starts returning 500s for every real request - exactly the split a TCP check can't see. The Service's own health-check annotation confirms it's configured for `TCP`, not `HTTP`, meaning the load balancer only ever verifies the port accepts a connection, with zero visibility into what the application actually returns once a real request is made.",
    },
    {
      id: "loadbalancer-check-interval-too-slow",
      label: "The load balancer's health-check interval is simply too slow to have caught this yet.",
      explanation:
        "Twenty minutes is far longer than any reasonable health-check interval (typically measured in seconds) would need to detect a genuinely failing target - the issue isn't timing, it's that a TCP-level check is structurally incapable of ever detecting an HTTP-level failure like a 500 response, no matter how frequently it runs.",
    },
    {
      id: "pdf-renderer-readiness-probe-misconfigured",
      label: "pdf-renderer's Kubernetes readiness probe is misconfigured and reporting false positives to Kubernetes.",
      explanation:
        "The failure being described is specifically that the *cloud load balancer* never pulls these pods from rotation - a completely separate, independent health check from the Kubernetes readiness probe. Even if the readiness probe were also misconfigured, that wouldn't explain the load balancer's own behavior, which is governed entirely by its own TCP-based health-check configuration.",
    },
    {
      id: "font-cache-issue-transient",
      label: "The missing font cache directory is a transient issue that should resolve on its own shortly.",
      explanation:
        "There's nothing in pdf-renderer's logs suggesting this is transient - the directory simply doesn't exist, which is a persistent configuration problem that will continue producing 500s on every request until it's actually fixed, not something that resolves itself over time.",
    },
  ],
  correctOptionId: "tcp-healthcheck-doesnt-see-http-500s",
  resolution: `pdf-renderer's own logs show the exact split at play: its server
successfully starts and keeps its listener bound on port 8080 ("listening
on :8080"), even while logging that its font cache directory is missing
and every real render request subsequently fails with a 500. The
Service's own health-check annotations confirm the load balancer is
configured for a \`TCP\`-protocol check, not \`HTTP\` - meaning it only ever
verifies that something accepts a connection on the port, with zero
visibility into what that something actually returns for a real request.
Since the process itself never crashes and its listener never goes down,
the TCP check passes continuously and every pod stays marked healthy,
even though every real request being served is failing outright.

The fix is switching the load balancer's own health check to an
HTTP-level check against a real endpoint that reflects actual application
health:

\`\`\`yaml
metadata:
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-protocol: "HTTP"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-path: "/healthz"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-port: "traffic-port"
\`\`\`

paired with pdf-renderer exposing a \`/healthz\` endpoint that actually
checks whether the renderer initialized successfully (verifying the font
cache directory, in this case) rather than just confirming the HTTP
server itself is up. A TCP-level health check is only appropriate for
genuinely non-HTTP services, or as a coarse first-line check layered
underneath an HTTP-level one - relying on it alone for any HTTP service
leaves exactly this blind spot, where the process can be "up" in the
narrowest possible sense while failing every real request it receives.`,
};
