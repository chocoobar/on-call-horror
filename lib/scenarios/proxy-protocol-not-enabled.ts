import type { Scenario } from "./types";

export const proxyProtocolNotEnabled: Scenario = {
  id: "proxy-protocol-not-enabled",
  title: "The Handshake That Looked Like Garbage",
  subtitle: "a new load balancer, and every connection to auth-gateway fails before a single valid byte is read",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["proxy-protocol", "load-balancer", "tls"],
  briefing: `"auth-gateway" was just moved behind a new internal Network Load Balancer
to preserve real client IPs for audit logging. Since the cutover, every
single connection fails immediately - auth-gateway's own TLS layer logs
a malformed handshake on every attempt, as if it's receiving corrupted
data instead of a normal TLS ClientHello.`,
  constraints: [
    "A direct connection to auth-gateway's pod, bypassing the new load balancer entirely, completes a normal TLS handshake without issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "auth-gateway", namespace: "auth2", labels: { app: "auth-gateway" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "auth-gateway-6x7y8z-a9b0c", namespace: "auth2", labels: { app: "auth-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "auth-gateway", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "auth-gateway": [
            "2026-09-15T13:15:01.010Z ERROR c.e.auth.TlsListener - handshake failed: not a TLS record (first bytes: 0x0D 0x0A 0x0D 0x0A 0x00 0x05 ...)",
            "2026-09-15T13:15:01.400Z ERROR c.e.auth.TlsListener - handshake failed: not a TLS record (first bytes: 0x0D 0x0A 0x0D 0x0A 0x00 0x05 ...)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "auth-gateway",
          namespace: "auth2",
          annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-type": "nlb",
            "service.beta.kubernetes.io/aws-load-balancer-proxy-protocol": "*",
          },
        },
        spec: { type: "LoadBalancer", selector: { app: "auth-gateway" }, ports: [{ port: 443, targetPort: 8443 }] },
        age: "20m",
        events: [
          { type: "Normal", reason: "EnsuredLoadBalancer", age: "18m", message: "Ensured load balancer" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "proxy-protocol-notes", namespace: "auth2" },
        spec: {
          data: {
            "notes.md":
              "The Service annotation `aws-load-balancer-proxy-protocol: \"*\"`\nconfigures the NLB's target group to prepend a PROXY protocol v1 header\n(a short, plain-text preamble carrying the original client IP) to the\nvery start of every TCP connection's byte stream, ahead of any actual\napplication data - in this case, ahead of the TLS ClientHello. This is\nrequired for the NLB to pass real client IPs through at layer 4.\nauth-gateway's TLS listener has no PROXY protocol support configured at\nall - it expects the very first bytes of any connection to be a valid\nTLS record, and instead receives the PROXY protocol preamble first,\nwhich it can't parse as TLS at all, so the handshake fails immediately\non every single connection.\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "A direct connection to the pod, bypassing the new load balancer, works fine - so the TLS setup on auth-gateway itself is correct in isolation. What's different when going through the new NLB?",
    "auth-gateway's own error log shows the exact bytes it received instead of a valid TLS record: `0x0D 0x0A 0x0D 0x0A 0x00 0x05`. Does that look like it could be some kind of text-based preamble rather than binary TLS data?",
    "`kubectl get svc auth-gateway -n auth2 -o yaml` - check the AWS load-balancer annotations. Is PROXY protocol enabled on the load balancer's side? Is auth-gateway's own listener configured to expect it?",
  ],
  options: [
    {
      id: "proxy-protocol-enabled-on-lb-not-on-app",
      label:
        "The new NLB is configured (via the Service's `aws-load-balancer-proxy-protocol: \"*\"` annotation) to prepend a PROXY protocol header to every connection ahead of any actual application data - but auth-gateway's own TLS listener has no PROXY protocol support at all and expects the very first bytes to be a valid TLS ClientHello; it receives the PROXY protocol preamble instead, can't parse it as TLS, and fails the handshake on every single connection, while a direct connection to the pod (bypassing the NLB and its PROXY protocol header entirely) works fine.",
      explanation:
        "auth-gateway's error log shows the literal bytes it received instead of a TLS record - starting with `0x0D 0x0A` (a carriage-return/line-feed pair), consistent with a PROXY protocol v1 text preamble, not TLS binary data at all. `proxy-protocol-notes` confirms the NLB is explicitly configured to send exactly that header via the Service's own annotation, and that auth-gateway's listener has no matching support to parse and strip it before handing the rest of the stream to its TLS layer - exactly explaining a handshake failure on every connection through the NLB, while a direct connection to the pod (with no PROXY protocol header involved) succeeds.",
    },
    {
      id: "tls-cert-invalid-for-new-lb-hostname",
      label: "auth-gateway's TLS certificate doesn't cover the new load balancer's hostname.",
      explanation:
        "A certificate/hostname mismatch would produce a specific TLS handshake failure around certificate validation, occurring *after* a valid ClientHello is successfully parsed - auth-gateway's own log shows the failure happening before any valid TLS record can even be recognized at all, at an earlier, more fundamental parsing stage.",
    },
    {
      id: "nlb-health-check-corrupting-connections",
      label: "The NLB's own health check traffic is somehow corrupting real client connections.",
      explanation:
        "Health check traffic and real client connections are handled as entirely separate connections by any load balancer - one can't corrupt the byte stream of the other. The consistent, identical malformed byte pattern seen on every real connection attempt is better explained by something structurally prepended to every connection, which is exactly what a PROXY protocol header is.",
    },
    {
      id: "mtu-issue-truncating-tls-handshake",
      label: "An MTU mismatch on the path to the new load balancer is truncating the TLS handshake.",
      explanation:
        "An MTU/fragmentation issue would typically produce a connection that hangs or times out partway through a large handshake, not a clean, complete, and consistently identical set of malformed leading bytes received immediately on every attempt - the exact, repeatable byte pattern points at something structured being sent first, not corruption or truncation.",
    },
  ],
  correctOptionId: "proxy-protocol-enabled-on-lb-not-on-app",
  resolution: `auth-gateway's own error log captures the smoking gun: the first bytes
received on every failed connection are \`0x0D 0x0A 0x0D 0x0A 0x00 0x05\` -
a carriage-return/line-feed pattern consistent with a PROXY protocol v1
text preamble, not TLS binary data. \`proxy-protocol-notes\` confirms why:
the Service's \`aws-load-balancer-proxy-protocol: "*"\` annotation
configures the new NLB to prepend exactly this kind of header to every
connection, carrying the original client's IP, ahead of any actual
application bytes - required for the NLB to preserve real client IPs at
layer 4. auth-gateway's TLS listener has no PROXY protocol support
configured at all; it expects the very first bytes of any connection to
be a valid TLS ClientHello and instead gets this preamble, which it
can't parse as TLS, failing the handshake immediately and identically on
every attempt. A direct connection to the pod, bypassing the NLB (and
therefore never receiving a PROXY protocol header at all), works
perfectly, confirming the TLS setup itself is fine in isolation.

The fix is enabling PROXY protocol support on auth-gateway's own TLS
listener so it correctly parses and strips the header before handing the
remaining bytes to TLS:

\`\`\`yaml
# auth-gateway's listener config
tls:
  listen: 0.0.0.0:8443
  proxyProtocol: v1
  # parses and strips the PROXY protocol preamble,
  # extracting the real client IP, before TLS negotiation begins
\`\`\`

Both sides of a PROXY protocol integration - the load balancer sending it
and the application expecting it - need to be enabled together; enabling
it on only one side either silently drops the real client IP (if the app
expects it but the LB doesn't send it) or, as here, breaks every
connection outright (if the LB sends it but the app has no idea what to
do with it).`,
};
