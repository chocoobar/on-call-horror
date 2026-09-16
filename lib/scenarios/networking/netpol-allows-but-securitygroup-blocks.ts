import type { Scenario } from "../types";

export const netpolAllowsButSecuritygroupBlocks: Scenario = {
  id: "netpol-allows-but-securitygroup-blocks",
  title: "Kubernetes Said Yes. The Cloud Said No.",
  subtitle: "the NetworkPolicy is exactly right. traffic still dies somewhere past the node.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["networkpolicy", "security-group", "layered-networking"],
  briefing: `"vendor-sync" was granted a new, carefully-scoped NetworkPolicy egress
rule to reach a vendor's API after a security review, replacing an older,
broader rule. Every call to the vendor still times out. The NetworkPolicy
was double- and triple-checked and is confirmed to allow exactly this
traffic.`,
  constraints: [
    "The new NetworkPolicy egress rule is confirmed, by direct inspection, to correctly allow traffic to the vendor's exact IP range and port.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "vendor-sync", namespace: "integrations2", labels: { app: "vendor-sync" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "vendor-sync-5r6s7t-u8v9w", namespace: "integrations2", labels: { app: "vendor-sync" } },
        status: { phase: "Running", containerStatuses: [{ name: "vendor-sync", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "vendor-sync": [
            "2026-09-15T15:10:01.030Z ERROR c.e.integrations.VendorApiClient - connect timed out: api.vendorcorp.net:443 (192.0.2.44)",
          ],
        },
        age: "1h",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "vendor-sync-egress", namespace: "integrations2" },
        spec: {
          podSelector: { matchLabels: { app: "vendor-sync" } },
          policyTypes: ["Egress"],
          egress: [
            { to: [{ ipBlock: { cidr: "192.0.2.44/32" } }], ports: [{ port: 443, protocol: "TCP" }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }] },
          ],
        },
        age: "50m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cloud-security-audit-notes", namespace: "integrations2" },
        spec: {
          data: {
            "notes.md":
              "A separate, cloud-level security review was underway on this same\nnode pool's outbound security group rules this week, unrelated to the\nvendor-sync NetworkPolicy change but scheduled for the same day. As\npart of that review, an overly broad `0.0.0.0/0` outbound allow rule was\nintentionally removed and replaced with a narrower allow-list -\nhowever, the vendor's IP range, `192.0.2.0/24`, was not yet on that\nallow-list at the time of removal, since the vendor-sync team's own\nrequest for that specific range hadn't been cross-referenced against the\nsecurity group review's own tracking ticket. The security group's\ncurrent outbound rules permit traffic only to a specific, different set\nof ranges that doesn't include the vendor's.\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "The NetworkPolicy is confirmed correct - so if traffic is still being blocked, where else, further along the path, could it be dropped?",
    "`kubectl get configmap cloud-security-audit-notes -n integrations2 -o yaml` - was anything else changed around the cloud network layer recently, independent of the NetworkPolicy work?",
    "A Kubernetes NetworkPolicy and a cloud security group are two separate, independently-enforced gates on the same traffic - one being correctly configured says nothing about the other.",
  ],
  options: [
    {
      id: "security-group-review-removed-broad-rule-without-vendor-ip",
      label:
        "A separate, unrelated cloud security group review this week removed an overly broad `0.0.0.0/0` outbound rule and replaced it with a narrower allow-list - but the vendor's IP range was never added to that new allow-list, since the two changes (the NetworkPolicy update and the security group review) weren't cross-referenced against each other; the NetworkPolicy correctly allows the traffic to leave the pod, but the security group, evaluated later in the path, now blocks it at the cloud network edge instead.",
      explanation:
        "`cloud-security-audit-notes` confirms a security group review happened the same week, removing a broad allow-all rule and replacing it with a narrower list that doesn't yet include the vendor's range - and confirms this wasn't cross-referenced against the vendor-sync team's own NetworkPolicy request. Since the NetworkPolicy egress rule is independently verified correct, and traffic still fails, the block has to be happening at a different, later layer - exactly matching a security group tightened without the needed exception ever being added.",
    },
    {
      id: "vendor-changed-their-ip-recently",
      label: "The vendor changed their API's IP address recently, and the NetworkPolicy is pinned to a stale one.",
      explanation:
        "vendor-sync's own logs show it connecting to `192.0.2.44`, the exact same IP the NetworkPolicy's `ipBlock` allows - there's no mismatch between the resolved address and the policy's allowed range, which rules out a stale-IP explanation for this specific failure.",
    },
    {
      id: "dns-egress-rule-insufficient",
      label: "The NetworkPolicy's DNS egress rule doesn't cover the lookup needed for this vendor's hostname.",
      explanation:
        "vendor-sync's log shows it already has the correct resolved IP for the vendor's hostname and is attempting an actual connection to it - DNS resolution has already succeeded by the time the connection timeout occurs, so a DNS-layer gap in the policy isn't what's blocking this traffic.",
    },
    {
      id: "vendor-sync-pod-not-matching-netpol-selector",
      label: "vendor-sync's pods don't actually match the NetworkPolicy's `podSelector`.",
      explanation:
        "The NetworkPolicy's `podSelector` (`app: vendor-sync`) matches the Deployment's pod label exactly, and the policy is independently confirmed, by direct inspection, to be correctly allowing this exact traffic - the gap has to be somewhere else in the path, not in whether the policy applies to these pods at all.",
    },
  ],
  correctOptionId: "security-group-review-removed-broad-rule-without-vendor-ip",
  resolution: `\`cloud-security-audit-notes\` reveals the real cause: a separate, unrelated
cloud security group review, running the same week as the vendor-sync
NetworkPolicy change, replaced a broad \`0.0.0.0/0\` outbound allow rule
with a narrower allow-list - and the vendor's IP range was never added
to it, since the two changes were never cross-referenced against each
other. The NetworkPolicy egress rule is independently confirmed correct
and does its job, letting traffic leave the pod cleanly toward the
vendor's IP - but the cloud security group, evaluated later in the
outbound path, now blocks that same traffic at the cloud network edge,
since its own allow-list doesn't include this vendor's range at all.

The fix is adding the vendor's range to the security group's own
allow-list, matching what the NetworkPolicy already permits:

\`\`\`bash
aws ec2 authorize-security-group-egress \\
  --group-id sg-0abc123 \\
  --protocol tcp --port 443 \\
  --cidr 192.0.2.0/24
\`\`\`

As with the reverse case (a permissive security group paired with a
missing NetworkPolicy rule), the fix here isn't in the layer that was
already carefully reviewed - it's in the *other* layer that nobody
thought to check because the first one looked airtight. Any two
independent changes touching related but separately-enforced network
controls, even when scheduled coincidentally in the same week, are worth
explicitly cross-referencing against each other before either is
considered "done."`,
};
