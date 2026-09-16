import type { Scenario } from "../types";

export const proxyProtocolMismatchWrongClientIp: Scenario = {
  id: "proxy-protocol-mismatch-wrong-client-ip",
  title: "Every Request Came From The Load Balancer",
  subtitle: "rate limiting just started blocking the entire company at once",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["proxy-protocol", "load-balancer", "rate-limiting"],
  briefing: `"api-gateway" enforces per-client-IP rate limiting. Since a routine
LoadBalancer Service change this morning, legitimate traffic from
hundreds of different customers has started tripping the rate limiter
within seconds of launch, as if it's all coming from a single, extremely
aggressive client.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "api-gateway", namespace: "gateway2", labels: { app: "api-gateway" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "api-gateway-3e4f5g-t6u7v", namespace: "gateway2", labels: { app: "api-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "api-gateway", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "api-gateway": [
            "2026-09-15T09:05:01.100Z WARN  c.e.gateway.RateLimiter - client 10.0.4.22 exceeded 500 req/min, throttling",
            "2026-09-15T09:05:01.140Z WARN  c.e.gateway.RateLimiter - client 10.0.4.22 exceeded 500 req/min, throttling",
            "2026-09-15T09:05:01.180Z WARN  c.e.gateway.RateLimiter - client 10.0.4.22 exceeded 500 req/min, throttling",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "api-gateway", namespace: "gateway2", annotations: { "service.beta.kubernetes.io/aws-load-balancer-type": "nlb" } },
        spec: { type: "LoadBalancer", externalTrafficPolicy: "Cluster", selector: { app: "api-gateway" }, ports: [{ port: 443, targetPort: 8443 }] },
        status: { loadBalancer: { ingress: [{ hostname: "nlb-abc123.elb.us-east-1.amazonaws.com" }] } },
        age: "3h",
        events: [
          { type: "Normal", reason: "TypeChanged", age: "3h", message: "Service LoadBalancer type migrated from Classic ELB to Network Load Balancer (NLB)" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "api-gateway-config", namespace: "gateway2" },
        spec: {
          data: {
            "gateway.conf": "listen 8443 ssl;\nproxy_protocol off;\nset_real_ip_from 0.0.0.0/0;\nreal_ip_header proxy_protocol;\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get svc api-gateway -n gateway2 -o yaml` and its events - what changed about this Service three hours ago, right before the rate-limiting alerts started?",
    "An NLB operates at layer 4 and preserves the original client IP differently than a classic ELB - it typically relies on the PROXY protocol to pass the real client IP to the backend, rather than an HTTP header.",
    "`kubectl get configmap api-gateway-config -n gateway2 -o yaml` - is `proxy_protocol` actually turned on in api-gateway's own listener config, to match what the new NLB is sending?",
  ],
  options: [
    {
      id: "nlb-proxy-protocol-not-enabled-on-app",
      label:
        "The Service was just migrated from a classic ELB to a Network Load Balancer (NLB), which - unlike the old ELB - sends the real client IP via the PROXY protocol rather than preserving it at the TCP layer or via an HTTP header, but api-gateway's own listener config still has `proxy_protocol off` - so it never parses that information and instead sees every connection as coming from the load balancer's own internal IP (10.0.4.22), causing the rate limiter to lump every real client together as one.",
      explanation:
        "The Service's own event log confirms the migration to an NLB three hours ago, exactly when the rate-limiting alerts started. api-gateway's config explicitly has `proxy_protocol off`, meaning it doesn't parse the PROXY protocol header the NLB now sends ahead of every connection - so every request source resolves to the NLB's own internal address, `10.0.4.22`, exactly the single IP the rate limiter logs are throttling.",
    },
    {
      id: "actual-ddos-attack",
      label: "This is a genuine denial-of-service attack from one source.",
      explanation:
        "The traffic is described as legitimate customer traffic from hundreds of distinct real customers, not a single malicious actor - and the timing lines up precisely with a Service-level LoadBalancer type change, not with any external attack indicators.",
    },
    {
      id: "rate-limiter-threshold-too-low",
      label: "The rate limiter's configured threshold (500 req/min) is simply set too low for current traffic.",
      explanation:
        "The threshold itself hasn't changed and was working correctly for the same real-world traffic volume before this morning's Service change - the issue isn't that legitimate aggregate traffic exceeds the threshold, it's that traffic from hundreds of different clients is all being counted against a single IP.",
    },
    {
      id: "dns-round-robin-single-record",
      label: "DNS for api-gateway's public hostname is only returning a single A record instead of round-robining across all load balancer nodes.",
      explanation:
        "DNS resolution behavior for the load balancer's hostname doesn't affect what client-IP value the backend application sees - that's determined by how the load balancer forwards connection metadata to the backend, which is exactly the PROXY protocol mismatch confirmed in the gateway's own config.",
    },
  ],
  correctOptionId: "nlb-proxy-protocol-not-enabled-on-app",
  resolution: `The Service's own event log confirms a migration from a classic ELB to
a Network Load Balancer (NLB) three hours before the rate-limiting
incident began - not a coincidence. A classic ELB, operating at the
HTTP layer, typically preserves or forwards the real client IP in a way
applications are already set up to read. An NLB operates purely at layer
4 and instead prepends a PROXY protocol header to each connection
carrying the real client IP - but only if the backend is configured to
expect and parse it. api-gateway's own listener config still has
\`proxy_protocol off\`, so it never reads that header at all, and every
connection resolves to the NLB's own internal source address
(\`10.0.4.22\`) instead of the real client - exactly the single IP the
rate limiter logs show being hammered, because hundreds of distinct real
customers are all being counted as that one address.

The fix is enabling PROXY protocol parsing on api-gateway's own listener
to match what the NLB is now sending:

\`\`\`nginx
listen 8443 ssl proxy_protocol;
proxy_protocol on;
set_real_ip_from 0.0.0.0/0;
real_ip_header proxy_protocol;
\`\`\`

and separately confirming the NLB's target group itself has the PROXY
protocol v2 attribute enabled to actually send it:

\`\`\`bash
aws elbv2 modify-target-group-attributes \\
  --target-group-arn <arn> \\
  --attributes Key=proxy_protocol_v2.enabled,Value=true
\`\`\`

Both sides need to agree - an NLB sending PROXY protocol to a backend not
expecting it (or vice versa) either loses the real client IP entirely or,
worse, corrupts the request stream, so this pairing always needs to be
verified together on any ELB-to-NLB migration.`,
};
