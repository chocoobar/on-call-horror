import type { Scenario } from "../types";

export const dnsRoundRobinCachingSingleIp: Scenario = {
  id: "dns-round-robin-caching-single-ip",
  title: "The Round Robin That Never Rotated",
  subtitle: "three healthy backend IPs published in DNS. every long-running caller only ever picked the first one.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "round-robin", "load-balancing"],
  briefing: `An external analytics vendor, "metrics-vendor.io," publishes three A
records for round-robin load balancing across their own backend fleet.
"analytics-forwarder" has called that hostname reliably for months. One
of the vendor's three backend IPs was pulled out of rotation for
maintenance an hour ago, and since then a third of analytics-forwarder's
long-running worker pods have had every single call fail outright.`,
  constraints: [
    "The vendor confirms the two remaining IPs are healthy and correctly still listed as current A records for the hostname.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "analytics-forwarder", namespace: "analytics2", labels: { app: "analytics-forwarder" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "analytics-forwarder-2c3d4e-f5g6h", namespace: "analytics2", labels: { app: "analytics-forwarder" } },
        status: { phase: "Running", containerStatuses: [{ name: "analytics-forwarder", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-14T09:00:00Z" } } }] },
        logs: {
          "analytics-forwarder": [
            "2026-09-15T10:15:02.010Z ERROR c.e.analytics.VendorClient - connect refused: metrics-vendor.io:443 (203.0.113.15)",
            "2026-09-15T10:15:32.040Z ERROR c.e.analytics.VendorClient - connect refused: metrics-vendor.io:443 (203.0.113.15)",
          ],
        },
        age: "30h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "vendor-dns-notes", namespace: "analytics2" },
        spec: {
          data: {
            "notes.md":
              "metrics-vendor.io publishes A records for 203.0.113.10, 203.0.113.15,\nand 203.0.113.20, intended to be round-robined across by any\nstandards-compliant DNS client (picking a different one per lookup, or\nat least per new connection). analytics-forwarder's HTTP client\nresolves the hostname once, on first use, and then caches *only the\nfirst IP address returned by the resolver* for the lifetime of the\nprocess, reusing it for every subsequent connection rather than\nre-resolving or rotating through the full set - a known limitation of\nthis particular HTTP client library's default connection strategy, which\nassumes a single, stable backend address rather than a load-balanced\nDNS pool. Any long-running pod that happened to have its first lookup\nland on 203.0.113.15, which the vendor took out of rotation for\nmaintenance an hour ago, has been retrying against that same, now-\nunavailable address ever since, while pods that happened to land on\neither of the two still-healthy addresses are entirely unaffected.\n",
          },
        },
        age: "30h",
      },
    ],
  },
  hints: [
    "The vendor confirms both remaining IPs are healthy - so why would any caller still be trying the one that was pulled out of rotation an hour ago?",
    "`kubectl get configmap vendor-dns-notes -n analytics2 -o yaml` - does analytics-forwarder's HTTP client actually re-resolve and rotate through every published IP, or does it pick one and stick with it?",
    "Only a third of analytics-forwarder's pods are affected - roughly consistent with one of three round-robined IPs being pulled. What would determine which pods are affected: something about the pod itself, or something about which IP its first DNS lookup happened to land on?",
  ],
  options: [
    {
      id: "client-sticks-to-first-resolved-ip-not-rotating",
      label:
        "analytics-forwarder's HTTP client resolves metrics-vendor.io once and caches only the first IP address returned, reusing it for the process's entire lifetime rather than re-resolving or rotating through the vendor's full published set of three - any pod whose one-time initial lookup happened to land on 203.0.113.15 has kept retrying that same now-unavailable address ever since it was pulled from rotation, while pods that happened to land on either of the two still-healthy addresses are completely unaffected, matching roughly a third of pods being impacted.",
      explanation:
        "`vendor-dns-notes` confirms the client library's behavior directly: a single resolution, cached and reused for the process's lifetime, rather than genuine round-robin rotation across the vendor's three published IPs. The affected pod's own logs show it specifically and repeatedly targeting `203.0.113.15` - the exact IP the vendor pulled for maintenance - while the vendor confirms the other two IPs are healthy. This matches roughly a third of pods being affected (consistent with one of three IPs being unlucky enough to be each pod's cached choice) and precisely explains why some pods are completely fine while others fail every single call.",
    },
    {
      id: "vendor-dns-record-not-actually-updated",
      label: "The vendor never actually removed 203.0.113.15 from their own DNS records.",
      explanation:
        "The vendor confirms the two remaining IPs are correctly listed as current - implying 203.0.113.15 has genuinely been removed from active rotation on their side; the affected pods are using a *cached*, already-resolved address from before the removal, not a fresh lookup that's somehow still returning the removed IP.",
    },
    {
      id: "networkpolicy-blocking-two-of-three-ips",
      label: "A NetworkPolicy is blocking egress to two of the three vendor IPs, leaving only one reachable.",
      explanation:
        "The affected pods are specifically failing against `203.0.113.15` - the one IP the vendor actually pulled - not being blocked from reaching the two healthy ones (which unaffected pods reach just fine); a NetworkPolicy issue would need to selectively block exactly the removed IP while allowing the other two, which isn't how NetworkPolicy targeting works and isn't indicated here.",
    },
    {
      id: "load-balancer-in-front-of-vendor-misconfigured",
      label: "A load balancer in front of the vendor's own infrastructure is misrouting traffic to the decommissioned backend.",
      explanation:
        "analytics-forwarder connects directly to whichever IP its client resolved and cached, not through any load balancer of its own - and the vendor confirms their remaining infrastructure is healthy and correctly published; the issue is entirely on the calling side, in which cached IP a given long-running process happened to pick and never revisit.",
    },
  ],
  correctOptionId: "client-sticks-to-first-resolved-ip-not-rotating",
  resolution: `\`vendor-dns-notes\` explains the client-side behavior causing this: rather
than genuinely round-robining across metrics-vendor.io's three published
A records (re-resolving periodically, or picking a fresh address per
connection), analytics-forwarder's HTTP client library resolves the
hostname exactly once and caches only the first IP address it happens to
get back, reusing that single address for the entire lifetime of the
process. The affected pod's own logs confirm it's been targeting
\`203.0.113.15\` specifically and exclusively - precisely the address the
vendor pulled out of rotation an hour ago for maintenance - while the
vendor confirms the other two addresses remain healthy. Since each
long-running pod's very first lookup, whenever it happened to occur,
landed on one of the three addresses essentially at random and then
stuck with it permanently, roughly a third of pods (whichever ones
happened to land on \`.15\`) are now failing every call, while the
remaining two-thirds, who cached a different, still-healthy address, are
completely unaffected.

There's no live fix for an already-running affected pod short of
restarting it to force a fresh resolution, but the durable fix is either
configuring the client to re-resolve and rotate periodically, or moving
to a client library/connection strategy designed for a DNS-based pool
rather than a single stable address:

\`\`\`java
// re-resolve and refresh the connection pool's target list periodically
// instead of caching a single resolved IP for the process lifetime
httpClient.setDnsResolver(new PeriodicRefreshResolver(Duration.ofMinutes(1)));
\`\`\`

Any client relying on DNS-based round robin against a vendor's published
multi-A-record hostname needs to actually re-resolve periodically (or
per-connection) rather than caching a single address indefinitely -
otherwise every long-running process silently narrows itself down to
whichever one of the vendor's backends it happened to get on its very
first lookup, with no way to adapt when that specific backend is later
taken out of rotation.`,
};
