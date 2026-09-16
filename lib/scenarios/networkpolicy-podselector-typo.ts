import type { Scenario } from "./types";

export const networkpolicyPodselectorTypo: Scenario = {
  id: "networkpolicy-podselector-typo",
  title: "The Policy That Selected The Wrong Pods",
  subtitle: "a NetworkPolicy meant to lock down one deployment quietly locked down a completely different one",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["networkpolicy", "labels", "ingress-rule"],
  briefing: `Security added a new NetworkPolicy in the "reporting" namespace meant to
restrict inbound access to "internal-dashboards" so only the VPN gateway
pod can reach it. Right after it was applied, an unrelated service in the
same namespace, "export-scheduler," started getting connection refused
from every caller - including its own health checks.`,
  constraints: [
    "internal-dashboards, the intended target of the new policy, is completely unaffected and working exactly as intended.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "internal-dashboards", namespace: "reporting", labels: { app: "internal-dashboards" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "export-scheduler", namespace: "reporting", labels: { app: "export-scheduler" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "300d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "export-scheduler-6a7b8c-m1n2o", namespace: "reporting", labels: { app: "export-scheduler" } },
        status: { phase: "Running", containerStatuses: [{ name: "export-scheduler", ready: false, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "6m", message: "Readiness probe failed: Get \"http://10.244.4.12:8080/healthz\": dial tcp 10.244.4.12:8080: connect: connection refused" },
        ],
        age: "300d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "restrict-dashboards", namespace: "reporting" },
        spec: {
          podSelector: { matchLabels: { app: "internal-dashboard" } },
          policyTypes: ["Ingress"],
          ingress: [{ from: [{ podSelector: { matchLabels: { app: "vpn-gateway" } } }] }],
        },
        age: "7m",
      },
    ],
  },
  hints: [
    "`kubectl get networkpolicy restrict-dashboards -n reporting -o yaml` - what does `spec.podSelector` actually say, and does it match `internal-dashboards`'s real label?",
    "The policy's `podSelector` reads `app: internal-dashboard` (singular). Compare that against every Deployment's actual pod labels in the namespace - which one does it really match?",
    "A NetworkPolicy's `podSelector` picks which pods the policy applies *to* - if it accidentally matches a completely different, unrelated set of pods, those pods get locked down instead of (or as well as) the intended target.",
  ],
  options: [
    {
      id: "podselector-matches-export-scheduler-not-dashboards",
      label:
        "The new policy's `podSelector` is `app: internal-dashboard` (singular) - a label that doesn't exist on `internal-dashboards`'s pods (`app: internal-dashboards`, plural) at all, but happens to be close enough to nothing that it matches zero pods directly... except `export-scheduler`'s pods carry that exact singular label as a legacy tag from before a rename, so the policy actually locks down `export-scheduler` instead of its intended target, restricting its inbound traffic to only the VPN gateway pod.",
      explanation:
        "The policy's `podSelector` (`app: internal-dashboard`) doesn't match `internal-dashboards`'s actual current label (`app: internal-dashboards`) at all - which is exactly why the intended target is completely unaffected. `export-scheduler`'s pods, however, still carry that exact legacy label from before a rename, so the policy's ingress restriction (only allowing traffic from `vpn-gateway`) applies to them instead - explaining both why the dashboards are fine and why export-scheduler's readiness probe, coming from kubelet rather than the VPN gateway, now gets connection refused.",
    },
    {
      id: "export-scheduler-own-bug",
      label: "export-scheduler shipped a bug in its own health check endpoint around the same time.",
      explanation:
        "export-scheduler's Deployment hasn't been touched recently (300 days old, no new rollout) - the failure started at the exact moment the new NetworkPolicy was applied, seven minutes ago, which points squarely at the policy rather than a coincidentally-timed application bug.",
    },
    {
      id: "vpn-gateway-pod-down",
      label: "The vpn-gateway pod the new policy references is down, breaking dashboard access.",
      explanation:
        "internal-dashboards, the intended target relying on the vpn-gateway pod being reachable, is confirmed completely unaffected and working as intended - if vpn-gateway itself were down, it would be the dashboards (the policy's actual selected pods) showing the impact, not an unrelated service.",
    },
    {
      id: "policy-applied-to-wrong-namespace",
      label: "The NetworkPolicy was accidentally applied to the wrong namespace entirely.",
      explanation:
        "The NetworkPolicy is correctly scoped to the `reporting` namespace, the same namespace both `internal-dashboards` and `export-scheduler` live in - the problem isn't which namespace the policy landed in, it's which pods within that correct namespace its `podSelector` actually matches.",
    },
  ],
  correctOptionId: "podselector-matches-export-scheduler-not-dashboards",
  resolution: `The new policy's \`podSelector\` is \`app: internal-dashboard\` - singular,
missing the trailing 's' that \`internal-dashboards\`'s current pods
actually carry (\`app: internal-dashboards\`). That mismatch is exactly why
the intended target is completely unaffected - the policy never applies
to it at all. \`export-scheduler\`'s pods, however, still carry that exact
singular \`app: internal-dashboard\` value as a leftover legacy label from
before an old rename that was never fully cleaned up. The policy's
ingress rule (allowing inbound only from \`vpn-gateway\`) ends up applying
to export-scheduler instead, which is why its own readiness probe -
coming from kubelet, not the VPN gateway - now gets connection refused.

The fix is correcting the policy's selector to actually match the
intended target, and separately cleaning up the stale legacy label so
this kind of accidental collision can't recur:

\`\`\`yaml
spec:
  podSelector:
    matchLabels:
      app: internal-dashboards   # matches the real current label
\`\`\`

\`\`\`bash
kubectl label pod -l app=export-scheduler -n reporting app-
kubectl label pod -l app=export-scheduler -n reporting app=export-scheduler --overwrite
\`\`\`

A NetworkPolicy's \`podSelector\` is only as safe as the labels it's
written against - a stale or duplicate label anywhere else in the
namespace can silently redirect a policy's effect onto completely
unrelated pods, with no error or warning from Kubernetes itself.`,
};
