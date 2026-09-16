import type { Scenario } from "./types";

export const theRepoServerCertThatExpired: Scenario = {
  id: "the-repo-server-cert-that-expired",
  title: "The Repo Server Cert That Expired",
  subtitle: "every Application on one internal git host stopped comparing at exactly 2am",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "tls", "repo-server"],
  briefing: `At 2am, every Application sourced from the company's self-hosted internal
GitLab instance simultaneously started failing comparison. Applications
pulling from public GitHub repos on the same ArgoCD instance are
completely unaffected. Nothing was deployed or changed in ArgoCD's own
configuration around that time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-repo-server-cert-that-expired", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://gitlab.internal.example.com/platform/fleet-management.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "fleet-management" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message: "x509: certificate has expired or is not yet valid: current time 2026-09-15T02:00:14Z is after 2026-09-15T02:00:00Z",
            },
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "internal-gitlab-tls-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "gitlab.internal.example.com serves a TLS certificate issued by the\ncompany's internal CA. That certificate's expiry was set to exactly\n2026-09-15T02:00:00Z - a 1-year cert issued without being placed under\ncert-manager's automatic renewal (a manual, one-off issuance from before\nthe internal CA had a cert-manager ClusterIssuer set up for it, never\nmigrated over since). Every other repo ArgoCD talks to (public GitHub)\nuses public CA-issued, auto-renewing certificates and is completely\nunaffected. argocd-repo-server validates TLS certificates for every git\noperation - once the internal GitLab cert expired, every comparison\nagainst any repo hosted there fails at the TLS handshake, uniformly and\nsimultaneously, exactly at the expiry timestamp.",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "The exact failure time (2am) and the error's own timestamps are suspiciously precise - `openssl s_client -connect gitlab.internal.example.com:443` and check the server certificate's actual expiry date.",
    "Only Applications sourced from the internal GitLab host are affected, while GitHub-sourced ones work fine - what's different about how those two hosts' TLS certificates are managed?",
    "`kubectl get configmap internal-gitlab-tls-notes -n argocd -o yaml` for how this particular certificate came to exist outside the normal auto-renewal process.",
  ],
  options: [
    {
      id: "internal-gitlab-cert-expired-no-auto-renewal",
      label:
        "gitlab.internal.example.com's TLS certificate was a manually-issued, one-year cert from before the internal CA had automatic renewal set up, and it expired at exactly 2am - every Application sourced from that host fails TLS validation at the same instant, while GitHub-sourced Applications (using auto-renewing public CA certs) are completely unaffected.",
      explanation:
        "The error is a textbook x509 certificate expiry, with a timestamp matching the incident precisely. `internal-gitlab-tls-notes` confirms the internal GitLab host's certificate was manually issued a year ago and never migrated onto the internal CA's automatic renewal process, unlike every externally-hosted repo using standard, auto-renewing public CA certificates. Since TLS validation happens per-repo-host at the connection level, only Applications sourced from this one specific host fail, and they all fail at the identical moment the certificate's validity window ended.",
    },
    {
      id: "argocd-repo-server-clock-skew",
      label: "argocd-repo-server's system clock has drifted, causing it to incorrectly evaluate certificate validity.",
      explanation:
        "If the repo-server's own clock were wrong, it would misjudge certificate validity for *every* repo it evaluates, GitHub included - the fact that GitHub-sourced Applications are completely unaffected points specifically at the GitLab host's own certificate being genuinely expired, not at a clock issue on ArgoCD's side.",
    },
    {
      id: "gitlab-instance-down-cert",
      label: "The internal GitLab instance itself went down at 2am for unrelated maintenance.",
      explanation:
        "The error is specifically an x509 certificate validation failure at the TLS handshake, not a connection-refused or timeout error that a genuinely down server would produce - ArgoCD is reaching the server and being rejected specifically on certificate validity, which means the server itself is up and responding.",
    },
    {
      id: "repo-credentials-rotated-cert",
      label: "ArgoCD's stored credentials for the internal GitLab repos were rotated and are now invalid.",
      explanation:
        "The error is a TLS-layer certificate expiry, which happens before git authentication credentials would ever be evaluated - a credentials/authentication failure would look like a 'Permission denied' or 401-style error occurring after a successful TLS handshake, not an x509 validity failure at the handshake itself.",
    },
  ],
  correctOptionId: "internal-gitlab-cert-expired-no-auto-renewal",
  resolution: `The error is an unambiguous x509 certificate expiry, with a timestamp
lining up exactly with the incident's start. \`internal-gitlab-tls-notes\`
explains why this host specifically: its TLS certificate was a manually
issued, one-year certificate from before the internal CA had automatic
renewal wired up via cert-manager, and it was never migrated onto that
automated process afterward. Every externally-hosted repo (GitHub) uses
standard, auto-renewing public CA certificates and was never at risk.
TLS validation happens per connection to a given host, so only
Applications sourced from \`gitlab.internal.example.com\` fail, and they
all fail simultaneously the instant that one certificate's validity
window ended.

Immediate fix: issue a fresh certificate for the internal GitLab host so
comparisons recover right away:

\`\`\`
openssl req -new -key gitlab-internal.key -out gitlab-internal.csr \\
  -subj "/CN=gitlab.internal.example.com"
# sign via the internal CA, then update the GitLab instance's TLS config
\`\`\`

Real fix: bring this host under the internal CA's cert-manager
ClusterIssuer, same as everything else, so it renews automatically and
this specific failure mode can't recur:

\`\`\`yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: gitlab-internal-tls
  namespace: gitlab
spec:
  secretName: gitlab-internal-tls
  dnsNames:
    - gitlab.internal.example.com
  issuerRef:
    name: internal-ca-issuer
    kind: ClusterIssuer
\`\`\`

Worth a broader audit of every internally-hosted service ArgoCD talks to
for the same "manually issued cert from before auto-renewal existed"
pattern - each one is a standing risk of an identical, simultaneous,
hard-to-diagnose-at-2am outage the moment its own certificate's clock
runs out.`,
};
