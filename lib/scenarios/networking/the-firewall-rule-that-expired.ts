import type { Scenario } from "../types";

export const theFirewallRuleThatExpired: Scenario = {
  id: "the-firewall-rule-that-expired",
  title: "The Firewall Rule That Expired",
  subtitle: "a working integration, dead for no reason anyone on the team changed",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["firewall", "cloud", "egress"],
  briefing: `"fraud-check" has called a third-party risk-scoring API successfully for
months. This morning, every call started failing to even establish a
connection. Nobody on the team touched fraud-check, its Deployment, or
any Kubernetes-level networking config recently.`,
  constraints: [
    "The third-party API's own status page shows no incident, and a request from a laptop outside the cluster's cloud network reaches it successfully right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fraud-check", namespace: "risk", labels: { app: "fraud-check" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "220d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "fraud-check-9d8e7f-q3r4s", namespace: "risk", labels: { app: "fraud-check" } },
        status: { phase: "Running", containerStatuses: [{ name: "fraud-check", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "fraud-check": [
            "2026-09-15T06:00:12.201Z ERROR c.e.risk.RiskScoreClient - connect timed out: risk-score-provider.example.net:443",
            "2026-09-15T06:00:44.330Z ERROR c.e.risk.RiskScoreClient - connect timed out: risk-score-provider.example.net:443",
          ],
        },
        age: "220d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cloud-firewall-notes", namespace: "risk" },
        spec: {
          data: {
            "notes.md":
              "A cloud firewall rule, `allow-egress-risk-score-provider`, was created\nseven months ago to allow outbound HTTPS traffic from this node pool to\nthe risk-scoring provider's IP range. At creation time it was given an\noptional expiration timestamp of `2026-09-15T00:00:00Z` as part of a\nnow-abandoned proof-of-concept process that auto-expired temporary\nfirewall rules after 210 days unless manually renewed - nobody\nrealized this rule, despite becoming a permanent production dependency,\nwas ever subject to that expiration. The cloud provider's firewall\nlogs show the rule's status flipped from ACTIVE to EXPIRED at exactly\nthat timestamp, and traffic matching it has been dropped at the network\nedge, silently, ever since.\n",
          },
        },
        age: "220d",
      },
    ],
  },
  hints: [
    "The third-party API is reachable and healthy from outside the cluster's cloud network right now - so what's specific to traffic originating from inside it?",
    "`kubectl get configmap cloud-firewall-notes -n risk -o yaml` - does the egress rule for this specific destination have anything unusual about how it was created?",
    "A firewall rule that was ACTIVE for months and then simply expired at a specific timestamp, with nothing else changed, lines up suspiciously well with a failure that started at that exact time.",
  ],
  options: [
    {
      id: "temporary-firewall-rule-expired",
      label:
        "The cloud firewall rule allowing egress to the risk-scoring provider was created with an expiration timestamp as part of an old proof-of-concept process and flipped from ACTIVE to EXPIRED at exactly the moment the failures started - traffic matching that rule has been silently dropped at the cloud network edge ever since, with nothing inside the cluster (the Deployment, any NetworkPolicy, or the provider itself) having changed at all.",
      explanation:
        "`cloud-firewall-notes` states the exact mechanism and timing: the egress rule was given a 210-day expiration as part of an abandoned proof-of-concept, and the cloud provider's own firewall logs show it flipping to EXPIRED at precisely the timestamp the failures began. The provider itself is confirmed healthy and reachable from outside the cloud network, ruling out anything on their end - the block is happening specifically to traffic originating from inside this cloud network, at the firewall layer, which matches connect timeouts (packets silently dropped) rather than any application- or DNS-level error.",
    },
    {
      id: "risk-provider-ip-changed",
      label: "The risk-scoring provider changed their API's IP address without notice.",
      explanation:
        "A request from outside the cluster's cloud network reaches the provider successfully right now, using the same hostname fraud-check is configured with - if the provider's IP had changed, that external request would need to have picked up the new IP too, which it clearly did without issue.",
    },
    {
      id: "fraud-check-pods-need-restart",
      label: "fraud-check's pods have a stale network configuration and just need to be restarted.",
      explanation:
        "Nothing about fraud-check's own Deployment or pod configuration changed recently, and the failure is a connection-level timeout consistent with packets being dropped somewhere between the cluster and the destination - not a stale in-process configuration issue that a restart would typically resolve.",
    },
    {
      id: "kubernetes-networkpolicy-blocking",
      label: "A new Kubernetes NetworkPolicy is blocking egress to the provider's IP range.",
      explanation:
        "Nobody touched any Kubernetes-level networking configuration recently, and the cloud provider's own firewall logs show the block happening at the cloud network edge, outside the cluster entirely - a NetworkPolicy operates purely within the cluster's own CNI layer and wouldn't be reflected in cloud firewall logs at all.",
    },
  ],
  correctOptionId: "temporary-firewall-rule-expired",
  resolution: `\`cloud-firewall-notes\` pins down both the mechanism and the exact timing:
the egress rule allowing traffic from this node pool to the risk-scoring
provider was created seven months ago with a 210-day expiration
timestamp, as part of a proof-of-concept process for temporary rules that
was later abandoned - without anyone removing the expiration from this
rule, even as it quietly became a permanent production dependency. The
cloud provider's own firewall logs confirm the rule flipped from ACTIVE
to EXPIRED at precisely \`2026-09-15T00:00:00Z\`, the same moment
fraud-check's connect timeouts began. Nothing inside the cluster changed
at all - the block is happening at the cloud network edge, outside
Kubernetes entirely, which is exactly why it doesn't show up as a
NetworkPolicy, DNS, or application-level failure, just a plain connection
timeout.

The fix is recreating the egress rule without an expiration, and
auditing for any other rules still carrying one from that same old
process:

\`\`\`bash
gcloud compute firewall-rules create allow-egress-risk-score-provider \\
  --direction=EGRESS \\
  --destination-ranges=203.0.113.0/24 \\
  --allow=tcp:443 \\
  --target-tags=risk-node-pool
  # (no --expiration flag this time)

gcloud compute firewall-rules list --filter="expirationTimestamp:*"
\`\`\`

A firewall rule created with an expiration for a one-off test is easy to
forget entirely once the thing it enabled quietly becomes permanent
infrastructure - worth a periodic audit for any cloud firewall rule still
carrying an expiration timestamp that production traffic now depends on.`,
};
