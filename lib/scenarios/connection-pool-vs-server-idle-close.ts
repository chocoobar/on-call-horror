import type { Scenario } from "./types";

export const connectionPoolVsServerIdleClose: Scenario = {
  id: "connection-pool-vs-server-idle-close",
  title: "The Pool That Didn't Notice",
  subtitle: "no load balancer in the middle at all, and it still happens - just to a different service this time",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["connection-pool", "keep-alive", "grpc"],
  briefing: `"user-profile-svc" calls "preferences-store" directly, pod to pod, using a
gRPC client with a persistent connection pool. During low-traffic
overnight hours, the first call after any gap of a few minutes reliably
fails with an "unavailable" error. Every call after that first one
succeeds, for as long as traffic keeps flowing.`,
  constraints: [
    "preferences-store's own pods show no restarts or crashes at any point - kubectl confirms they stay healthy and Running throughout.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "preferences-store", namespace: "prefs", labels: { app: "preferences-store" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "preferences-store", env: [{ name: "GRPC_MAX_CONNECTION_IDLE_MS", value: "60000" }] }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "500d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "user-profile-svc", namespace: "prefs", labels: { app: "user-profile-svc" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "user-profile-svc", env: [{ name: "GRPC_CLIENT_CHANNEL_IDLE_TIMEOUT_MS", value: "300000" }] }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "60d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "user-profile-svc-8b9c0d-e1f2g", namespace: "prefs", labels: { app: "user-profile-svc" } },
        status: { phase: "Running", containerStatuses: [{ name: "user-profile-svc", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "user-profile-svc": [
            "2026-09-15T03:10:00.010Z INFO  c.e.profile.PrefsClient - last request 6m ago, sending next\n",
            "2026-09-15T03:10:00.240Z ERROR c.e.profile.PrefsClient - gRPC UNAVAILABLE: preferences-store.prefs.svc.cluster.local: connection reset",
            "2026-09-15T03:10:00.310Z INFO  c.e.profile.PrefsClient - retried on new channel, succeeded",
          ],
        },
        age: "60d",
      },
    ],
  },
  hints: [
    "Compare `GRPC_MAX_CONNECTION_IDLE_MS` on preferences-store (the server) against `GRPC_CLIENT_CHANNEL_IDLE_TIMEOUT_MS` on user-profile-svc (the client). Which one allows a connection to sit idle longer?",
    "preferences-store's pods never crash or restart - the connection reset is a normal, intentional server-side action, not a failure of the server itself.",
    "There's no load balancer or proxy in this call path at all - it's direct pod-to-pod gRPC. Whatever's causing this has to be a mismatch purely between the two applications' own gRPC connection settings.",
  ],
  options: [
    {
      id: "server-max-idle-shorter-than-client-pool-timeout",
      label:
        "preferences-store's gRPC server closes any connection idle for more than 60 seconds (`GRPC_MAX_CONNECTION_IDLE_MS=60000`), but user-profile-svc's client channel considers a pooled connection valid for up to 5 minutes (`GRPC_CLIENT_CHANNEL_IDLE_TIMEOUT_MS=300000`) - during any gap in traffic longer than a minute, the server closes the connection on its own side well before the client's pool would ever consider it stale, so the client's next call reuses a channel that looks fine locally but was already closed remotely, getting an immediate UNAVAILABLE before succeeding on a freshly-established one.",
      explanation:
        "The two services' configured idle timeouts are directly comparable and mismatched: the server allows only 60 seconds of connection idle time before closing it, while the client's own channel pool holds onto a connection for up to 5 minutes of idle time before considering it stale. user-profile-svc's logs show exactly this: roughly 6 minutes since the last request, a UNAVAILABLE/connection-reset error on the first attempt, then an immediate successful retry on a freshly-established channel - precisely the signature of a server that already closed an idle connection the client's own pool didn't yet know to retire.",
    },
    {
      id: "preferences-store-restarting-overnight",
      label: "preferences-store's pods are restarting during the overnight low-traffic window.",
      explanation:
        "preferences-store's pods are confirmed to stay healthy and Running throughout, with no restarts at any point - the connection reset is a deliberate, normal server-side action (closing an idle connection it's configured to close), not a crash or restart of the process itself.",
    },
    {
      id: "conntrack-timeout-pod-to-pod",
      label: "The node's conntrack table is timing out the idle connection between the two pods.",
      explanation:
        "A conntrack-level timeout would typically produce a silently dropped connection (packets vanishing with no response) rather than a clean, immediate UNAVAILABLE/connection-reset response - the pattern here is much more consistent with an application-level server actively and gracefully closing a connection it considers idle, which is exactly what preferences-store's own configured idle timeout does.",
    },
    {
      id: "grpc-keepalive-pings-disabled",
      label: "gRPC keepalive pings are disabled on the client, so it never detects the connection is unusable ahead of time.",
      explanation:
        "Even with keepalive pings enabled, a connection can still legitimately be closed by the server between pings during an idle period longer than the ping interval - the root mismatch is the two sides' configured idle timeouts disagreeing, not merely the absence of a keepalive ping mechanism that would only reduce, not eliminate, this exact race.",
    },
  ],
  correctOptionId: "server-max-idle-shorter-than-client-pool-timeout",
  resolution: `The two services' own gRPC idle-timeout settings are directly
comparable, and mismatched in exactly the way that causes this:
preferences-store's server closes any connection idle for more than 60
seconds, while user-profile-svc's client channel pool holds onto a
pooled connection for up to 5 minutes before considering it stale.
During any traffic gap longer than a minute - routine during overnight
low-traffic hours - the server proactively and correctly closes the
connection on its own side well before the client's own pool would ever
think to retire it. The client's logs confirm the exact signature: roughly
6 minutes since the last request, an immediate UNAVAILABLE/connection-
reset on the next attempt, then a clean success on a freshly-established
channel moments later - a pooled connection reused after the server
already tore it down, not any real instability in either service.

The fix is keeping the client's own idle-channel timeout comfortably
*shorter* than the server's, so the client proactively retires a pooled
connection before the server would ever close it first:

\`\`\`bash
GRPC_CLIENT_CHANNEL_IDLE_TIMEOUT_MS=45000   # under the server's 60000ms max idle
\`\`\`

As a general rule for any two gRPC (or plain HTTP keep-alive) endpoints
talking directly, pool or no pool, load balancer or none: whichever side
initiates and reuses a persistent connection needs its own idle timeout
to be shorter than whatever the receiving side enforces - otherwise the
receiving side will periodically close connections the sending side
still believes are good, producing exactly this "only the first request
after a quiet period fails" pattern.`,
};
