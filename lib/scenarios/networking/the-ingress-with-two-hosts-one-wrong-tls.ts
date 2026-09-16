import type { Scenario } from "../types";

export const theIngressWithTwoHostsOneWrongTls: Scenario = {
  id: "the-ingress-with-two-hosts-one-wrong-tls",
  title: "The Two Hosts Sharing The Wrong Certificate",
  subtitle: "each host has its own TLS block. somehow they're still serving each other's certificates.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["ingress", "tls", "sni"],
  briefing: `"multi-tenant-portal" serves two distinct customer-facing hostnames,
"acme.tenants.example.com" and "globex.tenants.example.com," through one
Ingress with two separate TLS blocks, each referencing its own
tenant-specific certificate secret. After a routine cert rotation for
both tenants last night, each customer now sees the other tenant's
certificate warning in their browser.`,
  constraints: [
    "Both new certificate Secrets are confirmed valid, unexpired, and correctly matched to their intended hostname's private key.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "multi-tenant-portal", namespace: "tenants", labels: { app: "multi-tenant-portal" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "acme-tls", namespace: "tenants" },
        spec: { type: "kubernetes.io/tls" },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "globex-tls", namespace: "tenants" },
        spec: { type: "kubernetes.io/tls" },
        age: "12h",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "multi-tenant-portal", namespace: "tenants", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: {
          tls: [
            { hosts: ["acme.tenants.example.com"], secretName: "globex-tls" },
            { hosts: ["globex.tenants.example.com"], secretName: "acme-tls" },
          ],
          rules: [
            { host: "acme.tenants.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "multi-tenant-portal", port: { number: 80 } } } }] } },
            { host: "globex.tenants.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "multi-tenant-portal", port: { number: 80 } } } }] } },
          ],
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get ingress multi-tenant-portal -n tenants -o yaml` - look at the `tls` array carefully. Each entry has a `hosts` list and a `secretName` - do they actually pair up the way you'd expect?",
    "Both new certificate secrets are confirmed individually correct and valid for their intended tenant - so if browsers see the wrong cert, is the *secret* wrong, or is the *pairing* in the Ingress wrong?",
    "During last night's cert rotation, was there any chance the two `tls` entries' `secretName` values got swapped relative to their `hosts` entries?",
  ],
  options: [
    {
      id: "tls-entries-secretname-swapped",
      label:
        "The Ingress's `tls` array has its two entries crossed: the block listing `hosts: [acme.tenants.example.com]` references `secretName: globex-tls`, and the block listing `hosts: [globex.tenants.example.com]` references `secretName: acme-tls` - each individual certificate Secret is correct and valid on its own, but the Ingress serves globex's certificate for acme's hostname and vice versa, exactly matching each customer seeing the other tenant's certificate.",
      explanation:
        "Reading the Ingress's `tls` array entry by entry shows exactly this swap: the `acme.tenants.example.com` host entry points at `globex-tls`, and the `globex.tenants.example.com` host entry points at `acme-tls`. Both Secrets are independently confirmed valid and correctly matched to their intended tenant's key - the fault is purely in which `secretName` got paired with which `hosts` entry in the Ingress itself, most plausibly from a copy-paste or ordering mistake made while updating both blocks during last night's rotation.",
    },
    {
      id: "certificates-issued-for-wrong-domains",
      label: "The new certificates themselves were issued for the wrong domain names entirely.",
      explanation:
        "Both new Secrets are confirmed valid and correctly matched to their intended hostname's private key - the certificates themselves are correct; the problem is which certificate the Ingress associates with which hostname during TLS handshake selection, not any error in how either certificate was issued.",
    },
    {
      id: "cert-manager-cache-serving-stale-secrets",
      label: "cert-manager is serving a cached, stale version of one of the secrets.",
      explanation:
        "There's no indication of stale caching - both Secrets are confirmed to be the new, correctly-rotated ones; the issue is which of the two correct Secrets the Ingress's TLS configuration selects for which hostname, a pairing problem within the Ingress object itself, not staleness in either Secret's own content.",
    },
    {
      id: "ingress-controller-sni-cache-not-refreshed",
      label: "The ingress controller has a stale SNI certificate cache that hasn't picked up the new secrets.",
      explanation:
        "If the controller's cache were simply stale, it would most likely still be serving the *old*, pre-rotation certificates rather than consistently serving each tenant's certificate to the *other* tenant - a stale cache doesn't explain a clean, consistent one-to-one swap between two specific, otherwise-correct new certificates.",
    },
  ],
  correctOptionId: "tls-entries-secretname-swapped",
  resolution: `Reading the Ingress's \`tls\` array entry by entry shows the two blocks
crossed: the entry listing \`hosts: [acme.tenants.example.com]\`
references \`secretName: globex-tls\`, and the entry listing
\`hosts: [globex.tenants.example.com]\` references \`secretName: acme-tls\`.
Both certificate Secrets are individually confirmed valid, unexpired,
and correctly matched to their intended tenant's private key - the fault
is entirely in how the Ingress pairs each \`hosts\` entry with a
\`secretName\`, almost certainly a copy-paste or reordering slip made while
updating both TLS blocks together during last night's rotation. Since
SNI-based certificate selection is driven entirely by this pairing, the
ingress controller correctly and consistently serves globex's cert for
acme's hostname and vice versa - exactly matching each customer seeing
the other tenant's certificate warning.

The fix is a straightforward correction of the pairing:

\`\`\`yaml
spec:
  tls:
    - hosts: ["acme.tenants.example.com"]
      secretName: acme-tls
    - hosts: ["globex.tenants.example.com"]
      secretName: globex-tls
\`\`\`

For any multi-tenant Ingress with several TLS blocks updated together,
it's worth double-checking each \`hosts\`-to-\`secretName\` pairing
individually after the change, ideally by testing an actual TLS
handshake against each hostname (\`openssl s_client -connect ... -servername
<host>\`) rather than just confirming each certificate Secret's own
content is valid - a perfectly correct certificate paired with the wrong
hostname produces exactly this kind of quiet, easy-to-miss mix-up.`,
};
