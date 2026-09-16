import type { Scenario } from "./types";

export const certManagerRenewalSilentlyFailing: Scenario = {
  id: "cert-manager-renewal-silently-failing",
  title: "The Renewal That Never Happened",
  subtitle: "the certificate has been expired for two days. nobody got paged.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["cert-manager", "tls", "certificate-expiry"],
  briefing: `Partners integrating with "b2b-api" started reporting SSL errors this
morning. The certificate serving b2b-api.example.com has, in fact,
expired - two days ago. cert-manager has been running in this cluster for
years and has never had a renewal fail before.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "cert-manager.io/v1",
        kind: "Certificate",
        metadata: { name: "b2b-api-tls", namespace: "b2b" },
        spec: { secretName: "b2b-api-tls", dnsNames: ["b2b-api.example.com"], issuerRef: { name: "letsencrypt-prod", kind: "ClusterIssuer" } },
        status: {
          conditions: [
            { type: "Ready", status: "False", reason: "Failed", message: "Failed to wait for order resource \"b2b-api-tls-abc12\" to become ready: order is in \"errored\" state" },
          ],
          notAfter: "2026-09-13T00:00:00Z",
        },
        age: "2y",
      },
      {
        apiVersion: "cert-manager.io/v1",
        kind: "Order",
        metadata: { name: "b2b-api-tls-abc12", namespace: "b2b" },
        status: {
          state: "errored",
          reason: "Failed to finalize Order: 400 urn:ietf:params:acme:error:rateLimited: too many certificates (5) already issued for this exact set of domains in the last 168 hours",
        },
        age: "2d",
        events: [
          { type: "Warning", reason: "Failed", age: "2d", message: "Failed to create Order: too many certificates already issued for this exact set of domains in the last 168 hours" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cert-renewal-history-notes", namespace: "b2b" },
        spec: {
          data: {
            "notes.md":
              "A CI pipeline misconfiguration, fixed yesterday, was accidentally\nre-applying b2b-api's Certificate resource on every deploy for the past\nweek - each re-apply, due to a hash-based trigger bug, caused cert-\nmanager to treat it as a spec change and kick off a brand-new issuance\nrequest against Let's Encrypt, rather than reusing the still-valid\nexisting certificate. Let's Encrypt enforces a hard rate limit of 5\ncertificates per exact set of domain names per rolling 168-hour (7-day)\nwindow - a limit this pipeline bug silently exhausted mid-week, well\nbefore the real, legitimate renewal (needed as the actual certificate\napproached its own natural expiry) was due to run.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get certificate b2b-api-tls -n b2b -o yaml` - what does the `Ready` condition actually say, and what does it point to?",
    "`kubectl get order b2b-api-tls-abc12 -n b2b -o yaml` - what's the specific error from the ACME order? Does it mention anything about a rate limit?",
    "`kubectl get configmap cert-renewal-history-notes -n b2b -o yaml` - was there any unusual repeated activity around this Certificate resource in the days before the real renewal was due?",
  ],
  options: [
    {
      id: "ci-bug-exhausted-lets-encrypt-rate-limit",
      label:
        "A CI pipeline bug, fixed only yesterday, was accidentally re-applying the Certificate resource on every deploy for the past week, each time triggering cert-manager to request a brand-new issuance against Let's Encrypt rather than reusing the still-valid certificate - this silently burned through Let's Encrypt's hard rate limit of 5 certificates per domain set per rolling week, so by the time the real, legitimately-needed renewal tried to run as the actual certificate approached expiry, every attempt failed with a rate-limit error, and the certificate expired with no successful renewal ever completing.",
      explanation:
        "The Order resource's own status states the exact ACME error: \"too many certificates (5) already issued for this exact set of domains in the last 168 hours\" - a hard Let's Encrypt rate limit. `cert-renewal-history-notes` explains how that limit got exhausted: an unrelated CI bug repeatedly re-triggered new issuance requests all week, using up the weekly quota well before the real renewal was ever due, so when it finally tried (and needed) to run, there was no quota left and it failed outright, leaving the certificate to expire with nothing available to alert on until it was already past its `notAfter` date.",
    },
    {
      id: "cluster-issuer-credentials-revoked",
      label: "The ClusterIssuer's ACME account credentials were revoked or became invalid.",
      explanation:
        "The Order's own error is a specific, well-defined ACME rate-limit response from Let's Encrypt, not an authentication or account-validity error - if the ACME account itself were invalid, the error would be a distinctly different one (typically an account or authorization failure), not a rate limit on certificate issuance volume.",
    },
    {
      id: "dns01-challenge-failing",
      label: "The ACME DNS-01 challenge for domain validation is failing.",
      explanation:
        "The Order's error occurs at the finalization step, after any challenge validation would already have needed to succeed for an order to reach that point, and the specific error text cites a rate limit on certificate issuance count, not any challenge or domain-validation failure at all.",
    },
    {
      id: "cert-manager-pod-crashlooping",
      label: "The cert-manager controller pod itself is crash-looping and not processing renewals.",
      explanation:
        "The Certificate and Order resources both show cert-manager actively processing them and getting real, specific responses back from Let's Encrypt (including the detailed rate-limit error) - this requires cert-manager itself to be running and functioning correctly; a crash-looping controller wouldn't be able to create orders or receive ACME error responses at all.",
    },
  ],
  correctOptionId: "ci-bug-exhausted-lets-encrypt-rate-limit",
  resolution: `The Order resource's own status states the ACME error verbatim: "too many
certificates (5) already issued for this exact set of domains in the
last 168 hours" - Let's Encrypt's hard weekly rate limit on certificate
issuance per exact domain set. \`cert-renewal-history-notes\` explains how
that limit got burned through: a CI pipeline bug, only fixed yesterday,
was accidentally re-applying the Certificate resource on every deploy
throughout the past week. Each re-apply looked like a spec change to
cert-manager (due to a hash-based change-detection bug), triggering a
brand-new issuance request each time rather than reusing the still-valid
existing certificate. By the time the real, legitimately-needed renewal
tried to run as the actual certificate neared its natural expiry, the
week's rate-limit quota was already exhausted by all those unnecessary
prior requests - so the real renewal failed too, and the certificate
expired with nothing left to retry against until the rate-limit window
rolls forward.

There's no way to force Let's Encrypt to bypass its own rate limit, so
the fix is primarily about waiting out the window while confirming the
CI bug (already fixed) won't recur, and manually retriggering renewal
once the 7-day window has rolled past the exhausting requests:

\`\`\`bash
# once the 168h window has cleared the earlier spurious requests:
kubectl annotate certificate b2b-api-tls -n b2b \\
  cert-manager.io/issue-temporary-certificate- \\
  cert-manager.io/force-renewal="$(date +%s)" --overwrite
\`\`\`

As a faster interim mitigation, temporarily serving a certificate from a
non-rate-limited path (a manually-issued cert from a different CA, or a
staging/less-restrictive issuer) can restore service while waiting out
the Let's Encrypt window. Longer-term, it's worth alerting directly on
Certificate \`Ready\` condition going \`False\`, rather than only on
certificate expiry - this would have caught the failing renewal
attempts days before the certificate actually expired and partners
started seeing errors.`,
};
