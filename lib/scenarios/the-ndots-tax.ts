import type { Scenario } from "./types";

export const theNdotsTax: Scenario = {
  id: "the-ndots-tax",
  title: "The Ndots Tax",
  subtitle: "every outbound call to the payments processor pays an extra 200ms nobody can explain",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "ndots", "latency"],
  briefing: `"checkout-gateway" calls a payments processor at
"api.paymentsprocessor.io" on every transaction. The call itself is fast
once it starts - but distributed tracing shows a consistent ~200ms gap
between the span starting and the actual outbound request beginning, on
every single call, that nobody can attribute to the application code
itself.`,
  constraints: [
    "Profiling confirms the 200ms gap is entirely inside a DNS resolution call, before any network request to the payments processor is issued.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-gateway", namespace: "checkout2", labels: { app: "checkout-gateway" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-gateway-5h6i7j-k8l9m", namespace: "checkout2", labels: { app: "checkout-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-gateway", ready: true, restartCount: 0, state: { running: {} } }] },
        spec: { dnsPolicy: "ClusterFirst" },
        logs: {
          "checkout-gateway": [
            "2026-09-15T11:00:01.000Z TRACE c.e.checkout.DnsTiming - lookup api.paymentsprocessor.io.checkout2.svc.cluster.local -> NXDOMAIN (3ms)",
            "2026-09-15T11:00:01.005Z TRACE c.e.checkout.DnsTiming - lookup api.paymentsprocessor.io.svc.cluster.local -> NXDOMAIN (3ms)",
            "2026-09-15T11:00:01.010Z TRACE c.e.checkout.DnsTiming - lookup api.paymentsprocessor.io.cluster.local -> NXDOMAIN (4ms)",
            "2026-09-15T11:00:01.205Z TRACE c.e.checkout.DnsTiming - lookup api.paymentsprocessor.io.us-east-1.compute.internal -> NXDOMAIN (192ms, upstream forward)",
            "2026-09-15T11:00:01.215Z TRACE c.e.checkout.DnsTiming - lookup api.paymentsprocessor.io -> 203.0.113.90 (10ms, upstream, success)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kube-dns", namespace: "kube-system" },
        spec: { data: { "resolv.conf": "search checkout2.svc.cluster.local svc.cluster.local cluster.local us-east-1.compute.internal\nndots:5\n" } },
        age: "1y",
      },
    ],
  },
  hints: [
    "The application-level trace shows the whole 200ms gap happening inside DNS resolution - count how many separate lookup attempts happen for one call.",
    "The pod's `resolv.conf` has `ndots:5` and four search suffixes. `api.paymentsprocessor.io` has how many dots? Is that above or below the `ndots` threshold?",
    "The slowest single lookup (192ms) is against `us-east-1.compute.internal` - an external, upstream-forwarded suffix, not a fast cluster-local one. Why does that lookup happen at all for a call meant for `paymentsprocessor.io`?",
  ],
  options: [
    {
      id: "ndots-5-forces-search-suffixes-before-real-lookup",
      label:
        "`api.paymentsprocessor.io` has only 2 dots, below the pod's `ndots:5` threshold, so every call triggers four search-suffix lookups first - three fast, cluster-local NXDOMAINs, then a slow 192ms NXDOMAIN against the upstream-forwarded `us-east-1.compute.internal` suffix - before the resolver finally tries the name as-is and succeeds in 10ms; that failed upstream lookup accounts for nearly all of the observed 200ms gap on every single call.",
      explanation:
        "The pod's `resolv.conf` sets `ndots:5` with four search suffixes, and `api.paymentsprocessor.io` (2 dots) falls well under that threshold, triggering exactly the five-lookup sequence shown in the trace log - three fast internal misses, then a 192ms miss against `us-east-1.compute.internal` (forwarded to an upstream resolver), and only then the real, correct, fast lookup. That slow upstream NXDOMAIN alone accounts for essentially the entire observed 200ms gap, on every call, with nothing wrong in the application code at all.",
    },
    {
      id: "payments-processor-dns-slow",
      label: "The payments processor's own authoritative DNS infrastructure is slow to respond.",
      explanation:
        "The trace shows the actual, correct lookup for `api.paymentsprocessor.io` completing in just 10ms once it's finally attempted - the processor's own DNS is fast. The overwhelming majority of the delay comes from failed lookups against irrelevant internal and cloud-provider search suffixes that happen before the real query.",
    },
    {
      id: "coredns-under-resourced",
      label: "The cluster's CoreDNS pods are under-resourced and slow to answer any query.",
      explanation:
        "The three cluster-local lookups each resolve in just 3-4ms, showing CoreDNS itself responding quickly for those - the slow step is a single lookup forwarded upstream for an irrelevant, non-cluster search suffix, not general CoreDNS performance.",
    },
    {
      id: "tls-handshake-included-in-trace-span",
      label: "The tracing span incorrectly includes TLS handshake time alongside DNS resolution.",
      explanation:
        "Profiling specifically confirms the 200ms gap is entirely inside a DNS resolution call, before any network request (including a TLS handshake) begins - the span boundaries are correctly isolating DNS as the cause, not conflating it with a later step.",
    },
  ],
  correctOptionId: "ndots-5-forces-search-suffixes-before-real-lookup",
  resolution: `The pod's \`resolv.conf\` sets \`ndots:5\` with a four-entry search list
inherited from the node's own domain configuration, including
\`us-east-1.compute.internal\` - a cloud-provider default search suffix.
\`api.paymentsprocessor.io\` has only 2 dots, well under the \`ndots\`
threshold, so every call triggers the full search-suffix sequence first:
three fast, cluster-local misses, then a 192ms miss against
\`us-east-1.compute.internal\` specifically (forwarded to an upstream
resolver, since it isn't a cluster-local zone CoreDNS answers directly),
and only then the real, correct lookup - which itself takes just 10ms.
That one slow upstream-forwarded miss accounts for essentially the whole
observed 200ms gap, consistently, on every single call.

The most targeted fix is making the payments processor's hostname fully
qualified at the call site, skipping search-suffix expansion entirely:

\`\`\`java
String paymentsHost = "api.paymentsprocessor.io.";  // trailing dot = FQDN
\`\`\`

More broadly, lowering \`ndots\` via the pod's \`dnsConfig\` avoids this tax
for every external call this and any other pod on the same
configuration makes:

\`\`\`yaml
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"
\`\`\`

with the tradeoff that any genuinely short, cluster-relative hostname
used elsewhere in the app would then need to be fully qualified instead
of relying on the search list. This exact pattern - a dotted, external
hostname paying for several failed internal (and cloud-provider) lookups
on every call under the default \`ndots:5\` - is one of the most common,
and most invisible-to-application-code, sources of consistent DNS
latency in Kubernetes.`,
};
