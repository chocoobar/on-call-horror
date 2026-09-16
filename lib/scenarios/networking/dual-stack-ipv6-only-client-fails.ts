import type { Scenario } from "../types";

export const dualStackIpv6OnlyClientFails: Scenario = {
  id: "dual-stack-ipv6-only-client-fails",
  title: "The Route That Only Existed On Paper",
  subtitle: "roughly half of all connection attempts from one pod hang for exactly the same amount of time before failing",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["ipv6", "dual-stack", "connectivity"],
  briefing: `The cluster was recently migrated to dual-stack networking (IPv4 and
IPv6) to prepare for an upcoming IPv6-only client rollout. Since then,
"content-api" has had a strange, consistent pattern: roughly half of its
outbound calls to an external CDN purge endpoint take exactly 21 seconds
before eventually succeeding, while the other half succeed instantly -
with no apparent difference between the two.`,
  constraints: [
    "The external CDN purge endpoint itself is healthy, and the calls that succeed instantly return correct, valid responses.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "content-api", namespace: "content2", labels: { app: "content-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "content-api-7d8e9f-g0h1i", namespace: "content2", labels: { app: "content-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "content-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "content-api": [
            "2026-09-15T09:12:01.000Z DEBUG c.e.content.CdnClient - resolved cdn-purge.example.com -> [2001:db8:85a3::8a2e, 203.0.113.77]",
            "2026-09-15T09:12:01.010Z DEBUG c.e.content.CdnClient - attempting AAAA (IPv6) connection to 2001:db8:85a3::8a2e:443",
            "2026-09-15T09:12:22.040Z DEBUG c.e.content.CdnClient - IPv6 attempt timed out after 21015ms, falling back to A (IPv4) 203.0.113.77:443",
            "2026-09-15T09:12:22.110Z INFO  c.e.content.CdnClient - request to cdn-purge.example.com succeeded via IPv4",
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dual-stack-migration-notes", namespace: "content2" },
        spec: {
          data: {
            "notes.md":
              "The cluster's nodes and pod CIDR were migrated to dual-stack, and pods\nnow legitimately receive both an IPv4 and an IPv6 address, with the\ncontainer runtime's DNS resolution returning both AAAA (IPv6) and A\n(IPv4) records for any dual-stack-published external hostname - exactly\nas intended, in preparation for the future IPv6-only rollout. However,\nthe cluster's egress path to the internet (a cloud NAT gateway plus\nassociated route tables) was only ever provisioned for IPv4 traffic;\nno IPv6 egress route exists yet for pod-originated traffic leaving the\ncluster to the public internet. A dual-stack-aware client attempting a\nmodern 'happy eyeballs' style connection race will still try the IPv6\naddress first (or according to its own preference order) and, since\nthere's genuinely no route out for it, that attempt hangs until its own\nclient-side timeout - in this client's case, a full 21 seconds - before\nfalling back to the IPv4 address, which works immediately over the\nexisting, correctly-provisioned IPv4 egress path.\n",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "content-api's debug log shows it resolving *two* addresses for the CDN hostname - an IPv6 one and an IPv4 one - and trying IPv6 first. What happens to that IPv6 attempt specifically?",
    "`kubectl get configmap dual-stack-migration-notes -n content2 -o yaml` - does the cluster's actual internet-facing egress path (NAT gateway, route tables) support IPv6 traffic yet, or only IPv4?",
    "A 21-second delay before falling back to IPv4 lines up with a client-side connection timeout for an attempt that never gets a response at all - not a rejection, a route that simply doesn't exist for that traffic to leave the cluster on.",
  ],
  options: [
    {
      id: "ipv6-egress-route-never-provisioned",
      label:
        "The cluster's pod CIDR and DNS resolution were migrated to dual-stack, so content-api's client correctly gets both an IPv6 and an IPv4 address for the CDN hostname and, per its own connection preference, tries IPv6 first - but the cluster's actual internet-facing egress path (NAT gateway and route tables) was only ever provisioned for IPv4, with no IPv6 route out to the internet at all; the IPv6 attempt hangs with no response until the client's own 21-second timeout, then falls back to the IPv4 address, which succeeds immediately over the existing, working IPv4 egress path.",
      explanation:
        "content-api's own debug log shows exactly this sequence: an IPv6 address attempted first, timing out at 21015ms, then falling back to IPv4 and succeeding instantly. `dual-stack-migration-notes` confirms why the IPv6 attempt specifically hangs rather than failing fast: pod addressing and DNS resolution were correctly migrated to dual-stack, but the cluster's actual internet egress infrastructure (NAT gateway, route tables) was never provisioned for IPv6 traffic - so an IPv6 connection attempt to an external address has no route out at all, and simply gets no response until the client gives up on its own.",
    },
    {
      id: "cdn-ipv6-endpoint-actually-down",
      label: "The CDN's own IPv6 endpoint is down or unreachable on their end.",
      explanation:
        "The external CDN endpoint is confirmed healthy, and the calls that do succeed (via the IPv4 fallback) return correct, valid responses - the failure pattern (a full, consistent 21-second hang with no response at all, rather than a fast rejection) is more consistent with no route existing out of the cluster for that address family, not a problem on the destination's end.",
    },
    {
      id: "content-api-client-happy-eyeballs-bug",
      label: "content-api's HTTP client has a bug in its IPv6/IPv4 fallback ('happy eyeballs') logic.",
      explanation:
        "The client's fallback behavior is working exactly as designed - it does eventually and correctly fall back to IPv4 and succeed. The problem isn't the fallback logic itself; it's that the IPv6 attempt it's falling back *from* has no way to ever succeed in this cluster's current egress configuration, which isn't something client-side fallback logic can fix or work around any faster than its own configured timeout allows.",
    },
    {
      id: "coredns-returning-wrong-aaaa-record",
      label: "CoreDNS is returning an incorrect or stale AAAA record for the CDN hostname.",
      explanation:
        "The resolved IPv6 address is a legitimate, correctly-formed address for the CDN's actual dual-stack-published hostname - there's no indication the DNS answer itself is wrong. The problem is entirely in whether the cluster has a network path capable of using that correctly-resolved address at all, not in what DNS returns.",
    },
  ],
  correctOptionId: "ipv6-egress-route-never-provisioned",
  resolution: `content-api's own debug log shows the full sequence: DNS correctly
returns both an IPv6 and IPv4 address for the CDN hostname, the client
tries IPv6 first per its own connection preference, that attempt hangs
for exactly 21015ms before timing out, and only then does it fall back
to IPv4, which succeeds immediately. \`dual-stack-migration-notes\`
explains the gap precisely: the cluster's pod addressing and DNS
resolution were correctly migrated to dual-stack, so pods (and their
outbound clients) genuinely have both address families available and
advertised - but the cluster's actual internet-facing egress
infrastructure, the NAT gateway and its route tables, was only ever
provisioned for IPv4 traffic. An IPv6 connection attempt to an external
address has no route out of the cluster at all; it doesn't get rejected
or refused, it simply never gets a response, so the client just waits
out its own timeout before trying the IPv4 path that actually works.

The fix is provisioning IPv6 egress infrastructure to match the
dual-stack pod networking that's already in place - typically an
IPv6-capable NAT gateway (or, in clouds without stateful IPv6 NAT, an
egress-only internet gateway) plus the corresponding route table entries:

\`\`\`bash
# example: AWS egress-only internet gateway for IPv6 outbound
aws ec2 create-egress-only-internet-gateway --vpc-id vpc-0abc123
aws ec2 create-route --route-table-id rtb-0def456 \\
  --destination-ipv6-cidr-block ::/0 \\
  --egress-only-internet-gateway-id eigw-0ghi789
\`\`\`

Until that egress path exists, an interim mitigation is disabling IPv6
address advertisement for pod-originated outbound DNS lookups (or tuning
client-side happy-eyeballs timeouts down significantly) so calls don't
pay the full IPv6-attempt penalty on every request - but the durable fix
is making sure dual-stack networking is provisioned symmetrically:
enabling IPv6 addressing and DNS without also enabling IPv6 egress
creates exactly this trap, where every dual-stack-aware client pays a
timeout tax attempting a path that was never actually built.`,
};
