import type { Scenario } from "../types";

export const securityGroupAllowsButNetpolBlocks: Scenario = {
  id: "security-group-allows-but-netpol-blocks",
  title: "The Security Group Said Yes. Kubernetes Said No.",
  subtitle: "the cloud console shows the traffic is allowed. it never arrives anyway.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["networkpolicy", "security-group", "layered-networking"],
  briefing: `A new managed database proxy sidecar was added to "reporting-etl" to
reach an external data warehouse, and the cloud security group was
carefully updated and confirmed to allow the necessary outbound traffic.
Every connection attempt still times out. Nobody on the infra team can
find anything wrong at the cloud networking layer - the security group
rule is exactly right.`,
  constraints: [
    "The cloud security group attached to the node pool is confirmed, via the cloud console, to allow outbound HTTPS traffic to the data warehouse's IP range.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "reporting-etl", namespace: "reporting3", labels: { app: "reporting-etl" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "reporting-etl-4l5m6n-o7p8q", namespace: "reporting3", labels: { app: "reporting-etl" } },
        status: { phase: "Running", containerStatuses: [{ name: "reporting-etl", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "reporting-etl": [
            "2026-09-15T10:40:01.020Z ERROR c.e.reporting.WarehouseClient - connect timed out: warehouse-proxy.example.net:5439",
          ],
        },
        age: "30m",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "reporting3-default-deny", namespace: "reporting3", labels: { "policy-baseline": "true" } },
        spec: {
          podSelector: {},
          policyTypes: ["Egress"],
          egress: [
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }] },
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "networking-layers-notes", namespace: "reporting3" },
        spec: {
          data: {
            "notes.md":
              "This cluster's network path for pod egress goes: pod -> CNI-enforced\nNetworkPolicy -> node's own network interface -> cloud security group\n-> internet. Both a NetworkPolicy and a cloud security group have to\nindependently allow a given flow for it to succeed - they're enforced at\ncompletely different layers by completely different systems, and neither\nis aware of the other. The `reporting3` namespace has had a default-deny\negress NetworkPolicy in place for a year, with only a DNS allow rule -\nnobody added a new egress rule for the new database proxy sidecar's\ntraffic when it was introduced 30 minutes ago, even though the security\ngroup update for the exact same traffic was completed and verified\ncorrectly.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "The cloud security group is confirmed correct - so where else, closer to the pod itself, could this traffic still be getting blocked?",
    "`kubectl get networkpolicy -n reporting3 -o yaml` - is there a default-deny egress policy in this namespace? Does it have a rule covering traffic to the new data warehouse?",
    "`kubectl get configmap networking-layers-notes -n reporting3 -o yaml` - a security group and a Kubernetes NetworkPolicy are two entirely separate, independently-enforced layers; fixing one says nothing about the other.",
  ],
  options: [
    {
      id: "netpol-default-deny-missing-new-rule",
      label:
        "The `reporting3` namespace has a year-old default-deny egress NetworkPolicy with only a DNS allow rule - nobody added a new egress rule for the data warehouse traffic when the new database proxy sidecar was introduced; the cloud security group update was correct and necessary but not sufficient, since traffic has to independently pass both the NetworkPolicy (enforced by the CNI, closer to the pod) and the security group (enforced by the cloud, further downstream) - the NetworkPolicy is dropping the traffic before it ever reaches the point the security group would even evaluate it.",
      explanation:
        "`networking-layers-notes` states the two-layer requirement explicitly: both the NetworkPolicy and the security group have to independently allow a flow. The `reporting3-default-deny` NetworkPolicy has been active for a year with only a DNS egress rule - nothing covering the new warehouse proxy traffic, which was only introduced 30 minutes ago alongside the (correctly updated) security group. The security group being right doesn't help if the NetworkPolicy, enforced earlier in the path, drops the packet before it ever reaches the node's network interface.",
    },
    {
      id: "security-group-rule-not-fully-propagated",
      label: "The security group rule update hasn't fully propagated to all nodes yet.",
      explanation:
        "The security group is confirmed correct and verified via the cloud console - propagation delay isn't indicated, and even if it were, that wouldn't explain a connection that's been failing continuously for the full 30 minutes since the sidecar was added, well past any reasonable propagation window.",
    },
    {
      id: "warehouse-proxy-dns-not-resolving",
      label: "warehouse-proxy.example.net isn't resolving correctly.",
      explanation:
        "The failure is a connection timeout to an already-resolved hostname (`warehouse-proxy.example.net:5439`), not a DNS resolution failure - and the NetworkPolicy's existing DNS egress rule to kube-system would allow that lookup to succeed regardless, which is consistent with the connection attempt clearly being made against a real, resolved address.",
    },
    {
      id: "database-proxy-sidecar-misconfigured",
      label: "The new database proxy sidecar itself is misconfigured and not actually attempting to connect.",
      explanation:
        "reporting-etl's own logs show an active, explicit connection attempt against the correct hostname and port, timing out - the sidecar (or the client using it) is genuinely trying to connect; the failure is happening somewhere in the network path between the pod and its destination, not in whether an attempt is being made at all.",
    },
  ],
  correctOptionId: "netpol-default-deny-missing-new-rule",
  resolution: `\`networking-layers-notes\` lays out the two independent enforcement layers
in play: a NetworkPolicy, enforced by the CNI right at the pod, and a
cloud security group, enforced much further downstream at the cloud
network edge - both have to separately allow a given flow, and neither
has any awareness of the other. The security group update for the new
database proxy traffic was done correctly and thoroughly verified. But
\`reporting3\`'s year-old default-deny egress NetworkPolicy only ever had a
DNS allow rule; nobody added a rule permitting egress to the data
warehouse when the new sidecar was introduced 30 minutes ago. The
NetworkPolicy drops the traffic right at the pod, long before it would
ever reach the node's network interface (let alone the security group) -
so no amount of cloud-side correctness can compensate for the missing
in-cluster rule.

The fix is adding the missing egress rule to the NetworkPolicy, matching
what the security group already permits:

\`\`\`yaml
spec:
  egress:
    - to:
        - ipBlock:
            cidr: 203.0.113.0/24   # data warehouse's address range
      ports:
        - port: 5439
          protocol: TCP
\`\`\`

Whenever a new egress dependency is introduced, both layers need an
explicit update in the same change - a cloud security group rule and a
Kubernetes NetworkPolicy rule are never substitutes for each other, and
verifying one is correct says nothing about whether the other was ever
touched at all.`,
};
