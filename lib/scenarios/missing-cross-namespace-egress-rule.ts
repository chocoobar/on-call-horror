import type { Scenario } from "./types";

export const missingCrossNamespaceEgressRule: Scenario = {
  id: "missing-cross-namespace-egress-rule",
  title: "Missing Cross-Namespace Egress Rule",
  subtitle: "notifications-svc can reach everything in its own namespace, and nothing outside it",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["networkpolicy", "egress", "namespaces"],
  briefing: `"notifications-svc" was just moved into its own dedicated "notify" namespace
as part of a platform reorg, complete with a locked-down NetworkPolicy. It
can reach every other pod inside "notify" just fine. The moment it tries to
call "user-profiles" over in the "identity" namespace to fetch a
recipient's contact details, the connection just hangs and times out.`,
  constraints: [
    "user-profiles in the identity namespace is confirmed healthy and reachable from every other namespace that calls it.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notifications-svc", namespace: "notify", labels: { app: "notifications-svc" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notifications-svc-7c9d8f-k3m2n", namespace: "notify", labels: { app: "notifications-svc" } },
        status: { phase: "Running", containerStatuses: [{ name: "notifications-svc", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "notifications-svc": [
            "2026-09-15T08:14:02.001Z INFO  c.e.notify.Dispatcher - queued 42 notifications for delivery",
            "2026-09-15T08:14:32.112Z ERROR c.e.notify.ProfileClient - connect timed out: user-profiles.identity.svc.cluster.local:8080",
            "2026-09-15T08:15:02.400Z ERROR c.e.notify.ProfileClient - connect timed out: user-profiles.identity.svc.cluster.local:8080",
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "notify-egress", namespace: "notify" },
        spec: {
          podSelector: {},
          policyTypes: ["Egress"],
          egress: [
            { to: [{ podSelector: {} }] },
            { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }] },
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: "identity", labels: { "kubernetes.io/metadata.name": "identity" } },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get networkpolicy notify-egress -n notify -o yaml` - list out every `to:` entry. Which namespaces does this policy actually allow egress to?",
    "One egress rule allows traffic to other pods within the same namespace (`podSelector: {}` with no `namespaceSelector` defaults to the policy's own namespace), and one allows DNS to kube-system. Is there a rule for anything in `identity`?",
    "A cross-namespace NetworkPolicy egress rule needs a `namespaceSelector` matching the target namespace's labels - an egress rule with only a bare `podSelector` never reaches outside the policy's own namespace.",
  ],
  options: [
    {
      id: "no-egress-rule-for-identity-namespace",
      label:
        "`notify-egress` only allows egress to pods within the `notify` namespace itself and to kube-system for DNS - there's no rule permitting egress to the `identity` namespace at all, so traffic to user-profiles is silently dropped at the NetworkPolicy layer regardless of user-profiles being perfectly healthy.",
      explanation:
        "The policy's two egress entries are a bare `podSelector: {}` (which, with no `namespaceSelector`, only matches pods in the policy's own namespace) and a DNS-only rule scoped to `kube-system`. Nothing in the policy references `identity` in any form. notifications-svc can resolve `user-profiles.identity.svc.cluster.local` via DNS (the second rule allows that lookup) but the actual connection attempt afterward is dropped, producing exactly the connect-timeout pattern in its logs.",
    },
    {
      id: "user-profiles-actually-down",
      label: "user-profiles itself is down or overloaded and not accepting new connections.",
      explanation:
        "user-profiles is confirmed healthy and reachable from every other namespace calling it - the failure is isolated specifically to notifications-svc's new namespace, which points at something scoped to that namespace rather than a problem with the target service itself.",
    },
    {
      id: "dns-resolution-failing-for-identity",
      label: "DNS resolution for `user-profiles.identity.svc.cluster.local` is failing.",
      explanation:
        "The failure in the logs is a connect timeout, not a DNS resolution error (which would show as an unknown-host exception before any connection attempt) - and the policy's DNS egress rule to kube-system is unrestricted by destination, so lookups for any hostname, including this one, are permitted to succeed.",
    },
    {
      id: "identity-namespace-has-ingress-policy-blocking",
      label: "The `identity` namespace has its own NetworkPolicy blocking inbound traffic from `notify`.",
      explanation:
        "No NetworkPolicy exists in the `identity` namespace in this scenario, and user-profiles is reachable from every other calling namespace - an ingress-side restriction in `identity` would need to specifically exclude `notify` while allowing everyone else, which isn't what's described or evidenced here.",
    },
  ],
  correctOptionId: "no-egress-rule-for-identity-namespace",
  resolution: `\`notify-egress\` has exactly two egress rules: one allowing traffic to
other pods within its own namespace (a bare \`podSelector: {}\` with no
\`namespaceSelector\` only ever matches within the policy's own namespace),
and one allowing DNS lookups to \`kube-system\`. Nothing in the policy
grants egress to the \`identity\` namespace. DNS resolution for
\`user-profiles.identity.svc.cluster.local\` succeeds fine (the DNS rule
covers any destination hostname), which is why the failure shows up as a
connect timeout rather than an unknown-host error - the pod resolves the
address correctly and then has the actual TCP connection silently
dropped by the NetworkPolicy.

The fix is adding an explicit cross-namespace egress rule targeting
\`identity\`, ideally scoped down to just the pods that need to be reached
rather than the whole namespace:

\`\`\`yaml
spec:
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: identity
          podSelector:
            matchLabels:
              app: user-profiles
      ports:
        - port: 8080
          protocol: TCP
\`\`\`

Any time a NetworkPolicy'd namespace gets split off from a dependency it
used to share a namespace with, every cross-namespace call it makes needs
its own explicit egress rule - "it worked before the split" is a strong
sign the old, implicit same-namespace access is exactly what's now
missing.`,
};
