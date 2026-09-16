import type { Scenario } from "./types";

export const defaultDenyBlocksExternalApi: Scenario = {
  id: "default-deny-blocks-external-api",
  title: "Default Deny Blocks The External API",
  subtitle: "internal calls work fine. the one thing outside the cluster is a black hole.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["networkpolicy", "egress", "external-api"],
  briefing: `"fx-rates" was just brought under a namespace-wide default-deny egress
NetworkPolicy along with a set of explicit allow rules for every internal
dependency. Every internal call it makes still works perfectly. Its one
call to an external currency-rates API, essential for pricing, has failed
outright ever since.`,
  constraints: [
    "DNS resolution for the external API's hostname succeeds fine from inside fx-rates's pods - the failure happens only on the actual connection attempt.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fx-rates", namespace: "pricing2", labels: { app: "fx-rates" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "fx-rates-2b3c4d-e5f6g", namespace: "pricing2", labels: { app: "fx-rates" } },
        status: { phase: "Running", containerStatuses: [{ name: "fx-rates", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "fx-rates": [
            "2026-09-15T13:00:01.100Z DEBUG c.e.pricing.FxClient - resolved rates-provider.example.com -> 198.51.100.20",
            "2026-09-15T13:00:31.130Z ERROR c.e.pricing.FxClient - connect timed out: rates-provider.example.com:443",
          ],
        },
        age: "25m",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "fx-rates-egress", namespace: "pricing2" },
        spec: {
          podSelector: { matchLabels: { app: "fx-rates" } },
          policyTypes: ["Egress"],
          egress: [
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "catalog" } } }], ports: [{ port: 443, protocol: "TCP" }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "inventory" } } }], ports: [{ port: 443, protocol: "TCP" }] },
          ],
        },
        age: "30m",
      },
    ],
  },
  hints: [
    "fx-rates's logs show DNS resolution succeeding for the external hostname, then a connection timeout - so the block is happening on the actual TCP connection, not on name resolution.",
    "`kubectl get networkpolicy fx-rates-egress -n pricing2 -o yaml` - list every egress rule's `to:` target. Do any of them cover traffic to somewhere *outside* the cluster entirely?",
    "Every egress rule in this policy uses a `namespaceSelector`, which only ever matches pods inside the cluster - is there a rule using an `ipBlock` for the external API's address range at all?",
  ],
  options: [
    {
      id: "no-ipblock-rule-for-external-destination",
      label:
        "Every egress rule in `fx-rates-egress` uses a `namespaceSelector`, which only ever matches traffic to pods inside the cluster - there's no `ipBlock`-based rule covering the external rates-provider API's IP range at all, so despite DNS resolving the hostname successfully, the actual outbound connection to that external address has no matching allow rule and is dropped by the default-deny policy.",
      explanation:
        "Listing every egress rule shows three `namespaceSelector`-based entries (kube-system for DNS, catalog, and inventory) and nothing else - none of them can ever match traffic to an external, non-cluster IP address, since `namespaceSelector` only selects Kubernetes namespaces. fx-rates's own logs confirm DNS resolution succeeds (ruling out a DNS-layer block) and the failure is specifically the subsequent connection attempt timing out - exactly what happens when a default-deny egress policy has no rule permitting traffic to a given external destination.",
    },
    {
      id: "rates-provider-firewall-blocking-cluster",
      label: "The rates provider's own firewall is blocking traffic from the cluster's egress IP range.",
      explanation:
        "The failure began at the exact moment the new NetworkPolicy was applied to this namespace, and every other call this pod makes (to catalog and inventory) works fine - a provider-side block wouldn't correlate with a Kubernetes-internal policy change, and would more likely produce a connection refused or an HTTP-level rejection rather than a timeout consistent with local packet dropping.",
    },
    {
      id: "dns-policy-blocking-external-lookup",
      label: "The NetworkPolicy's DNS egress rule doesn't cover external hostname lookups.",
      explanation:
        "fx-rates's own debug log shows DNS resolution for the external hostname succeeding (`resolved rates-provider.example.com -> 198.51.100.20`) - the DNS egress rule to kube-system is working fine for this lookup; the failure is specifically on the subsequent connection attempt to the resolved external IP, a separate step DNS resolution success doesn't cover.",
    },
    {
      id: "fx-rates-tls-config-broken",
      label: "fx-rates's TLS client configuration is broken and failing to negotiate a handshake.",
      explanation:
        "A TLS handshake failure would occur after a successful TCP connection is established, producing a different kind of error (a handshake or certificate failure) rather than a connect timeout - the logs show the connection attempt itself never completing at all, consistent with packets being dropped before any TLS negotiation could begin.",
    },
  ],
  correctOptionId: "no-ipblock-rule-for-external-destination",
  resolution: `Every egress rule in \`fx-rates-egress\` is scoped with a
\`namespaceSelector\` - one for DNS to \`kube-system\`, and one each for the
\`catalog\` and \`inventory\` namespaces. A \`namespaceSelector\` can only ever
match pods running inside the cluster; there's no rule using an
\`ipBlock\` to permit traffic to any external, non-cluster destination at
all. fx-rates's own debug log confirms DNS resolution for the external
provider's hostname succeeds cleanly (the DNS egress rule covers that),
but the actual connection attempt to the resolved external IP has no
matching allow rule anywhere in the policy, so the default-deny baseline
drops it - producing exactly the connect timeout observed, isolated to
this one external dependency while every internal call keeps working.

The fix is adding an explicit \`ipBlock\` egress rule scoped to the
provider's address range:

\`\`\`yaml
spec:
  egress:
    - to:
        - ipBlock:
            cidr: 198.51.100.0/24
      ports:
        - port: 443
          protocol: TCP
\`\`\`

Bringing a service under a default-deny egress policy requires an
explicit rule for every real dependency it has - internal *and*
external. \`namespaceSelector\`-based rules only ever cover the internal
half; any external API call needs its own \`ipBlock\`-based rule (ideally
scoped to the provider's documented, stable address range) or it gets
silently dropped exactly like this, with nothing in the policy itself
flagging the gap.`,
};
