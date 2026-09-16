import type { Scenario } from "../types";

export const egressCidrTypoBlockedEverything: Scenario = {
  id: "egress-cidr-typo-blocked-everything",
  title: "The CIDR Block With A Typo",
  subtitle: "a NetworkPolicy meant to allow one API call blocked it completely instead",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["networkpolicy", "egress", "cidr"],
  briefing: `A NetworkPolicy was added to "geo-lookup" to lock down its egress to only
the one external IP address range it's actually supposed to call - a
geolocation data provider - as part of a security tightening pass. Since
it was applied, every single call to that provider has failed, when the
whole point of the policy was to keep allowing exactly that traffic.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "geo-lookup", namespace: "geo", labels: { app: "geo-lookup" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "500d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "geo-lookup-1p2q3r-s4t5u", namespace: "geo", labels: { app: "geo-lookup" } },
        status: { phase: "Running", containerStatuses: [{ name: "geo-lookup", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "geo-lookup": [
            "2026-09-15T12:10:01.010Z ERROR c.e.geo.ProviderClient - connect timed out: geo-provider.example.org:443 (203.0.113.50)",
            "2026-09-15T12:10:31.040Z ERROR c.e.geo.ProviderClient - connect timed out: geo-provider.example.org:443 (203.0.113.50)",
          ],
        },
        age: "500d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "geo-lookup-egress-lockdown", namespace: "geo" },
        spec: {
          podSelector: { matchLabels: { app: "geo-lookup" } },
          policyTypes: ["Egress"],
          egress: [
            { to: [{ ipBlock: { cidr: "203.0.113.50/32" } }], ports: [{ port: 443, protocol: "TCP" }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }] },
          ],
        },
        age: "15m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "geo-provider-dns-notes", namespace: "geo" },
        spec: {
          data: {
            "notes.md":
              "geo-provider.example.org currently resolves to 203.0.113.150, not\n203.0.113.50 - the provider's infrastructure was migrated to a new IP\nwithin their existing /24 block about two months ago, and the /32 CIDR\nhardcoded into the new egress policy was copied from an old internal\nrunbook that was never updated after that migration.\n",
          },
        },
        age: "15m",
      },
    ],
  },
  hints: [
    "`kubectl get networkpolicy geo-lookup-egress-lockdown -n geo -o yaml` - what's the exact CIDR in the egress rule's `ipBlock`?",
    "geo-lookup's own logs show it trying to connect to a specific resolved IP - does that IP actually fall inside the policy's allowed `/32` CIDR?",
    "`kubectl get configmap geo-provider-dns-notes -n geo -o yaml` - has the provider's real IP address changed since whatever source the policy's CIDR was copied from?",
  ],
  options: [
    {
      id: "cidr-references-old-ip-provider-moved",
      label:
        "The new egress policy allows traffic only to `203.0.113.50/32` - a single, old IP address - but the provider's infrastructure moved to `203.0.113.150` two months ago, and the outdated `/32` CIDR was copied from a stale runbook that never got updated; since the policy allows exactly one old address and nothing else, every real call to the provider's current, correct IP gets blocked, exactly the opposite of the policy's intent.",
      explanation:
        "geo-lookup's own logs show it attempting to reach `203.0.113.50` - matching the policy's `ipBlock` exactly, which confirms the application's configured target hasn't changed. `geo-provider-dns-notes` reveals the provider actually resolves to `203.0.113.150` now, a completely different address within the same /24 that the narrow `/32` rule doesn't cover at all. The policy technically works exactly as configured - it's just configured against a stale IP that stopped being correct two months before the policy was even written.",
    },
    {
      id: "policy-missing-dns-egress-rule",
      label: "The policy is missing an egress rule allowing DNS lookups.",
      explanation:
        "The policy does include a DNS egress rule to `kube-system` on port 53/UDP, and the failure itself is a connect timeout to a specific, already-resolved IP address - not a DNS resolution failure, which would show as an unknown-host error rather than a timeout connecting to a known address.",
    },
    {
      id: "wrong-port-in-policy",
      label: "The egress rule allows the wrong port instead of 443.",
      explanation:
        "The policy's egress rule correctly allows port 443/TCP, matching exactly what geo-lookup is attempting to connect on - the port isn't the mismatch here; it's the specific IP address the rule's `ipBlock` is scoped to.",
    },
    {
      id: "provider-side-outage",
      label: "The geolocation provider is having an outage on their end.",
      explanation:
        "There's no indication of a provider-side outage, and the failure pattern - a connection timeout specifically for the address the NetworkPolicy doesn't cover - is fully explained by the policy's outdated CIDR blocking a legitimate destination, which is a self-inflicted cluster-side issue rather than anything on the provider's infrastructure.",
    },
  ],
  correctOptionId: "cidr-references-old-ip-provider-moved",
  resolution: `geo-lookup's own logs show it attempting to reach \`203.0.113.50\` -
which does match the new NetworkPolicy's \`ipBlock\` exactly, confirming
the application's own DNS resolution and target address haven't changed
at all. \`geo-provider-dns-notes\` reveals the real problem: the provider
migrated to \`203.0.113.150\` two months ago, within the same /24 range but
a distinctly different address, and the narrow \`/32\` CIDR written into
the new egress policy was copied from an old, never-updated internal
runbook that still referenced the pre-migration IP. The policy is
working exactly as written - it allows precisely one address and nothing
else - it's just written against an address that stopped being correct
before the policy was ever created, so it blocks the real, current
traffic entirely rather than permitting it as intended.

The fix is correcting the CIDR to the provider's actual current address
(and, ideally, widening it slightly to tolerate the provider rotating
within their announced range in the future):

\`\`\`yaml
spec:
  egress:
    - to:
        - ipBlock:
            cidr: 203.0.113.128/27   # covers the provider's current /24 block's active range
      ports:
        - port: 443
          protocol: TCP
\`\`\`

Any egress NetworkPolicy scoped to a specific external IP is only as
correct as the freshness of that IP - it's worth verifying the actual,
currently-resolved address at the moment the policy is written (not
trusting an old runbook or ticket), and revisiting IP-pinned egress rules
periodically if the external provider is known to rotate addresses within
a range.`,
};
