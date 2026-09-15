import type { Scenario } from "./types";

export const defaultDenyBlocksDnsEgress: Scenario = {
  id: "default-deny-blocks-dns-egress",
  title: "Default Deny Blocks DNS Egress",
  subtitle: "checkout-worker can't resolve anything, not even other services in the cluster",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["networkpolicy", "dns", "egress"],
  briefing: `Security just rolled out a baseline "default deny all egress" NetworkPolicy
across the "checkout" namespace as part of a hardening pass. Within minutes,
"checkout-worker" started failing every outbound call - not just to external
payment providers, but to other services inside the cluster too. Nothing it
tries to reach responds.`,
  constraints: [
    "The Services and Pods checkout-worker is trying to reach are all confirmed healthy and reachable from other namespaces.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-worker", namespace: "checkout", labels: { app: "checkout-worker" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "18m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-worker-6d8f9c-x2p4q", namespace: "checkout", labels: { app: "checkout-worker" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-worker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-worker": [
            "2026-09-15T10:01:02.331Z ERROR c.e.checkout.PaymentClient - java.net.UnknownHostException: payments.internal.svc.cluster.local",
            "2026-09-15T10:01:14.902Z ERROR c.e.checkout.InventoryClient - java.net.UnknownHostException: inventory.catalog.svc.cluster.local",
            "2026-09-15T10:01:14.903Z WARN  c.e.checkout.InventoryClient - retrying DNS resolution in 5s",
          ],
        },
        age: "18m",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "default-deny-egress", namespace: "checkout", labels: { "policy-baseline": "true" } },
        spec: {
          podSelector: {},
          policyTypes: ["Egress"],
          egress: [],
        },
        age: "20m",
        events: [
          { type: "Normal", reason: "PolicyApplied", age: "20m", message: "NetworkPolicy default-deny-egress applied to namespace checkout" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "kube-dns", namespace: "kube-system", labels: { "k8s-app": "kube-dns" } },
        spec: { clusterIP: "10.96.0.10", ports: [{ name: "dns", port: 53, protocol: "UDP" }, { name: "dns-tcp", port: 53, protocol: "TCP" }] },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get networkpolicy -n checkout -o yaml` - what changed in this namespace right before the failures started?",
    "The policy has `policyTypes: [Egress]` and an empty `egress: []` list. What does an empty egress rule list mean for a pod selected by this policy?",
    "DNS resolution itself happens over the network too - UDP/TCP port 53 to kube-dns. A default-deny egress policy with no explicit allow rules blocks that just like any other outbound traffic.",
  ],
  options: [
    {
      id: "default-deny-egress-blocks-dns",
      label:
        "The new `default-deny-egress` NetworkPolicy selects all pods in the namespace and has an empty `egress: []` list, which blocks all outbound traffic including DNS lookups to kube-dns on port 53 - checkout-worker can't resolve any hostname, internal or external, because the policy never carved out an exception for DNS.",
      explanation:
        "The NetworkPolicy's `podSelector: {}` matches every pod in the namespace, `policyTypes: [Egress]` puts it in effect for outbound traffic, and an empty `egress: []` list means zero allowed destinations - including kube-dns itself. checkout-worker's logs show `UnknownHostException` for both an internal and external-facing hostname, exactly the symptom of DNS queries never leaving the pod at all, and the timing lines up exactly with the policy's rollout.",
    },
    {
      id: "coredns-pods-down",
      label: "The CoreDNS pods themselves are down or crashing.",
      explanation:
        "The kube-dns Service is present and healthy, and other namespaces are unaffected - if CoreDNS itself were down, every namespace in the cluster would see resolution failures, not just the one that just received a new NetworkPolicy.",
    },
    {
      id: "checkout-worker-dns-config-bad",
      label: "checkout-worker's pod spec has a broken `dnsConfig` pointing at the wrong resolver.",
      explanation:
        "There's no evidence of a custom `dnsConfig` on the deployment, and the failure started at the exact moment the new NetworkPolicy was applied, not at the pod's last deploy - a resolver misconfiguration wouldn't coincide with a NetworkPolicy rollout.",
    },
    {
      id: "target-services-actually-down",
      label: "The payments and inventory Services checkout-worker is calling are actually down.",
      explanation:
        "Both target Services are confirmed healthy and reachable from other namespaces. The error is `UnknownHostException` - a DNS resolution failure that happens before any connection to the target service is even attempted, not a connection or application-level failure on the target's end.",
    },
  ],
  correctOptionId: "default-deny-egress-blocks-dns",
  resolution: `The new \`default-deny-egress\` NetworkPolicy selects every pod in the
\`checkout\` namespace (\`podSelector: {}\`) and, with an empty \`egress: []\`
list, permits zero outbound destinations - a common "secure by default"
baseline that forgets DNS is itself network traffic. checkout-worker's
logs show \`UnknownHostException\` for both an internal cluster-local name
and an external one, which is exactly what happens when a pod's DNS
queries to kube-dns on port 53 never leave the pod at all.

The fix is adding an explicit egress allow rule for DNS before (or
alongside) any other locked-down policy:

\`\`\`yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: checkout
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
\`\`\`

Any namespace-wide default-deny egress policy needs a DNS allow rule as
step zero - without it, nothing in the namespace can resolve a hostname
at all, regardless of what other egress rules get added later for
specific services.`,
};
