import type { Scenario } from "./types";

export const clusterSecretDrift: Scenario = {
  id: "cluster-secret-drift",
  title: "Cluster Secret Drift",
  subtitle: "every Application targeting the \"analytics\" cluster fails to sync with a TLS error",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "clusters", "tls"],
  briefing: `Every single Application that deploys to the separately-managed
"analytics" Kubernetes cluster started failing to sync at the same moment
this morning - all with a TLS handshake error. Applications targeting the
main cluster are completely unaffected.`,
  constraints: [
    "Nothing changed in any of the affected Applications' own manifests or sync policies around the time this started - the timing lines up with something else instead.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "analytics-etl", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/analytics-etl.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://analytics-cluster.internal:6443", namespace: "etl" },
          syncPolicy: { automated: { selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            { type: "ComparisonError", message: "Get \"https://analytics-cluster.internal:6443/api\": tls: failed to verify certificate: x509: certificate signed by unknown authority" },
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cluster-cert-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "The `analytics` cluster's API server certificate was rotated as part\nof a scheduled cert-manager renewal this morning (a new CA chain was\nissued). ArgoCD connects to registered clusters using connection details\n(including the expected CA data) stored in a `Secret` labeled\n`argocd.argoproj.io/secret-type: cluster` - this Secret's `config.tlsClientConfig.caData`\nstill holds the *previous* CA certificate, from before this morning's\nrotation. Nobody updated it as part of the rotation process.\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get application analytics-etl -n argocd -o yaml` - the error is specifically about certificate verification (`x509: certificate signed by unknown authority`), not connectivity or DNS.",
    "`kubectl get configmap cluster-cert-notes -n argocd -o yaml` - what changed on the analytics cluster's side this morning, and does ArgoCD's stored connection info know about it?",
    "ArgoCD stores each registered external cluster's connection details - including the CA certificate it trusts for that cluster's API server - in a dedicated cluster Secret, separate from any individual Application's own manifests or sync policy.",
  ],
  options: [
    {
      id: "cluster-secret-cadata-stale",
      label:
        "The analytics cluster's API server certificate was rotated onto a new CA chain this morning, but ArgoCD's cluster Secret for it still has the old CA certificate stored in `caData` - every Application targeting that cluster fails TLS verification the same way, because the underlying problem isn't in any Application's manifests, it's in ArgoCD's stored trust for the cluster itself.",
      explanation:
        "The error - `x509: certificate signed by unknown authority` - is specifically a trust/verification failure, not a connectivity, DNS, or authorization problem. `cluster-cert-notes` confirms the analytics cluster's certificate was rotated onto a new CA this morning, and that ArgoCD's cluster Secret (which stores the CA it trusts for that cluster, separate from any individual Application) was never updated to match. Because every Application targeting that cluster shares the exact same stored cluster connection info, all of them fail identically and simultaneously the moment the old CA stops matching what the API server actually presents - while Applications targeting the main cluster, which uses a completely separate cluster Secret, are unaffected.",
    },
    {
      id: "analytics-cluster-down",
      label: "The analytics cluster's API server is down.",
      explanation:
        "A down API server would produce a connection-refused or timeout error, not a certificate verification failure - the error here shows ArgoCD is successfully reaching the API server and receiving a certificate from it, it just no longer trusts the CA that signed it.",
    },
    {
      id: "individual-app-rbac-revoked",
      label: "RBAC for the ArgoCD service account on the analytics cluster was revoked.",
      explanation:
        "An RBAC/authorization failure happens after a successful, trusted TLS connection is established - this error occurs during the TLS handshake itself, before any authorization check could even take place.",
    },
    {
      id: "coincidental-manifest-changes",
      label: "Multiple Applications happened to have manifest changes merge around the same time, each with unrelated bugs.",
      explanation:
        "Every affected Application fails with the exact same TLS error, and the affected set corresponds exactly to \"targets the analytics cluster,\" not to any pattern in which Applications happened to have recent commits - the shared, identical error across an entire cluster's worth of Applications is a strong signal of one shared cause, not many coincidental ones.",
    },
  ],
  correctOptionId: "cluster-secret-cadata-stale",
  resolution: `The error - \`x509: certificate signed by unknown authority\` - is a trust
failure during the TLS handshake, not a network, DNS, or authorization
problem: ArgoCD successfully reached the analytics cluster's API server
and received a certificate, it just no longer recognizes the authority
that signed it. \`cluster-cert-notes\` explains why: the analytics cluster's
API server certificate was rotated onto a new CA chain this morning as
part of a scheduled renewal, but ArgoCD's registered-cluster connection
info - stored in a dedicated \`Secret\` labeled
\`argocd.argoproj.io/secret-type: cluster\`, entirely separate from any
Application's own manifests - still has the *old* CA certificate in its
\`caData\` field. Every Application targeting that cluster shares this one
Secret for connection details, so every one of them fails identically the
instant the rotation completes, while Applications targeting the main
cluster (a different Secret entirely) are untouched.

The fix is updating the cluster Secret with the new CA data, either by
re-running \`argocd cluster add\` for that cluster or updating the Secret
directly:

\`\`\`bash
kubectl patch secret analytics-cluster-secret -n argocd \\
  --type merge \\
  -p '{"data":{"config":"<base64 of updated JSON with new caData>"}}'
\`\`\`

Any process that rotates a target cluster's API server certificate needs
to include updating every tool that independently stores a trust
relationship to that cluster - ArgoCD's cluster registration is exactly
that kind of out-of-band trust store, easy to forget precisely because it
isn't part of the cluster itself or any Application's git-tracked
manifests.`,
};
