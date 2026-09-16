import type { Scenario } from "./types";

export const theDecommissionedEndpointCache: Scenario = {
  id: "the-decommissioned-endpoint-cache",
  title: "The Decommissioned Endpoint Cache",
  subtitle: "a Node.js worker keeps sending webhooks to a URL that was retired last week",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "caching", "migration"],
  briefing: `"webhook-dispatcher" delivers outbound event notifications to a downstream
consumer service. That consumer was migrated to new infrastructure with a
new IP last week; the old host was fully decommissioned three days ago.
Most delivery attempts succeed against the new host. One specific,
long-running dispatcher pod keeps failing every delivery with connection
refused - to a host that no longer exists.`,
  constraints: [
    "A fresh DNS lookup for the consumer's hostname, from anywhere, returns only the new, correct IP right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "webhook-dispatcher", namespace: "events", labels: { app: "webhook-dispatcher" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "11d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "webhook-dispatcher-3z4a5b-c6d7e", namespace: "events", labels: { app: "webhook-dispatcher" } },
        status: { phase: "Running", containerStatuses: [{ name: "webhook-dispatcher", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-04T03:00:00Z" } } }] },
        logs: {
          "webhook-dispatcher": [
            "2026-09-15T09:00:01.020Z ERROR webhookDispatcher - delivery failed: connect ECONNREFUSED 198.51.100.12:443",
            "2026-09-15T09:00:31.040Z ERROR webhookDispatcher - delivery failed: connect ECONNREFUSED 198.51.100.12:443",
          ],
        },
        age: "11d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dispatcher-runtime-notes", namespace: "events" },
        spec: {
          data: {
            "notes.md":
              "webhook-dispatcher runs on Node.js and uses the platform's built-in DNS\nresolution with connection pooling via `http.Agent`/`https.Agent`\n(`keepAlive: true`). Node's default DNS behavior resolves a hostname\nonce per new outbound connection and does not automatically re-resolve\nfor a connection reused from the agent's own keep-alive pool - so a\nlong-lived pooled connection, once established against a given resolved\nIP, keeps being reused against that same IP indefinitely (subject to the\nagent's own configured `keepAliveMsecs` and any server-side or OS-level\nconnection lifetime, not to the DNS record's own TTL). This specific pod\nhas been running continuously since before the migration - it opened its\npooled connection to the consumer while the old IP was still the correct\nanswer, and has kept sending every delivery over that same reused,\nnow-stale connection since.\n",
          },
        },
        age: "11d",
      },
    ],
  },
  hints: [
    "`kubectl get pod webhook-dispatcher-3z4a5b-c6d7e -n events -o yaml` - when did this specific pod start, relative to when the consumer migrated?",
    "`kubectl get configmap dispatcher-runtime-notes -n events -o yaml` - does webhook-dispatcher reuse pooled HTTP connections, and does Node.js re-resolve DNS for a reused connection?",
    "A fresh DNS lookup right now is confirmed correct - so the problem isn't what DNS *would* return today, it's whether this specific process ever actually asked DNS again since the migration happened.",
  ],
  options: [
    {
      id: "long-lived-pooled-connection-never-re-resolved",
      label:
        "This specific pod has been running continuously since before the migration and uses Node's `keepAlive`-enabled HTTP agent, which reuses a pooled connection - once established against the old, correct-at-the-time IP - without ever triggering a fresh DNS lookup for reused connections; it's been sending every delivery over that same long-lived, now-stale connection to the decommissioned host ever since, independent of the DNS record itself (confirmed correct right now) and independent of any TTL, since a pooled connection reuse never revisits DNS at all.",
      explanation:
        "`dispatcher-runtime-notes` explains the mechanism directly: Node's `http.Agent`/`https.Agent` with `keepAlive: true` reuses a connection once established, with no automatic re-resolution of DNS for reused connections. The affected pod started before the migration, meaning its pooled connection was opened against the old IP while that was still correct, and it's had no reason since to open a *new* connection (which would trigger a fresh DNS lookup) - matching a fresh DNS lookup being confirmed correct right now while this one long-running process keeps failing against the old, decommissioned address.",
    },
    {
      id: "old-consumer-endpoint-not-fully-decommissioned",
      label: "The old consumer endpoint isn't actually fully decommissioned and is still partially reachable.",
      explanation:
        "The connection is being actively refused (`ECONNREFUSED`), which is consistent with nothing listening at that address anymore - if the old host were still partially up, a connection attempt would more likely succeed or hang rather than being cleanly refused, and the scenario confirms the host was fully decommissioned three days ago.",
    },
    {
      id: "load-balancer-still-has-stale-target",
      label: "A load balancer in front of the consumer still has the old, decommissioned host registered as a target.",
      explanation:
        "The old host itself was fully decommissioned - there's no infrastructure left behind any load balancer to still be registered as a target, and the failing connection is going directly to the old IP, consistent with a client that resolved that address itself rather than any load-balancer-level routing decision.",
    },
    {
      id: "networkpolicy-blocking-new-ip-range",
      label: "A NetworkPolicy is blocking egress specifically to the new consumer IP range.",
      explanation:
        "The affected pod is still attempting to connect to the *old* IP address, not being blocked while trying to reach the new one - a NetworkPolicy issue would show as a failure while attempting the current, correct destination and being denied, not a connection attempt against a stale, no-longer-current address.",
    },
  ],
  correctOptionId: "long-lived-pooled-connection-never-re-resolved",
  resolution: `\`dispatcher-runtime-notes\` explains the exact mechanism: webhook-
dispatcher uses Node.js's \`http\`/\`https\` agents with \`keepAlive: true\`,
which pool and reuse established connections - and reusing a pooled
connection never triggers a fresh DNS lookup, regardless of the DNS
record's own TTL. This specific pod has been running continuously since
before the migration; its pooled connection to the consumer was opened
while the old IP was still the correct answer, and it's had no reason
since to open a brand-new connection (the only event that would trigger
a fresh DNS resolution). Every delivery since has gone out over that
same long-lived, now-stale connection straight to the decommissioned
host - fully consistent with a fresh DNS lookup right now correctly
returning only the new IP, since the DNS layer was never at fault; this
one process simply never asked it again.

There's no live fix for the already-running pod short of restarting it
to force a fresh connection (and fresh DNS lookup) on next use, but the
durable fix is bounding how long the agent will keep reusing any single
pooled connection:

\`\`\`javascript
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  // force periodic connection cycling so long-lived processes
  // eventually pick up DNS changes without a full restart
  timeout: 10 * 60 * 1000, // recycle connections after 10 minutes
});
\`\`\`

Any long-lived process using connection pooling to a hostname that might
ever be re-pointed - a migration, a failover, a DNS-based blue/green
cutover - needs either a bounded connection lifetime or an explicit,
periodic DNS re-resolution strategy; \`keepAlive\` alone, with no upper
bound on connection age, will happily keep reusing a stale destination
indefinitely once resolved.`,
};
