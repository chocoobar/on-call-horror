import type { Scenario } from "../types";

export const splitBrainDns: Scenario = {
  id: "split-brain-dns",
  title: "Split-Brain DNS",
  subtitle: "some pods reach the new payments gateway fine. others still hit a server that was decommissioned last week.",
  difficulty: "hard",
  type: "fix",
  topic: "networking",
  timeMinutes: 25,
  tags: ["dns", "ttl", "migration"],
  briefing: `"billing-worker" was migrated to a new payments gateway host a week ago,
and the old one was fully decommissioned three days ago. Most pods have
worked perfectly against the new host the whole time. A handful of
long-running pods are still, somehow, successfully sending traffic to a
public hostname that should now point only at the new host - and getting
connection failures, since the old server behind it is gone.`,
  constraints: [
    "The DNS record itself, checked right now from any fresh lookup, correctly and only returns the new gateway's IP address - there is no lingering old record being served by anyone.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-worker", namespace: "billing", labels: { app: "billing-worker" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "billing-worker-5p6q7r8s9-t0u1v", namespace: "billing", labels: { app: "billing-worker" } },
        status: { phase: "Running", containerStatuses: [{ name: "billing-worker", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-08T02:00:00Z" } } }] },
        logs: {
          "billing-worker": [
            "2026-09-15T09:00:01.114Z ERROR c.e.billing.GatewayClient - connect timed out: payments-gateway.example.com:443",
            "2026-09-15T09:00:12.980Z ERROR c.e.billing.GatewayClient - connect timed out: payments-gateway.example.com:443",
          ],
        },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gateway-migration-notes", namespace: "billing" },
        spec: {
          data: {
            "notes.md":
              "`payments-gateway.example.com`'s DNS record had a TTL of 604800\nseconds (7 days) at the time of the migration - an unusually long TTL,\nset years ago for a rarely-changing record, never revisited. The record\nwas updated to the new IP 7 days ago, but any resolver (or\napplication-level DNS cache) that had already cached the *old* IP\nbefore that point, with the old 7-day TTL attached, would hold onto that\ncached answer until a full 7 days after its own last lookup - independent\nof when the record actually changed at the source.\n\nbilling-worker-5p6q7r8s9-t0u1v has been running continuously since\nbefore the migration and uses a JVM HTTP client with DNS caching enabled\nat the JVM level (`networkaddress.cache.ttl`), which by default caches a\nsuccessful resolution indefinitely unless a Security Manager policy says\notherwise - it resolved and cached the *old* IP once, on startup, before\nthe migration ever happened, and has never looked it up again since.\n",
          },
        },
        age: "7d",
      },
    ],
  },
  hints: [
    "`kubectl get pod billing-worker-5p6q7r8s9-t0u1v -n billing -o yaml` - when did this specific pod actually start, relative to when the DNS migration happened?",
    "`kubectl get configmap gateway-migration-notes -n billing -o yaml` - what TTL was on the DNS record, and separately, does the JVM itself do any DNS caching of its own, independent of the record's TTL?",
    "A DNS record's TTL only governs how long an external resolver or cache is supposed to hold an answer - it says nothing about how long a *process* that already resolved and cached the address internally, before the TTL even applies again, keeps using that cached value.",
  ],
  options: [
    {
      id: "jvm-dns-cache-indefinite-plus-long-ttl",
      label:
        "This specific pod has been running since before the migration and resolved `payments-gateway.example.com` to the old IP exactly once, on startup - the JVM's own DNS cache (separate from and on top of the DNS record's already-long 7-day TTL) holds that successful resolution indefinitely by default, so the process has simply never looked the name up again since, regardless of what the record itself has correctly pointed to for the past week.",
      explanation:
        "`gateway-migration-notes` confirms two independent, compounding facts: the DNS record's TTL was an unusually long 7 days, and separately, the JVM's own built-in DNS caching (`networkaddress.cache.ttl`) defaults to caching a successful lookup *indefinitely*, entirely independent of the record's own TTL. The affected pod started before the migration and, per the JVM's caching behavior, resolved and cached the old IP exactly once and never re-resolved since - it has no reason to, as far as the JVM is concerned, its cached answer never expires. Every pod that started *after* the migration got a fresh lookup and correctly cached the new IP from the start, which is exactly why some pods work perfectly while a specific subset of older, longer-running pods keep failing against a host that no longer exists.",
    },
    {
      id: "old-dns-record-still-being-served",
      label: "The old DNS record is still being served by some authoritative or intermediate DNS server.",
      explanation:
        "A fresh lookup right now, from anywhere, is confirmed to correctly return only the new IP - there's no lingering old record being served by anything upstream. The stale answer exists only inside one specific long-running process's own internal cache, not anywhere in the DNS infrastructure itself.",
    },
    {
      id: "load-balancer-still-routing-to-old-server",
      label: "A load balancer in front of the payments gateway is still routing some traffic to the decommissioned old server.",
      explanation:
        "The old server itself was fully decommissioned three days ago - there's no infrastructure left for a load balancer to route to even if one were involved, and the failure is a connection timeout consistent with attempting to reach an IP address that no longer has anything listening, not a load balancer making a bad routing decision.",
    },
    {
      id: "network-policy-blocking-new-gateway-ip",
      label: "A NetworkPolicy is blocking egress specifically to the new gateway's IP address for some pods.",
      explanation:
        "The affected pod is still trying to connect to the *old* IP address (the one behind the now-decommissioned server), not being blocked from reaching the new one - a NetworkPolicy issue would produce a different failure, still attempting the correct, current destination and being denied, rather than attempting a stale, no-longer-current destination at all.",
    },
  ],
  correctOptionId: "jvm-dns-cache-indefinite-plus-long-ttl",
  resolution: `Two separate facts compound here, both confirmed in
\`gateway-migration-notes\`. First, the DNS record itself had an unusually
long 7-day TTL going into the migration - already a long window for
anything doing a fresh, TTL-respecting lookup to keep an old answer
around. Second, and more importantly for this specific pod: the JVM's
own built-in DNS resolution cache is a separate layer entirely, sitting
in front of the OS/network-level DNS resolution, and by default caches a
successful lookup *indefinitely*, with no relationship to the record's
own TTL at all. This pod has been running continuously since before the
migration; it resolved \`payments-gateway.example.com\` to the old IP
exactly once, at its own startup, and - per the JVM's default caching
behavior - has simply never had a reason to look it up again since. As
far as that one process is concerned, its cached answer never expires.
Every pod that happened to start *after* the migration did its own fresh
lookup and got the new IP from the start, which is exactly why the
failure is isolated to a specific subset of long-running pods rather than
being universal or tied to anything about the DNS infrastructure itself
(which is, and has been, entirely correct).

There's no live fix available from this read-only console for the
already-running pod (the fix is simply restarting it, forcing a fresh
lookup), but the durable fixes are:

\`\`\`properties
# java.security, or set programmatically at startup
networkaddress.cache.ttl=60
\`\`\`

giving the JVM's own DNS cache a real, bounded TTL instead of caching
indefinitely, and separately, lowering the DNS record's own TTL well
before any future migration, so external caches (and any process not
running the whole time across the change) pick up the new value quickly
too. Any long-running JVM process making outbound calls to a hostname
that might ever be re-pointed is implicitly relying on either restarting
regularly or having a sane, bounded DNS cache TTL configured - the
default of "cache successful lookups forever" is a common, easy-to-miss
trap for exactly this kind of migration.`,
};
