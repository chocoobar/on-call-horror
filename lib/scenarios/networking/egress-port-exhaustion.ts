import type { Scenario } from "../types";

export const egressPortExhaustion: Scenario = {
  id: "egress-port-exhaustion",
  title: "Egress Port Exhaustion",
  subtitle: "calls to one external API start failing randomly, only during the afternoon rush",
  difficulty: "hard",
  type: "fix",
  topic: "networking",
  timeMinutes: 25,
  tags: ["nat", "networking", "egress"],
  briefing: `"pricing-sync" calls a single external pricing-data API at high
concurrency to keep prices current. Every afternoon during peak traffic,
a growing fraction of those specific outbound calls start failing to even
establish a connection - while every other outbound call this same
service makes, to other external hosts, keeps working fine the entire
time.`,
  constraints: [
    "The external pricing-data API's own status page confirms no incident or degradation on their side during these windows.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-sync", namespace: "pricing", labels: { app: "pricing-sync" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-sync-4i5j6k7l8-m9n0o", namespace: "pricing", labels: { app: "pricing-sync" } },
        status: { phase: "Running", containerStatuses: [{ name: "pricing-sync", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pricing-sync": [
            "2026-09-15T14:32:01.114Z ERROR c.e.pricing.ExternalPriceClient - connect timed out: external-pricing-data.example.com:443",
            "2026-09-15T14:32:01.980Z ERROR c.e.pricing.ExternalPriceClient - connect timed out: external-pricing-data.example.com:443",
            "2026-09-15T14:32:02.410Z INFO  c.e.pricing.ExternalPriceClient - fetched price update for sku-88213 from external-pricing-data.example.com successfully",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "egress-nat-notes", namespace: "pricing" },
        spec: {
          data: {
            "notes.md":
              "All outbound traffic from this cluster's node pool leaves through a\nshared NAT gateway with a single external IP. A NAT gateway can only\nhave roughly 64,000 concurrent outbound (source-IP, source-port,\ndest-IP, dest-port) mappings *per destination IP:port pair* before it\nruns out of source ports to allocate for new connections to that same\ndestination - existing connections to *other* destinations are entirely\nunaffected, since each destination has its own independent pool of\nmappings.\n\npricing-sync opens a large number of short-lived HTTPS connections to\nthe *same* external host on every price-check cycle, and afternoon peak\ntraffic multiplies both request volume and concurrency for this one\nintegration specifically - no other outbound integration this service\nuses has comparable per-destination connection volume.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap egress-nat-notes -n pricing -o yaml` - a NAT gateway's mapping table limit is per *destination*, not a single shared number across everything. Does that change which calls would be affected first?",
    "`kubectl logs pricing-sync-4i5j6k7l8-m9n0o -n pricing` - the failures and successes are interleaved for the *same* destination host, not a clean on/off pattern - what would produce exactly that?",
    "Short-lived connections that open and close rapidly, at high concurrency, to one specific destination consume and release SNAT ports quickly - but if the rate of opening new connections outpaces the rate old ones get cleaned up, what happens to new connection attempts once the per-destination mapping table for that one destination fills up?",
  ],
  options: [
    {
      id: "snat-port-exhaustion-for-one-destination",
      label:
        "The shared NAT gateway's per-destination pool of SNAT (source NAT) ports for `external-pricing-data.example.com` gets exhausted during afternoon peak, when pricing-sync's high-concurrency, high-volume short-lived connections to that one host outpace how quickly old mappings free up - new connection attempts to that specific destination fail to even establish (connect timeouts) once the table is full, while every other destination has its own completely independent, unaffected pool of mappings.",
      explanation:
        "`egress-nat-notes` explains the exact mechanism: NAT mapping-table limits are per destination IP:port pair, not one shared ceiling across all outbound traffic, and pricing-sync's connection pattern to this one external host - many short-lived, high-concurrency connections, worst during afternoon peak - is uniquely intense compared to every other integration this service uses. That matches the symptom precisely: failures and successes interleaved for the *same* host (some connection attempts land when a port happens to free up, others don't), isolated entirely to this one destination, worst exactly when concurrency and request volume peak, and completely absent from every other outbound call sharing the same NAT gateway but going to different, much less loaded destinations.",
    },
    {
      id: "external-api-rate-limiting",
      label: "The external pricing-data API is rate-limiting requests during peak hours.",
      explanation:
        "The external API's own status page confirms no degradation or incident on their side during these windows, and a rate-limit rejection would typically show up as an HTTP-level error response (e.g. 429) after a successful connection, not a connection-level timeout that never gets a response at all - this is failing before a request could even be sent.",
    },
    {
      id: "pricing-sync-thread-pool-exhausted",
      label: "pricing-sync's internal HTTP client thread pool is exhausted during peak concurrency.",
      explanation:
        "A thread-pool exhaustion would produce delayed request *dispatch* generally, likely affecting calls to every destination this service talks to, not a failure isolated specifically to connections against one particular external host while every other outbound call keeps succeeding normally.",
    },
    {
      id: "dns-resolver-overloaded",
      label: "The DNS resolver is overloaded during peak traffic and failing to resolve the external hostname.",
      explanation:
        "A DNS resolution failure would produce an unknown-host error before any connection attempt is even made, not a connection-level timeout - the client here is clearly attempting an actual connection to a resolved address and failing to establish it, which is a different, later stage of the process.",
    },
  ],
  correctOptionId: "snat-port-exhaustion-for-one-destination",
  resolution: `\`egress-nat-notes\` explains the mechanism precisely: a shared NAT gateway
tracks outbound connections per (source IP, source port, destination IP,
destination port) tuple, and its practical mapping-table limit applies
*per destination*, not as one number shared evenly across every outbound
call a service makes. pricing-sync's connection pattern to
\`external-pricing-data.example.com\` - many short-lived, high-concurrency
HTTPS connections on every price-check cycle - is uniquely intense
compared to any other integration sharing the same NAT gateway. During
afternoon peak, the rate of opening new connections to that one
destination outpaces how quickly old mappings are freed as connections
close, and once that destination's specific pool of available SNAT ports
runs out, new connection attempts to it simply can't get a port allocated
- they time out trying to connect, with nothing to indicate why on either
end. Every other outbound destination this service (or anything else on
the same node pool) talks to has its own, completely independent pool and
is entirely unaffected, which matches the observed isolation to this one
host exactly, along with the interleaved failure/success pattern (some
attempts land when a port frees up in time, others don't).

A few complementary fixes, from most to least invasive:

- **Reduce short-lived connection churn**: reuse persistent HTTP
  connections (connection pooling / keep-alive) to this specific host
  instead of opening a fresh connection per request, which is by far the
  most effective fix since it directly reduces the mapping-table pressure
  causing the exhaustion.
- **Spread egress across more source IPs**: a NAT gateway configuration
  supporting multiple external IPs multiplies the total available
  per-destination port pool.
- **Rate-limit client-side concurrency** to this one destination during
  peak windows as a stopgap, trading some throughput for reliability.

Connection pooling is usually the real fix - a service that opens and
closes a new connection per request to a high-volume external destination
will eventually hit this same NAT limit again at some scale, no matter
how the NAT gateway itself is provisioned.`,
};
