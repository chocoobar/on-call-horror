import type { Scenario } from "./types";

export const theCertRotationDropout: Scenario = {
  id: "the-cert-rotation-dropout",
  title: "The Cert Rotation Dropout",
  subtitle: "worker-node-31 vanished from `kubectl get nodes` overnight, no drain, no maintenance",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "kubelet", "certificates"],
  briefing: `"worker-node-31" was healthy and running workloads normally at midnight.
By 6 AM its pods had been rescheduled elsewhere and the node itself shows
NotReady. Nobody drained it, no cloud provider maintenance event fired,
and the underlying VM is confirmed still running and reachable over SSH.`,
  constraints: [
    "The underlying virtual machine is confirmed up, reachable, and not resource-starved - this isn't a hardware or VM-level failure.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "worker-node-31", labels: { "kubernetes.io/hostname": "worker-node-31" } },
        status: {
          conditions: [
            { type: "Ready", status: "Unknown" },
          ],
        },
        events: [
          { type: "Warning", reason: "NodeNotReady", age: "5h", message: "Node worker-node-31 status is now: NodeNotReady" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "worker-node-31-ssh-diagnostics", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "SSH investigation on worker-node-31 found the kubelet process itself\nrunning, but its logs are flooded since 00:03 with:\n\n  E0915 00:03:12 kubelet.go:2426 \"Failed to connect to apiserver\" err=\"x509: certificate has expired or is not yet valid\"\n\nThis node's kubelet was bootstrapped 1 year ago (node's own age) with a\nclient certificate issued for exactly 365 days, and this cluster does\nnot have kubelet client-certificate rotation (`RotateKubeletClientCertificate`)\nenabled - a feature that, when on, automatically requests a new\ncertificate well before the old one expires. Every other node was\nbootstrapped at different times over the cluster's life and will hit\nthe exact same wall on its own one-year anniversary.\n",
          },
        },
        age: "5h",
      },
    ],
  },
  hints: [
    "The node's own `Ready` condition is `Unknown`, not `False` - that specific distinction usually means the control plane has stopped hearing from the kubelet at all, not that the kubelet reported itself unhealthy.",
    "SSH onto the node (conceptually) - is the kubelet process itself even running, and if so, what is it actually logging?",
    "`kubectl get configmap worker-node-31-ssh-diagnostics -n kube-system -o yaml` - what specific error is the kubelet hitting when it tries to talk to the API server, and what's this node's age?",
  ],
  options: [
    {
      id: "kubelet-client-cert-expired-no-rotation",
      label:
        "worker-node-31's kubelet client certificate, issued for exactly 365 days when the node was bootstrapped a year ago, expired - and because this cluster doesn't have `RotateKubeletClientCertificate` enabled to renew it automatically ahead of time, the kubelet can no longer authenticate to the API server at all (`x509: certificate has expired`), which the control plane sees as the node simply going silent (`Ready: Unknown`), even though the kubelet process and the underlying VM are both still running fine.",
      explanation:
        "`worker-node-31-ssh-diagnostics` shows the exact kubelet error: an `x509: certificate has expired` failure trying to reach the API server, starting at 00:03 - matching the node's own one-year age precisely, since its client cert was issued for exactly 365 days with no rotation feature enabled to renew it beforehand. The node's `Ready` condition showing `Unknown` (not `False`) is the specific signature of the control plane losing contact with a kubelet entirely, rather than the kubelet self-reporting unhealthy - consistent with an authentication failure preventing it from even checking in, while SSH confirms the VM and process are both actually fine.",
    },
    {
      id: "node-hardware-vm-failure",
      label: "The underlying VM or hardware for worker-node-31 failed.",
      explanation:
        "The scenario explicitly confirms the VM is up, reachable, and not resource-starved - SSH access and process inspection both work fine. The failure is specific to the kubelet's ability to authenticate to the API server, not the health of the machine it's running on.",
    },
    {
      id: "network-partition-to-apiserver",
      label: "A network partition is preventing worker-node-31 from reaching the API server.",
      explanation:
        "The kubelet's own logs show it successfully *reaching* the API server and getting a specific, well-formed TLS rejection (`certificate has expired`) rather than a connection timeout or network-unreachable error - that's evidence of a completed network connection followed by an authentication failure, not a partition preventing connectivity at all.",
    },
    {
      id: "apiserver-itself-down",
      label: "The API server itself is down or overloaded, dropping this node's connection.",
      explanation:
        "If the API server itself were down, it would affect every node's connectivity and every kubectl operation cluster-wide, not just one specific node - the diagnostics point at a certificate-expiry error specific to this one kubelet's identity, not a control-plane-wide outage.",
    },
  ],
  correctOptionId: "kubelet-client-cert-expired-no-rotation",
  resolution: `SSH diagnostics on the node found the smoking gun directly in the
kubelet's own logs: \`x509: certificate has expired or is not yet valid\`,
starting at 00:03 - the exact moment the node's one-year-old client
certificate hit its 365-day expiry. \`worker-node-31-ssh-diagnostics\`
confirms this cluster never enabled \`RotateKubeletClientCertificate\`, the
feature that would have automatically requested a fresh certificate well
ahead of expiry. Without it, the kubelet simply has no valid way to
authenticate to the API server anymore - the process and the VM are both
completely healthy, they just can't prove their identity, which the
control plane experiences as the node going silent (\`Ready: Unknown\`,
the specific signal for "stopped hearing from this kubelet," rather than
"kubelet reported unhealthy").

There's no live fix from this read-only console, but the operational
recovery is a manual kubelet bootstrap/re-registration on the affected
node (re-running the node's join/bootstrap process regenerates a fresh
certificate), or simply replacing the node if it's in an
autoscaled/immutable node pool - often the faster and safer option.

The durable fix is enabling client certificate rotation cluster-wide so
this doesn't recur node by node as each one reaches its own
anniversary:

\`\`\`yaml
# kubelet config on every node
featureGates:
  RotateKubeletClientCertificate: true
serverTLSBootstrap: true
\`\`\`

and auditing every other node's bootstrap date - any node approaching its
own one-year mark without rotation enabled is on the same countdown
worker-node-31 just hit.`,
};
