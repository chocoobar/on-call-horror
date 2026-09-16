import type { Scenario } from "./types";

export const crossRegionLatencyMistakenForOutage: Scenario = {
  id: "cross-region-latency-mistaken-for-outage",
  title: "The Outage That Was Just Distance",
  subtitle: "error rate spiked to 8% the instant the primary region failed over. nothing is actually down.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["latency", "failover", "multi-region"],
  briefing: `An automatic regional failover moved "inventory-service" traffic from
us-east to us-west twenty minutes ago after a us-east infrastructure
issue. Since then, "order-api" (which still runs only in us-east) has
seen its error rate climb to 8% on calls to inventory-service, all
timeouts. Both services individually report healthy.`,
  constraints: [
    "inventory-service's own request logs in us-west show it successfully handling every request that reaches it, with no errors on its own side.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "order-api", namespace: "orders3", labels: { app: "order-api" } },
        spec: { replicas: 5 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 5 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "order-api-4v5w6x-y7z8a", namespace: "orders3", labels: { app: "order-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "order-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "order-api": [
            "2026-09-15T12:00:05.020Z ERROR c.e.orders.InventoryClient - request timed out after 200ms: inventory-service.inventory.svc.cluster.local",
            "2026-09-15T12:00:05.850Z INFO  c.e.orders.InventoryClient - request succeeded in 187ms: inventory-service.inventory.svc.cluster.local",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "failover-latency-notes", namespace: "orders3" },
        spec: {
          data: {
            "notes.md":
              "order-api's HTTP client to inventory-service has a fixed 200ms\ntimeout, tuned for calls when both services run in the same region\n(us-east), where round-trip latency is typically 5-15ms. Since the\nautomatic failover, inventory-service now runs only in us-west, and the\ncross-region round-trip between us-east and us-west measures a\nconsistent 160-210ms under normal network conditions - well within the\nrange of ordinary variance to occasionally exceed a 200ms timeout purely\non added distance and the extra network hops involved, with nothing\nactually wrong with either service or the network path itself.\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "inventory-service's own logs show it successfully handling every request that reaches it - so what's happening to the ones that never make it there at all, or that don't come back in time?",
    "order-api's own logs show both a timeout and, moments later, a successful call to the exact same target - what's the configured timeout, and how does that compare to what cross-region latency alone might now cost?",
    "`kubectl get configmap failover-latency-notes -n orders3 -o yaml` - what was order-api's client timeout originally tuned for, and has the actual network distance to inventory-service changed?",
  ],
  options: [
    {
      id: "fixed-timeout-too-tight-for-new-cross-region-latency",
      label:
        "order-api's HTTP client has a fixed 200ms timeout, originally tuned for same-region calls (5-15ms round trip) - since the failover moved inventory-service to us-west, the cross-region round trip now runs 160-210ms under normal conditions, so a meaningful fraction of otherwise-completely-healthy calls simply exceed the tight timeout purely due to added distance, with both services individually healthy and inventory-service's own logs confirming it successfully serves every request that actually reaches it.",
      explanation:
        "`failover-latency-notes` gives the exact numbers: a 200ms timeout tuned for a same-region 5-15ms round trip, against a new cross-region round trip that now normally runs 160-210ms - meaning ordinary variance alone pushes some fraction of calls over the timeout, with nothing actually broken. order-api's own logs show this directly: a timeout followed immediately by a successful call to the identical target, exactly the pattern of a timeout that's simply too tight for the now-longer normal latency, not evidence of any real failure on either side.",
    },
    {
      id: "inventory-service-degraded-in-us-west",
      label: "inventory-service is running in a degraded state in us-west after the failover.",
      explanation:
        "inventory-service's own request logs in us-west show it successfully handling every request that reaches it, with no errors on its own side - it isn't degraded at all; the errors order-api sees are its own client-side timeouts on calls that either arrive late or, per the logs, sometimes succeed moments after an initial timeout to the same target.",
    },
    {
      id: "networkpolicy-blocking-cross-region-traffic",
      label: "A NetworkPolicy is only partially allowing cross-region traffic to the new inventory-service location.",
      explanation:
        "There's no indication of any NetworkPolicy change coinciding with the failover, and a policy-level block would typically produce a much higher, more consistent failure rate (or a clean connection refusal/timeout with no successful calls at all) rather than an 8% rate with individual calls succeeding on retry - consistent instead with marginal timing variance against a tight timeout.",
    },
    {
      id: "dns-resolving-to-stale-us-east-ip",
      label: "order-api's DNS resolution is still caching inventory-service's old us-east address.",
      explanation:
        "inventory-service's own logs confirm requests are genuinely arriving and being served successfully in us-west - if DNS were resolving to a stale, no-longer-valid us-east address, requests would fail to connect at all rather than reaching and being served correctly by the new location the vast majority of the time.",
    },
  ],
  correctOptionId: "fixed-timeout-too-tight-for-new-cross-region-latency",
  resolution: `\`failover-latency-notes\` supplies the exact numbers behind this: order-
api's HTTP client to inventory-service has a fixed 200ms timeout, tuned
for the same-region round trip it was designed around (5-15ms). Since
the automatic failover moved inventory-service entirely to us-west, the
new cross-region round trip normally runs 160-210ms - close enough to
the 200ms timeout that ordinary, healthy variance alone pushes some
fraction of otherwise-successful calls over it. order-api's own logs
show this directly: a timeout on one attempt, immediately followed by a
successful call to the exact same target, which is exactly what a
timeout set too tight for genuinely-increased normal latency looks like,
not evidence of any actual failure in either service or the network path
connecting them.

The fix is raising the client timeout to comfortably accommodate the new,
real cross-region latency, with some margin for its own variance:

\`\`\`yaml
# order-api's inventory-service client config
INVENTORY_CLIENT_TIMEOUT_MS: "500"
\`\`\`

Longer-term, since this timeout was silently invalidated by an automatic
regional failover nobody coordinated with order-api's own configuration,
it's worth either making the timeout dynamically aware of which region
its dependency is currently running in, or, more robustly, deploying
order-api itself with presence in both regions so it can always call a
same-region (or nearest) instance of inventory-service regardless of
which region is currently active - avoiding the cross-region latency
question entirely rather than just widening the timeout to tolerate it.`,
};
