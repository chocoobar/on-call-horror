import type { Scenario } from "./types";

export const theSecretThatWasntMountedForTls: Scenario = {
  id: "the-secret-that-wasnt-mounted-for-tls",
  title: "The Certificate Secret That Didn't Exist Yet",
  subtitle: "browsers get a scary warning and the wrong certificate entirely",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["ingress", "tls", "secrets"],
  briefing: `A new Ingress for "partner-portal.example.com" was just deployed with a
TLS block referencing a secret that's supposed to hold the domain's
certificate. Every browser hitting the site gets a certificate mismatch
warning, presented with a completely different domain's certificate
instead of partner-portal's own.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "partner-portal", namespace: "partners", labels: { app: "partner-portal" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1h",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "partner-portal", namespace: "partners", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: {
          tls: [{ hosts: ["partner-portal.example.com"], secretName: "partner-portal-tls" }],
          rules: [{ host: "partner-portal.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "partner-portal", port: { number: 80 } } } }] } }],
        },
        age: "50m",
        events: [
          { type: "Warning", reason: "SecretNotFound", age: "48m", message: "secret \"partner-portal-tls\" not found in namespace \"partners\"" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ingress-controller-notes", namespace: "partners" },
        spec: {
          data: {
            "notes.md":
              "This nginx ingress controller is configured with a `--default-ssl-\ncertificate` fallback (pointing at a wildcard cert for a different,\nunrelated internal domain), used for any TLS-enabled host whose\nreferenced Secret can't be found. When an Ingress's `tls.secretName`\npoints at a Secret that doesn't exist in the same namespace, the\ncontroller doesn't fail the Ingress outright - it silently serves that\ndefault fallback certificate instead for any request to that host, which\nis why browsers see a completely different, mismatched certificate\nrather than any kind of clear 'certificate missing' error.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get ingress partner-portal -n partners -o yaml` and its events - does the referenced TLS secret actually exist?",
    "`kubectl get secret partner-portal-tls -n partners` - was this secret ever actually created?",
    "`kubectl get configmap ingress-controller-notes -n partners -o yaml` - what does this specific ingress controller do when a referenced TLS secret is missing, instead of failing outright?",
  ],
  options: [
    {
      id: "tls-secret-never-created",
      label:
        "The Ingress references `partner-portal-tls` as its TLS secret, but that secret was never actually created in the `partners` namespace - the ingress controller's own event confirms `secret \"partner-portal-tls\" not found`, and per this controller's fallback behavior, it silently serves its configured default certificate (for an unrelated domain) instead of failing the Ingress outright, producing exactly the mismatched-certificate warning browsers see.",
      explanation:
        "The Ingress's own `SecretNotFound` event states the exact cause. `ingress-controller-notes` explains why this doesn't show up as an obvious TLS error: this controller falls back to a `--default-ssl-certificate` for any host whose referenced secret is missing, silently serving a completely unrelated domain's certificate rather than refusing the connection - exactly matching browsers getting a valid-looking but mismatched cert instead of any clearer failure.",
    },
    {
      id: "wrong-dns-record-pointing-elsewhere",
      label: "partner-portal.example.com's DNS record points at the wrong load balancer entirely.",
      explanation:
        "The request is reaching the correct ingress controller (it's actively serving a TLS response, just with the wrong, fallback certificate) - a DNS misconfiguration would more likely produce a connection failure or route to entirely different infrastructure, not a certificate served by the correct controller for a different host.",
    },
    {
      id: "cert-manager-issuer-misconfigured",
      label: "cert-manager's ClusterIssuer is misconfigured and failing to issue the certificate.",
      explanation:
        "There's no indication cert-manager is even involved in provisioning this particular secret - the Ingress's own event is a straightforward \"secret not found\" for a name that was apparently expected to already exist or be created through some other process, not a failed certificate-issuance attempt reflected anywhere.",
    },
    {
      id: "ingress-controller-crashed",
      label: "The ingress controller pod crashed and is serving stale cached configuration.",
      explanation:
        "The ingress controller is actively and correctly serving traffic for this host (routing to partner-portal's Service works, evidenced by the Deployment being healthy and the Ingress being otherwise functional) - it's specifically the TLS certificate selection that's falling back, not a broader controller failure or stale state.",
    },
  ],
  correctOptionId: "tls-secret-never-created",
  resolution: `The Ingress's own event states it plainly:
\`secret "partner-portal-tls" not found in namespace "partners"\`. The TLS
secret referenced by the Ingress's \`tls.secretName\` was simply never
created - likely a missed step (manual cert upload, or a cert-manager
\`Certificate\` resource that was never applied) when the Ingress itself
was deployed. \`ingress-controller-notes\` explains why this produces a
confusing symptom rather than an obvious failure: this ingress
controller is configured with a \`--default-ssl-certificate\` fallback,
serving that unrelated default cert for any TLS-enabled host whose
referenced secret can't be found, instead of refusing the connection
outright - which is exactly why browsers get a mismatched-certificate
warning rather than a clean "site can't provide secure connection"
error.

The fix is actually creating the referenced secret with a valid
certificate for the domain - most simply, via a cert-manager
\`Certificate\` resource if the cluster already runs cert-manager:

\`\`\`yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: partner-portal-tls
  namespace: partners
spec:
  secretName: partner-portal-tls
  dnsNames:
    - partner-portal.example.com
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
\`\`\`

Once the Secret exists with a valid cert and key, the ingress controller
picks it up automatically for this host on its next sync - no Ingress
redeploy needed. Worth double-checking, for any ingress controller with a
default-certificate fallback configured, whether it's worth also alerting
on \`SecretNotFound\` events specifically, since this failure mode doesn't
otherwise surface as an obvious outage.`,
};
