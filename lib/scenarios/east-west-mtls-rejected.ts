import type { Scenario } from "./types";

export const eastWestMtlsRejected: Scenario = {
  id: "east-west-mtls-rejected",
  title: "East-West mTLS Rejected",
  subtitle: "the new inventory-sync job can't reach warehouse-api, ever",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["istio", "mtls", "service-mesh"],
  briefing: `A new batch job, "inventory-sync," was just deployed as a plain VM-based
process outside the Kubernetes cluster (an existing legacy host that
isn't going away soon) to call "warehouse-api" inside the mesh. Every
single call gets an immediate connection reset - not a timeout, an
instant reset.`,
  constraints: [
    "Every in-mesh service that calls warehouse-api works perfectly - this is isolated to the one caller that lives outside the mesh.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "warehouse-api", namespace: "warehouse", labels: { app: "warehouse-api" } },
        spec: { replicas: 3, template: { metadata: { annotations: { "sidecar.istio.io/inject": "true" } } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "mesh-mtls-notes", namespace: "warehouse" },
        spec: {
          data: {
            "notes.md":
              "The `warehouse` namespace has a `PeerAuthentication` set to `STRICT`\nmTLS - every pod's Envoy sidecar requires the *caller* to present a\nvalid mesh-issued client certificate for any inbound connection.\nIn-mesh callers get this automatically and transparently from their own\nsidecar. `inventory-sync` runs on a legacy VM outside the Kubernetes\ncluster entirely - it has no sidecar, no mesh identity, and connects\ndirectly over plain TCP/TLS with a normal HTTP client, the same way it\ntalks to every other internal service it's ever integrated with.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap mesh-mtls-notes -n warehouse -o yaml` - what does `STRICT` mTLS actually require of anything connecting inbound to a pod in this namespace?",
    "A workload's sidecar proxy automatically handles presenting a mesh identity/certificate on outbound calls to other meshed services - what happens for a caller that has no sidecar at all?",
    "An instant connection reset (not a timeout, not a slow failure) during a TLS handshake is a strong signal of the receiving side actively rejecting the connection for a specific reason, rather than the request simply not reaching anything.",
  ],
  options: [
    {
      id: "vm-caller-has-no-mesh-identity",
      label:
        "warehouse-api's namespace enforces STRICT mTLS, which requires every inbound connection to present a valid mesh-issued client certificate - in-mesh callers get this automatically from their own sidecar, but inventory-sync runs on a legacy VM outside the mesh entirely with no sidecar and no mesh identity, so its plain connection attempt is rejected outright by warehouse-api's sidecar during the TLS handshake, every single time.",
      explanation:
        "`mesh-mtls-notes` confirms STRICT mTLS requires a valid client certificate from the mesh's own CA for any inbound connection, and that inventory-sync, running outside the Kubernetes cluster on a legacy VM, has no sidecar to provide one - it connects the same plain way it always has to every other internal service. Every in-mesh caller works fine because their own sidecars handle mTLS transparently and automatically; inventory-sync has no equivalent mechanism at all. An immediate connection reset during the handshake, rather than a timeout, is exactly what a TLS-level rejection for an untrusted/absent client certificate looks like.",
    },
    {
      id: "warehouse-api-firewall-blocking-external-ip",
      label: "A network firewall rule is blocking traffic from the VM's external IP address.",
      explanation:
        "If a network-layer firewall were blocking the traffic outright, connections would typically time out or be dropped silently rather than producing an immediate, active TCP reset - a reset specifically suggests something at the receiving host actively rejected the connection attempt, consistent with a TLS/certificate-based rejection rather than a packet-filtering block.",
    },
    {
      id: "warehouse-api-dns-not-resolving-externally",
      label: "warehouse-api's internal DNS name doesn't resolve from outside the cluster.",
      explanation:
        "A DNS resolution failure would prevent a connection attempt from being made at all (an unknown-host error on the client side), not produce a TCP-level reset during what would have to be an established connection attempt - the client is clearly reaching and connecting to something, then getting rejected.",
    },
    {
      id: "warehouse-api-rate-limiting-new-clients",
      label: "warehouse-api is rate-limiting requests from a caller it hasn't seen before.",
      explanation:
        "Rate limiting typically produces an HTTP-level rejection (a 429 response) after a successful connection and request, not an immediate reset during the connection/handshake itself - this failure is happening at a lower level than anything that would require the request to be processed first.",
    },
  ],
  correctOptionId: "vm-caller-has-no-mesh-identity",
  resolution: `\`mesh-mtls-notes\` explains the mismatch directly: the \`warehouse\`
namespace enforces \`STRICT\` mTLS, meaning every pod's sidecar requires
whoever's connecting inbound to present a valid certificate issued by the
mesh's own certificate authority. Every in-mesh caller gets this for
free and automatically - their own sidecar handles presenting the right
certificate on every outbound call without the application code ever
knowing mTLS is involved. \`inventory-sync\`, running on a legacy VM
outside the Kubernetes cluster, has no sidecar and no mesh identity at
all; it's making a plain connection the same way it always has to every
other internal service it talks to. warehouse-api's sidecar sees a
connection attempt with no valid mesh certificate and rejects it
immediately during the TLS handshake - which is exactly what an instant
reset (rather than a timeout or an HTTP-level error) indicates.

There are two standard ways to bring a legitimate external caller into a
STRICT-mTLS mesh, and the right one depends on how long the VM is
sticking around:

\`\`\`yaml
# Option 1: scope STRICT down to PERMISSIVE for just this workload,
# accepting both plaintext and mTLS, as a transitional measure
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: warehouse-api-permissive
  namespace: warehouse
spec:
  selector:
    matchLabels: { app: warehouse-api }
  mtls:
    mode: PERMISSIVE
\`\`\`

or, more durably, issue \`inventory-sync\` a workload identity/certificate
through the mesh's own certificate authority (most meshes support
onboarding external workloads this way) so it can participate in mTLS
properly rather than being exempted from it. \`PERMISSIVE\` mode is a
reasonable stopgap but does weaken the guarantee STRICT mode was added
for - worth treating as temporary while the VM is migrated into the mesh
or replaced.`,
};
