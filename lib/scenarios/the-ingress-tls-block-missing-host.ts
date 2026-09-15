import type { Scenario } from "./types";

export const theIngressTlsBlockMissingHost: Scenario = {
  id: "the-ingress-tls-block-missing-host",
  title: "The Second Host Nobody Added To TLS",
  subtitle: "the new regional subdomain serves the wrong certificate, even though both hosts share one Ingress",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["ingress", "tls", "sni"],
  briefing: `"status-page" was recently expanded to also serve traffic on a new
regional hostname, "status-eu.example.com," alongside its original
"status.example.com," both routed through the same Ingress object. The
original hostname's certificate is fine. The new regional one gets a
certificate mismatch warning in every browser.`,
  constraints: [
    "A single wildcard certificate covering both hostnames already exists in the cluster and is confirmed valid and unexpired.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "status-page", namespace: "status", labels: { app: "status-page" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "status-wildcard-tls", namespace: "status" },
        spec: { type: "kubernetes.io/tls" },
        age: "40d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "status-page", namespace: "status", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: {
          tls: [{ hosts: ["status.example.com"], secretName: "status-wildcard-tls" }],
          rules: [
            { host: "status.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "status-page", port: { number: 80 } } } }] } },
            { host: "status-eu.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "status-page", port: { number: 80 } } } }] } },
          ],
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ingress-tls-sni-notes", namespace: "status" },
        spec: {
          data: {
            "notes.md":
              "The nginx ingress controller serves a certificate per-host based on\nSNI (the hostname the client requests during the TLS handshake), by\nmatching the requested host against the `hosts` list of each entry in\nthe Ingress's own `spec.tls` array - *not* by matching against the\n`rules` list. A host present under `spec.rules` but absent from every\n`spec.tls[].hosts` entry gets whatever the ingress controller's default\nfallback certificate is for SNI purposes, even if a perfectly valid\ncertificate covering that host already exists as a Kubernetes Secret\nsomewhere and is even referenced by the *same* Ingress object for a\ndifferent host.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get ingress status-page -n status -o yaml` - compare the hostnames listed under `spec.rules` against the hostnames listed under `spec.tls[].hosts`.",
    "Both hostnames route through `spec.rules` correctly - but is `status-eu.example.com` listed anywhere under `spec.tls`?",
    "`kubectl get configmap ingress-tls-sni-notes -n status -o yaml` - which list does the ingress controller actually use to decide which certificate to present for a given SNI hostname?",
  ],
  options: [
    {
      id: "new-host-missing-from-tls-hosts-list",
      label:
        "`status-eu.example.com` was added to the Ingress's `spec.rules` for routing, but never added to the `hosts` list under `spec.tls` - the ingress controller selects which certificate to present via SNI based specifically on the `tls[].hosts` list, not `rules`, so a request for the new hostname gets whatever default/fallback certificate applies instead of the wildcard cert that would actually cover it, even though that cert already exists and is even referenced by the very same Ingress object.",
      explanation:
        "`ingress-tls-sni-notes` explains the exact mechanism: SNI-based certificate selection is driven by `spec.tls[].hosts`, independently of `spec.rules`. The Ingress's `tls` block only lists `status.example.com` - `status-eu.example.com` is present under `rules` (so routing works) but entirely absent from `tls.hosts` (so its TLS handshake never gets matched to the wildcard cert), producing exactly the observed certificate mismatch for only the new hostname.",
    },
    {
      id: "wildcard-cert-doesnt-cover-eu-subdomain",
      label: "The existing wildcard certificate's domain pattern doesn't actually cover the new `status-eu` subdomain.",
      explanation:
        "The wildcard certificate is confirmed valid and covering both hostnames - the problem isn't the certificate's own coverage, it's that the Ingress's `tls` block never lists the new hostname at all, so the ingress controller never even considers using that certificate for it.",
    },
    {
      id: "status-page-service-misrouted",
      label: "The Service backing status-page is misrouting requests for the new hostname.",
      explanation:
        "Both hostnames route to the identical backend Service and path in the Ingress's `rules`, and HTTP-level routing to the Service isn't the layer where a certificate mismatch warning would originate - that happens during the TLS handshake, before any HTTP routing decision is even made.",
    },
    {
      id: "dns-not-propagated-for-eu-subdomain",
      label: "DNS for status-eu.example.com hasn't fully propagated yet.",
      explanation:
        "A DNS propagation issue would prevent the request from reaching the ingress controller at all - the browser is clearly connecting to something and completing enough of a TLS handshake to receive and display a (mismatched) certificate, which requires the request to have actually arrived at the right infrastructure.",
    },
  ],
  correctOptionId: "new-host-missing-from-tls-hosts-list",
  resolution: `\`ingress-tls-sni-notes\` explains the exact mechanism at play: an nginx
ingress controller selects which certificate to present during a TLS
handshake based on matching the requested SNI hostname against each
entry's \`hosts\` list under \`spec.tls\` - a completely separate list from
\`spec.rules\`, which only governs HTTP-level routing after the TLS
handshake completes. The Ingress's \`tls\` block lists only
\`status.example.com\`; \`status-eu.example.com\` was added under
\`spec.rules\` (so routing to status-page works correctly for it) but was
never added to \`tls.hosts\`. The ingress controller has no TLS-layer
match for that hostname, so it falls back to its own default certificate
for the handshake, regardless of the fact that a perfectly valid wildcard
cert covering it already exists and is even referenced by this same
Ingress object for the other host.

The fix is adding the new hostname to the \`tls.hosts\` list, since the
existing certificate already covers it:

\`\`\`yaml
spec:
  tls:
    - hosts:
        - status.example.com
        - status-eu.example.com
      secretName: status-wildcard-tls
\`\`\`

Any time a new hostname is added to an Ingress that already terminates
TLS, it needs to be added in *two* places if it should share an existing
certificate - once under \`spec.rules\` for routing, and once under the
relevant \`spec.tls[].hosts\` entry for certificate selection. Adding it
to only one of the two produces exactly this kind of routing-works-but-
certificate-is-wrong symptom.`,
};
