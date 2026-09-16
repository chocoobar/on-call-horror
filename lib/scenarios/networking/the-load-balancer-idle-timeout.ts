import type { Scenario } from "../types";

export const theLoadBalancerIdleTimeout: Scenario = {
  id: "the-load-balancer-idle-timeout",
  title: "The Load Balancer Idle Timeout",
  subtitle: "connection resets, but only ever on the first request after a quiet period",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["load-balancer", "keep-alive", "networking"],
  briefing: `A low-traffic internal admin tool, "fleet-admin," intermittently returns
"connection reset" on the very first request after several minutes of no
activity - then works perfectly for every request after that, for as long
as traffic keeps flowing.`,
  constraints: [
    "fleet-admin's own pods are healthy and never restart around these errors - whatever's resetting the connection isn't the application itself.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fleet-admin", namespace: "admin", labels: { app: "fleet-admin" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "fleet-admin", image: "registry.internal/fleet-admin:2.0.0", env: [{ name: "SERVER_KEEP_ALIVE_TIMEOUT", value: "75000" }] }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "lb-timeout-notes", namespace: "admin" },
        spec: {
          data: {
            "notes.md":
              "fleet-admin sits behind a cloud load balancer with a fixed idle\ntimeout of 60 seconds - if no bytes are exchanged on a given connection\nfor 60 seconds, the load balancer silently closes it on its own side\nwithout notifying either the client or the backend. fleet-admin's own\nHTTP server keep-alive timeout is set to 75 seconds (75000ms) -\nlonger than the load balancer's 60-second idle timeout - so\nlong-lived, low-traffic connections are kept open by both sides for\nlonger than the load balancer is actually willing to keep them alive.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap lb-timeout-notes -n admin -o yaml` - compare the load balancer's idle timeout against fleet-admin's own keep-alive timeout. Which one is longer?",
    "A load balancer's idle timeout closing a connection on its own side, silently, doesn't necessarily tell either endpoint - each side may believe the connection is still perfectly valid and try to reuse it.",
    "This only ever happens on the *first* request after a quiet period - what would that request be trying to do with a connection that's been sitting idle just long enough?",
  ],
  options: [
    {
      id: "backend-keepalive-outlives-lb-idle-timeout",
      label:
        "fleet-admin's own HTTP keep-alive timeout (75s) is longer than the load balancer's idle timeout (60s) - after roughly a minute of inactivity, the load balancer silently closes the connection on its own side without telling either end, but fleet-admin's client (or the client reusing a pooled connection) still believes the older, longer-lived connection is valid and tries to reuse it, getting an immediate reset the moment it sends a request on a connection that no longer exists on the load balancer's side.",
      explanation:
        "`lb-timeout-notes` states the mismatch directly: a 60-second load balancer idle timeout against a 75-second backend keep-alive - the backend (and any client reusing a pooled connection to it) believes the connection is good for up to 75 seconds of inactivity, but the load balancer has already silently torn it down 15 seconds earlier. The very first request after a quiet period is exactly the request that would be sent on a connection that's been idle long enough to fall into that 15-second gap - reused because it looks perfectly valid from both endpoints' own perspective, reset because the load balancer already discarded it. Every subsequent request on a *freshly established* connection works fine, matching the observed pattern exactly.",
    },
    {
      id: "fleet-admin-pods-restarting",
      label: "fleet-admin's pods are restarting during quiet periods, dropping connections.",
      explanation:
        "fleet-admin's pods are confirmed healthy with no restarts correlating with these errors at all - the connection reset is happening at the load balancer layer, not because anything on the backend actually went away or cycled.",
    },
    {
      id: "dns-ttl-expiring-during-idle-period",
      label: "The client's cached DNS resolution for fleet-admin expires during the idle period.",
      explanation:
        "A DNS TTL expiring would affect where a *new* connection gets established, not cause an existing, already-connected socket to receive an active reset - the symptom described is specifically about reusing an existing connection, which DNS has no involvement in at all.",
    },
    {
      id: "tls-session-ticket-expired",
      label: "A TLS session resumption ticket expires during the idle window, breaking reconnection.",
      explanation:
        "An expired TLS session ticket would cause a fresh full TLS handshake on the next connection attempt (slower, but not a reset) rather than an active reset of what both sides otherwise consider a currently-open connection - the described symptom is specifically about an existing connection being rejected, not a resumption mechanism failing.",
    },
  ],
  correctOptionId: "backend-keepalive-outlives-lb-idle-timeout",
  resolution: `\`lb-timeout-notes\` states the exact mismatch: the load balancer silently
closes any connection idle for 60 seconds, on its own side, without
notifying either endpoint - a completely normal, by-design behavior for
managing its own connection table. fleet-admin's own HTTP server keep-alive
timeout is set to 75 seconds, meaning both the backend and any client
holding a pooled connection to it consider that same connection valid for
15 seconds longer than the load balancer actually keeps it around. During
that 15-second gap, the connection is dead from the load balancer's
perspective but looks completely healthy from either endpoint's own view.
The very first request sent after a quiet period is exactly the request
most likely to reuse a connection that's aged into that gap - and gets
an immediate reset the instant it tries, because there's nothing on the
other end anymore. Every request after that succeeds because it happens
on a freshly (re-)established connection, matching the pattern of "only
ever the first request after idle time" precisely.

The fix is making sure the backend's keep-alive timeout is always
*shorter* than the load balancer's idle timeout, so the backend (and any
well-behaved client) closes idle connections proactively before the load
balancer would silently do it first:

\`\`\`bash
SERVER_KEEP_ALIVE_TIMEOUT=55000   # 55s: safely under the LB's 60s idle timeout
\`\`\`

The general rule for anything sitting behind a load balancer or proxy
with its own idle timeout: every layer's keep-alive timeout should be
strictly shorter than the layer in front of it, so idle connections are
always closed cleanly by the side that still considers itself
responsible for them, rather than silently expiring on one side while the
other still thinks it's usable.`,
};
