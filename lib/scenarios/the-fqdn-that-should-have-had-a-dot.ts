import type { Scenario } from "./types";

export const theFqdnThatShouldHaveHadADot: Scenario = {
  id: "the-fqdn-that-should-have-had-a-dot",
  title: "The FQDN That Should Have Had A Dot",
  subtitle: "one hostname, resolved five different ways, before it finally fails",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["dns", "search-domain", "latency"],
  briefing: `"partner-sync" calls an external vendor's API at
"api.vendorcorp.com". It works, but every single call takes noticeably
longer than it should - several hundred milliseconds just for DNS
resolution, on a hostname that should resolve almost instantly.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "partner-sync", namespace: "integrations", labels: { app: "partner-sync" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "12d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "partner-sync-4c5d6e-h7i8j", namespace: "integrations", labels: { app: "partner-sync" } },
        status: { phase: "Running", containerStatuses: [{ name: "partner-sync", ready: true, restartCount: 0, state: { running: {} } }] },
        spec: {
          dnsConfig: { options: [{ name: "ndots", value: "5" }] },
          dnsPolicy: "ClusterFirst",
        },
        logs: {
          "partner-sync": [
            "2026-09-15T10:20:01.010Z DEBUG c.e.integrations.VendorClient - resolving api.vendorcorp.com",
            "2026-09-15T10:20:01.014Z DEBUG c.e.integrations.VendorClient - lookup api.vendorcorp.com.integrations.svc.cluster.local -> NXDOMAIN (4ms)",
            "2026-09-15T10:20:01.019Z DEBUG c.e.integrations.VendorClient - lookup api.vendorcorp.com.svc.cluster.local -> NXDOMAIN (5ms)",
            "2026-09-15T10:20:01.024Z DEBUG c.e.integrations.VendorClient - lookup api.vendorcorp.com.cluster.local -> NXDOMAIN (5ms)",
            "2026-09-15T10:20:01.310Z DEBUG c.e.integrations.VendorClient - lookup api.vendorcorp.com.ec2.internal -> NXDOMAIN (286ms, upstream)",
            "2026-09-15T10:20:01.340Z DEBUG c.e.integrations.VendorClient - lookup api.vendorcorp.com -> 203.0.113.77 (30ms, upstream, success)",
          ],
        },
        age: "12d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kube-dns", namespace: "kube-system" },
        spec: { data: { "resolv.conf": "search integrations.svc.cluster.local svc.cluster.local cluster.local ec2.internal\nndots:5\n" } },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl exec` into the pod and check `/etc/resolv.conf` - what does the `search` line list, and what's the `ndots` value?",
    "partner-sync's own debug log shows five separate DNS lookups for one hostname before it succeeds - count the dots in `api.vendorcorp.com` (2) against the pod's `ndots` setting (5).",
    "With `ndots:5`, any name with fewer than 5 dots gets every search-domain suffix tried *first*, in order, before the resolver ever tries the name as fully-qualified on its own - each failed attempt against an internal search domain still costs a real round-trip, especially to the slow, external `ec2.internal` domain last in the list.",
  ],
  options: [
    {
      id: "ndots-5-exhausts-search-list-before-fqdn",
      label:
        "The pod's `ndots:5` setting means any hostname with fewer than 5 dots (like `api.vendorcanet.com`, which only has 2) gets every entry in the DNS `search` list tried first, in order, before the resolver finally tries it as-is - each of those failed internal lookups costs a real round-trip, and the last one against `ec2.internal` is answered by a slow upstream resolver, adding hundreds of milliseconds before the actual, correct lookup ever happens.",
      explanation:
        "The pod's `resolv.conf` shows `ndots:5` with four search-domain suffixes configured. `api.vendorcorp.com` has only 2 dots - below the `ndots` threshold - so the resolver tries every search suffix first: three fast internal NXDOMAINs against cluster-local domains, then a slow 286ms NXDOMAIN against `ec2.internal` (an external, upstream-resolved suffix), and only then the actual hostname on its own, which finally succeeds. That's exactly the five-lookup sequence in the debug log, and exactly where the extra latency comes from.",
    },
    {
      id: "vendor-dns-server-slow",
      label: "The vendor's own authoritative DNS servers are slow to respond.",
      explanation:
        "The final, correct lookup for `api.vendorcorp.com` itself only takes 30ms once it's actually attempted - the vendor's DNS is fast. The overwhelming majority of the delay comes from four failed lookups against irrelevant search-domain suffixes that happen before the real query is ever made.",
    },
    {
      id: "coredns-pods-overloaded",
      label: "The cluster's CoreDNS pods are overloaded and slow to answer any query.",
      explanation:
        "The three cluster-local lookups (`.svc.cluster.local` variants) each resolve quickly, in single-digit milliseconds - CoreDNS itself is responding fast. The slow step is a single upstream-forwarded lookup against an irrelevant suffix, not general CoreDNS overload.",
    },
    {
      id: "tls-handshake-latency-mistaken-for-dns",
      label: "The delay is actually TLS handshake time being mistaken for DNS resolution time.",
      explanation:
        "partner-sync's own debug logs specifically timestamp and label each step as a DNS lookup, well before any TLS handshake would begin - the delay is directly and explicitly attributed to DNS resolution, not conflated with anything downstream.",
    },
  ],
  correctOptionId: "ndots-5-exhausts-search-list-before-fqdn",
  resolution: `The pod's \`resolv.conf\` sets \`ndots:5\` alongside a four-entry \`search\`
list. Any hostname with fewer dots than the \`ndots\` value gets every
search-domain suffix appended and tried, in order, before the resolver
ever attempts the name as fully-qualified on its own. \`api.vendorcorp.com\`
has only 2 dots, well under the threshold, so every call triggers four
extra lookups first: three fast, cluster-local NXDOMAINs, then a slower
286ms NXDOMAIN against \`ec2.internal\` (forwarded to an upstream
resolver), and only then the real, correct lookup - which itself only
takes 30ms. The debug log shows this exact five-step sequence on every
single call.

The most targeted fix is telling the client to treat this specific
hostname as fully qualified, skipping the search list entirely, by adding
a trailing dot:

\`\`\`java
// api.vendorcorp.com. (trailing dot = fully qualified, no search suffixes tried)
String vendorHost = "api.vendorcorp.com.";
\`\`\`

More broadly, for any pod making frequent calls to external, non-cluster
hostnames, lowering \`ndots\` (e.g. to 2) via the pod's \`dnsConfig\` avoids
this tax on every external call, at the cost of needing fully-qualified
names for anything genuinely relying on the short-name search behavior:

\`\`\`yaml
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"
\`\`\`

This exact pattern - external, dotted hostnames paying for several failed
internal lookups on every single call - is one of the most common
sources of "why is DNS slow" latency in Kubernetes clusters using the
default \`ndots:5\`.`,
};
