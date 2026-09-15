import type { Scenario } from "./types";

export const theRotatedCertNobodyTrusted: Scenario = {
  id: "the-rotated-cert-nobody-trusted",
  title: "The Rotated Cert Nobody Trusted",
  subtitle: "the mesh CA rotated cleanly for everyone except one stubborn pod",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["istio", "mtls", "certificate-rotation"],
  briefing: `The service mesh's root certificate authority was rotated last night as
part of a routine, scheduled renewal - every service reloaded its sidecar
certificates automatically and traffic kept flowing without a blip.
Except "ledger-writer," which has been failing every single call to
"payments-core" with a TLS handshake error since almost exactly the
rotation window, even though ledger-writer's own sidecar shows itself as
healthy and running.`,
  constraints: [
    "Every other service in the mesh, including several also calling payments-core, is completely unaffected by the rotation.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ledger-writer", namespace: "ledger2", labels: { app: "ledger-writer" } },
        spec: { replicas: 2, template: { metadata: { annotations: { "sidecar.istio.io/inject": "true" } } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "300d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ledger-writer-8t9u0v-w1x2y", namespace: "ledger2", labels: { app: "ledger-writer" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "ledger-writer", ready: true, restartCount: 0, state: { running: {} } },
            { name: "istio-proxy", ready: true, restartCount: 0, state: { running: {} } },
          ],
        },
        logs: {
          "istio-proxy": [
            "2026-09-15T02:15:04.220Z warning envoy config StreamSecrets gRPC config stream to xds-agent closed since 6h51m45.221928988s ago",
            "2026-09-15T02:15:04.221Z warning envoy connection TLS error: 268435703:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED, peer cert issued by unknown/expired root",
          ],
        },
        age: "300d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "mesh-ca-rotation-notes", namespace: "ledger2" },
        spec: {
          data: {
            "notes.md":
              "The mesh's root CA rotation is normally pulled automatically by every\nsidecar's SDS (Secret Discovery Service) agent maintaining a live gRPC\nstream to the mesh control plane, refreshing certificates without any\nrestart needed. ledger-writer's istio-proxy sidecar shows its SDS\nconfig stream to the control plane has been disconnected for roughly\n6h51m - well before the rotation happened - due to an unrelated network\nblip that was never noticed or alerted on, since the sidecar kept\nserving traffic fine on its *still-valid-at-the-time* old certificate\nright up until the root CA actually rotated. Once the new root was\nactivated mesh-wide, ledger-writer's sidecar - never having reconnected\nto refresh its trust bundle - was left holding a stale certificate\nsigned by (and configured to trust) the now-retired root, causing every\npeer's TLS verification of it, and its own verification of every peer,\nto fail.\n",
          },
        },
        age: "300d",
      },
    ],
  },
  hints: [
    "`kubectl logs ledger-writer-8t9u0v-w1x2y -n ledger2 -c istio-proxy` - is there anything about the sidecar's connection to the mesh control plane, separate from the TLS error itself?",
    "The SDS stream disconnect timestamp (roughly 6h51m before the log line) predates the CA rotation - what would happen to a sidecar that stopped receiving certificate updates well before a rotation, once that rotation actually happens?",
    "`kubectl get configmap mesh-ca-rotation-notes -n ledger2 -o yaml` - every other service reconnects and refreshes automatically; what's specifically different about this one pod's sidecar?",
  ],
  options: [
    {
      id: "sds-stream-disconnected-before-rotation-stale-trust-bundle",
      label:
        "ledger-writer's istio-proxy sidecar had its SDS connection to the mesh control plane silently disconnected almost 7 hours before the CA rotation, due to an unrelated network blip that went unnoticed (it kept working fine on its still-valid old certificate right up until the rotation) - once the new root CA activated mesh-wide, this one sidecar never received the update and kept both presenting and trusting certificates tied to the now-retired root, causing TLS verification to fail on every call while every properly-connected sidecar elsewhere rotated seamlessly.",
      explanation:
        "istio-proxy's own logs show the SDS config stream disconnected roughly 6h51m before the failure - which lines up with well before the rotation actually happened, not at the moment of the failure itself. `mesh-ca-rotation-notes` explains exactly why this went unnoticed: the stale certificate kept working right up until the root CA rotation, since it was still valid until that point, then failed the instant the new root activated and this sidecar was the one that never got the memo. Every other service, whose SDS streams stayed connected, refreshed automatically and was unaffected.",
    },
    {
      id: "payments-core-mtls-misconfigured",
      label: "payments-core's own PeerAuthentication policy was misconfigured during the rotation.",
      explanation:
        "Every other service calling payments-core is confirmed completely unaffected by the rotation - if payments-core's own mTLS policy were the problem, it would affect every caller uniformly, not be isolated to one specific caller's sidecar.",
    },
    {
      id: "ledger-writer-app-restart-needed",
      label: "ledger-writer's application container itself needs a restart to pick up the new certificate.",
      explanation:
        "Certificate management in this mesh happens entirely within the istio-proxy sidecar container via SDS - the application container has no involvement in or awareness of certificate rotation at all, so restarting it wouldn't address a sidecar-level SDS connectivity issue.",
    },
    {
      id: "clock-skew-between-nodes",
      label: "Clock skew between ledger-writer's node and the mesh control plane is causing certificate validation to fail.",
      explanation:
        "The TLS error explicitly cites a certificate \"issued by unknown/expired root\" - a trust/chain-of-issuance failure, not a validity-window (not-yet-valid or expired-by-date) failure that clock skew would typically produce. The sidecar's own logs point specifically at a stale SDS connection, not a time synchronization problem.",
    },
  ],
  correctOptionId: "sds-stream-disconnected-before-rotation-stale-trust-bundle",
  resolution: `istio-proxy's own logs on the affected pod show its SDS (Secret Discovery
Service) gRPC stream to the mesh control plane had been disconnected for
roughly 6 hours and 51 minutes at the time of the failure - which,
working backward, puts the actual disconnection well *before* the CA
rotation happened, not at the moment things broke. \`mesh-ca-rotation-
notes\` explains why nobody noticed: the sidecar's existing certificate
was still valid right up until the rotation, so it kept serving and
verifying traffic completely normally on its old, still-trusted
certificate the entire time it was silently disconnected. The moment the
new root CA activated mesh-wide, every properly-connected sidecar
refreshed its trust bundle automatically and kept working - but this one
sidecar, never having reconnected, kept both presenting a certificate
signed by the now-retired root and trusting only that old root for
verifying peers, so every TLS handshake it's party to fails.

There's no live fix available from a read-only console beyond noting
that a sidecar restart would force it to re-establish its SDS stream and
fetch current certificates - which is exactly the underlying fix:

\`\`\`bash
kubectl delete pod ledger-writer-8t9u0v-w1x2y -n ledger2
# the replacement pod's istio-proxy establishes a fresh SDS
# connection and pulls the current, post-rotation trust bundle
\`\`\`

The deeper gap worth flagging to the team is observability: an SDS
stream disconnect had zero visible impact for nearly 7 hours precisely
*because* the old certificate kept working, which means this kind of
silent staleness has no natural trigger to surface until the next
rotation exposes it. Alerting directly on sidecar SDS connection health
(rather than only on certificate validity or traffic errors) would catch
this class of issue well before it turns into an outage.`,
};
