import type { Scenario } from "./types";

export const theKeepaliveThatOutlivedTheServer: Scenario = {
  id: "the-keepalive-that-outlived-the-server",
  title: "The Keep-Alive That Outlived The Server",
  subtitle: "every request works, except the first one after a coffee break",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["keep-alive", "http-client", "timeout"],
  briefing: `"invoice-generator" calls "tax-calc-svc" internally over plain HTTP, no
load balancer in between - just pod-to-pod inside the cluster. After any
stretch of a few minutes with no traffic between them, the very next call
fails with a connection reset. Every call after that first one works
perfectly again, for as long as traffic keeps flowing.`,
  constraints: [
    "tax-calc-svc's own pods are healthy and show no restarts around these errors.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "tax-calc-svc", namespace: "billing2", labels: { app: "tax-calc-svc" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "tax-calc-svc", image: "registry.internal/tax-calc-svc:4.1.0", env: [{ name: "SERVER_KEEPALIVE_TIMEOUT_SECONDS", value: "30" }] }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "200d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-generator", namespace: "billing2", labels: { app: "invoice-generator" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "invoice-generator", image: "registry.internal/invoice-generator:2.3.1", env: [{ name: "HTTP_CLIENT_POOL_IDLE_TIMEOUT_SECONDS", value: "120" }] }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-generator-3d4e5f-a1b2c", namespace: "billing2", labels: { app: "invoice-generator" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoice-generator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoice-generator": [
            "2026-09-15T15:40:00.201Z INFO  c.e.billing.TaxClient - invoice batch complete, next batch in ~4m",
            "2026-09-15T15:44:03.550Z ERROR c.e.billing.TaxClient - connection reset by peer: tax-calc-svc.billing2.svc.cluster.local:8080",
            "2026-09-15T15:44:03.612Z INFO  c.e.billing.TaxClient - retried on new connection, succeeded",
          ],
        },
        age: "40d",
      },
    ],
  },
  hints: [
    "Compare the two services' configured timeouts: `SERVER_KEEPALIVE_TIMEOUT_SECONDS` on tax-calc-svc versus `HTTP_CLIENT_POOL_IDLE_TIMEOUT_SECONDS` on invoice-generator's own connection pool. Which one is longer?",
    "tax-calc-svc's pods are healthy with no restarts - the reset isn't coming from the app crashing, it's the server side actively closing an idle connection that the client's pool still thinks is good.",
    "This is a direct pod-to-pod call with no load balancer in the middle - so whatever timeout mismatch is causing this has to be between the two applications' own HTTP configurations, not any infrastructure layer.",
  ],
  options: [
    {
      id: "client-pool-idle-timeout-exceeds-server-keepalive",
      label:
        "invoice-generator's HTTP client connection pool holds idle connections for up to 120 seconds, but tax-calc-svc's own server-side keep-alive timeout is only 30 seconds - after roughly half a minute of inactivity, tax-calc-svc closes the connection on its own side, but invoice-generator's pool still considers it valid for up to 90 seconds longer and hands it out for reuse, getting an immediate reset the moment it tries to send a request on a connection the server already closed.",
      explanation:
        "The two services' configured timeouts are directly comparable: `SERVER_KEEPALIVE_TIMEOUT_SECONDS=30` on tax-calc-svc versus `HTTP_CLIENT_POOL_IDLE_TIMEOUT_SECONDS=120` on invoice-generator. invoice-generator's logs show the reset happening after roughly a 4-minute gap in traffic - comfortably past the point tax-calc-svc would have already closed the connection - and a clean, successful retry on a brand-new connection immediately afterward. tax-calc-svc's pods show no crashes or restarts, confirming this is a normal, intentional server-side idle-connection close that the client's pool just didn't know about yet.",
    },
    {
      id: "tax-calc-svc-restarting",
      label: "tax-calc-svc's pods are restarting during quiet periods, dropping the connection.",
      explanation:
        "tax-calc-svc's pods are confirmed healthy with zero restarts correlating with these errors - the reset is a normal, intentional connection close from a live, healthy server enforcing its own keep-alive timeout, not a crash or restart.",
    },
    {
      id: "network-policy-idle-connection-drop",
      label: "A NetworkPolicy is dropping the connection after a period of inactivity.",
      explanation:
        "NetworkPolicies don't track or expire connections based on idle time at all - they only evaluate whether a new connection attempt is permitted. This failure pattern (an established connection getting reset, then working immediately after on a fresh one) is a hallmark of a keep-alive timeout mismatch between two HTTP endpoints, not a policy decision.",
    },
    {
      id: "dns-cache-stale-after-idle",
      label: "invoice-generator's cached DNS resolution for tax-calc-svc goes stale during the idle period.",
      explanation:
        "A stale DNS entry would cause a connection attempt to the wrong (or no longer valid) address on a *new* connection - it has no bearing on an already-established, pooled connection being actively reset by the peer, which is what's happening here.",
    },
  ],
  correctOptionId: "client-pool-idle-timeout-exceeds-server-keepalive",
  resolution: `tax-calc-svc's server-side keep-alive timeout is configured to 30
seconds - after that long with no activity on a given connection, it
closes the connection itself, a completely normal and intentional
behavior for freeing up idle server resources. invoice-generator's own
HTTP client connection pool, however, is configured to consider a pooled
connection valid for up to 120 seconds of idle time. During the roughly
4-minute gap between invoice batches shown in its logs, tax-calc-svc
closes the connection well before invoice-generator's pool would ever
consider it stale - so the pool hands out a connection that looks fine
from the client's own bookkeeping but no longer exists on the server
side, producing an immediate reset on first use. The very next attempt
succeeds because it opens a fresh connection, matching the pattern
exactly: only ever the first call after an idle stretch fails.

The fix is keeping the client's own idle-connection timeout comfortably
*shorter* than the server's keep-alive timeout, so the client always
retires a pooled connection before the server would ever close it first:

\`\`\`bash
HTTP_CLIENT_POOL_IDLE_TIMEOUT_SECONDS=25   # under tax-calc-svc's 30s keep-alive
\`\`\`

As a general rule for any two HTTP endpoints talking directly (with or
without a load balancer in between): the client side's own idle-timeout
should always be shorter than whatever the server side enforces, so
pooled connections are proactively retired by the side that still
considers itself responsible for them, instead of expiring silently on
one end while the other still thinks the connection is good.`,
};
