import type { Scenario } from "../types";

export const blockedAtTheBorder: Scenario = {
  id: "blocked-at-the-border",
  title: "Blocked at the Border",
  subtitle: "recommendations-api can't reach the new pricing-service, and nothing logs why",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["networkpolicy", "kubernetes", "connectivity"],
  briefing: `"pricing-service" launched last week in the "pricing" namespace. Every
other service that needs it - checkout, cart - reaches it fine. Only
"recommendations-api", running in the "recs" namespace, times out on
every call: no connection refused, no TLS error, no response at all,
just silence until the client gives up.`,
  constraints: [
    "pricing-service itself is healthy - every request that already reaches it succeeds immediately. Nothing about pricing-service's own code or config is at fault here.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-service", namespace: "pricing", labels: { app: "pricing-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "8d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-service-1a2b3c4d5-e6f7g", namespace: "pricing", labels: { app: "pricing-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "pricing-service", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "8d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "pricing-service", namespace: "pricing", labels: { app: "pricing-service" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.20.30", selector: { app: "pricing-service" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "8d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "pricing-service-allow-checkout-cart", namespace: "pricing" },
        spec: {
          podSelector: { matchLabels: { app: "pricing-service" } },
          policyTypes: ["Ingress"],
          ingress: [
            {
              from: [
                { namespaceSelector: { matchLabels: { team: "checkout" } } },
                { namespaceSelector: { matchLabels: { team: "cart" } } },
              ],
              ports: [{ protocol: "TCP", port: 8080 }],
            },
          ],
        },
        age: "8d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "namespace-labels-notes", namespace: "pricing" },
        spec: {
          data: {
            "notes.md":
              "Namespace `team` labels (checked via `kubectl get ns --show-labels`):\n- checkout: team=checkout\n- cart: team=cart\n- recs: (no `team` label set)\n",
          },
        },
        age: "8d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendations-api", namespace: "recs", labels: { app: "recommendations-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "recommendations-api-9h0i1j2k3-l4m5n", namespace: "recs", labels: { app: "recommendations-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "recommendations-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "recommendations-api": [
            "2026-09-15T08:00:01.204Z WARN  c.e.recs.PricingClient - call to http://pricing-service.pricing.svc.cluster.local timed out after 5000ms",
            "2026-09-15T08:00:11.980Z WARN  c.e.recs.PricingClient - call to http://pricing-service.pricing.svc.cluster.local timed out after 5000ms",
            "2026-09-15T08:00:22.512Z WARN  c.e.recs.PricingClient - call to http://pricing-service.pricing.svc.cluster.local timed out after 5000ms",
          ],
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get networkpolicy pricing-service-allow-checkout-cart -n pricing -o yaml` - this is the only NetworkPolicy selecting `pricing-service`'s pods, and NetworkPolicies are default-deny for anything they don't explicitly allow once one exists for a pod.",
    "The policy's `ingress[].from` allows traffic by *namespace label* (`team: checkout`, `team: cart`), not by namespace name.",
    "`kubectl get configmap namespace-labels-notes -n pricing -o yaml` - does the `recs` namespace have the label this policy is looking for?",
  ],
  options: [
    {
      id: "namespace-missing-team-label",
      label:
        "The NetworkPolicy on pricing-service only allows ingress from namespaces labeled `team: checkout` or `team: cart` - the `recs` namespace has no `team` label at all, so traffic from recommendations-api is silently dropped at the network layer before it ever reaches the pod, with nothing on either side to log an error about it.",
      explanation:
        "`pricing-service-allow-checkout-cart`'s `ingress[].from` is two `namespaceSelector`s, matching `team: checkout` and `team: cart` - and only those. `namespace-labels-notes` confirms `recs` has no `team` label set, so it matches neither selector. Once any NetworkPolicy selects a pod, all ingress not explicitly allowed is denied by default - packets from recommendations-api are dropped before they reach pricing-service, which is exactly why it looks like a timeout with zero response and nothing logged on the receiving end (pricing-service never sees the request at all).",
    },
    {
      id: "pricing-service-crashing",
      label: "pricing-service is intermittently crashing under load from multiple callers.",
      explanation:
        "Both pricing-service pods are Running, Ready, with zero restarts, and checkout/cart traffic succeeds the whole time - there's no evidence of crashing or instability on pricing-service's side at all.",
    },
    {
      id: "dns-not-resolving",
      label: "recommendations-api can't resolve `pricing-service.pricing.svc.cluster.local` via DNS.",
      explanation:
        "A DNS failure would show up immediately as an UnknownHostException or resolution error, not a 5-second timeout waiting for a response - this looks exactly like a connection that gets established (or at least attempted) and then goes nowhere, which points at a network-layer block, not a naming problem.",
    },
    {
      id: "service-selector-wrong",
      label: "The pricing-service Service's selector doesn't match its pods' labels.",
      explanation:
        "The Service's `selector` (`app: pricing-service`) matches the pods' labels exactly, and checkout/cart route through this exact same Service successfully - the Service-to-pod wiring is fine, this is scoped specifically to traffic from one namespace.",
    },
  ],
  correctOptionId: "namespace-missing-team-label",
  resolution: `\`pricing-service-allow-checkout-cart\` is the only \`NetworkPolicy\` selecting
pricing-service's pods, and it only allows ingress from namespaces labeled
\`team: checkout\` or \`team: cart\`. The moment a pod is selected by even
one NetworkPolicy, Kubernetes' default-deny behavior kicks in for anything
that policy doesn't explicitly allow - so every other source, allowed or
not by intent, gets silently dropped at the network layer. \`recs\` was
never labeled with a \`team\` value at all (per \`namespace-labels-notes\`),
so it matches neither selector, and every packet from
recommendations-api to pricing-service is dropped before it ever reaches
the pod. Neither side logs anything, because neither side ever sees a
connection - which is exactly why it presents as a plain timeout rather
than a clean rejection.

Two ways to fix it, depending on intent. If recommendations-api is
supposed to reach pricing-service, add its namespace to the allow list:

\`\`\`yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels: { team: checkout }
      - namespaceSelector:
          matchLabels: { team: cart }
      - namespaceSelector:
          matchLabels: { team: recs }
\`\`\`

which requires the \`recs\` namespace itself to actually carry
\`team: recs\` as a label (\`kubectl label namespace recs team=recs\`) - a
\`namespaceSelector\` matches the *namespace's* labels, not anything on the
pods inside it.

Any time a NetworkPolicy locks down a service, every legitimate caller
needs an explicit matching rule - a new consumer showing up later (like
recommendations-api integrating with pricing-service this month) is
denied by default until someone remembers to add it.`,
};
