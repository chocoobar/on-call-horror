import type { Scenario } from "./types";

export const theNegativeCacheThatOutlivedTheProblem: Scenario = {
  id: "the-negative-cache-that-outlived-the-problem",
  title: "The Negative Cache That Outlived the Problem",
  subtitle: "new-checkout-flow's pods can't find pricing-v2 for a full minute after it's created",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["coredns", "dns", "kubernetes"],
  briefing: `A new Service, "pricing-v2," was created as part of a phased rollout,
slightly before its consuming Deployment, "new-checkout-flow," was
scaled up. For the first minute or so after both existed, some
new-checkout-flow pods got \`UnknownHostException\` resolving pricing-v2 -
even though the Service was already there and ready when they started.`,
  constraints: [
    "The Service existed and was fully ready before the affected pods even started - this isn't a normal, expected ordering race on first creation.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "pricing-v2", namespace: "pricing", labels: { app: "pricing-v2" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.90.10", selector: { app: "pricing-v2" }, ports: [{ port: 80 }] },
        age: "5m",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "new-checkout-flow", namespace: "checkout", labels: { app: "new-checkout-flow" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "new-checkout-flow-3b4c5d6e7-f8g9h", namespace: "checkout", labels: { app: "new-checkout-flow" } },
        status: { phase: "Running", containerStatuses: [{ name: "new-checkout-flow", ready: true, restartCount: 1, state: { running: {} } }] },
        logs: {
          "new-checkout-flow": [
            "2026-09-15T09:00:02.114Z ERROR c.e.checkout.PricingClient - java.net.UnknownHostException: pricing-v2.pricing.svc.cluster.local",
            "2026-09-15T09:00:02.980Z ERROR c.e.checkout.PricingClient - java.net.UnknownHostException: pricing-v2.pricing.svc.cluster.local",
            "2026-09-15T09:01:05.201Z INFO  c.e.checkout.PricingClient - connected to pricing-v2.pricing.svc.cluster.local successfully",
          ],
        },
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "coredns-cache-notes", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "CoreDNS's `cache` plugin caches both successful *and* negative\n(NXDOMAIN - 'no such record') responses, each with their own TTL.\nThis cluster's negative-cache TTL is the CoreDNS default of 5 minutes\n(the standard default is actually much lower for this specific case in\nrecent CoreDNS versions, but this cluster overrode it upward some time\nago for unrelated reasons and it was never revisited).\n\nnew-checkout-flow's pods were briefly created and started making\nrequests to pricing-v2 slightly before the Service object had fully\npropagated through the API and into CoreDNS's view - meaning their very\nfirst lookup attempts genuinely got an NXDOMAIN, which CoreDNS then\ncached as negative for its configured TTL, on the specific CoreDNS pod\nthat handled that first query.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs new-checkout-flow-3b4c5d6e7-f8g9h -n checkout` - the failures stop and success begins at a specific point. How long after the first failure?",
    "`kubectl get configmap coredns-cache-notes -n kube-system -o yaml` - does CoreDNS cache failed lookups the same way it caches successful ones?",
    "A negative DNS cache entry is a real optimization (no point re-querying for a name that doesn't exist) - but it has a real cost when the name in question is created moments after the failed lookup that got cached.",
  ],
  options: [
    {
      id: "negative-dns-cache-outlives-service-creation",
      label:
        "The very first lookup for pricing-v2 happened in the brief window before the Service had fully propagated into CoreDNS's view, so it genuinely got an NXDOMAIN - which CoreDNS then cached as a negative result for its configured TTL; every subsequent lookup during that window kept hitting the same cached negative answer even though the Service was now fully ready, until the negative cache entry finally expired and a fresh lookup succeeded.",
      explanation:
        "The timing lines up exactly: repeated failures, then success roughly a minute later - consistent with a cached negative DNS answer expiring rather than the Service itself becoming ready (which, per the constraint, it already was). `coredns-cache-notes` confirms CoreDNS caches NXDOMAIN responses with their own TTL, and that this cluster's negative-cache TTL was overridden upward from the modern default some time ago for unrelated reasons. The very first query genuinely failed (a real, brief propagation race on Service creation), and that one honestly-negative answer then got \"frozen in\" for the full TTL, actively preventing every subsequent, would-otherwise-succeed lookup from getting a fresh answer until the cache entry aged out on its own.",
    },
    {
      id: "service-selector-not-yet-matching-pods",
      label: "pricing-v2's Service selector didn't match its own backend pods yet when new-checkout-flow started.",
      explanation:
        "This is specifically about *name resolution* failing (`UnknownHostException`, the DNS name itself not being found) rather than a resolved Service having no healthy endpoints behind it - a selector mismatch would produce a different symptom (successful connection to a ClusterIP with no working backend), not a hostname lookup failure.",
    },
    {
      id: "new-checkout-flow-wrong-namespace-in-hostname",
      label: "new-checkout-flow's code has the wrong namespace in the hostname it's calling.",
      explanation:
        "The exact same hostname - `pricing-v2.pricing.svc.cluster.local` - eventually succeeds from the same pods with no code change or restart in between; a hardcoded wrong namespace would fail consistently forever, not resolve successfully after a fixed delay with nothing else changing.",
    },
    {
      id: "kube-proxy-not-updated",
      label: "kube-proxy on the node hadn't updated its routing rules for the new Service yet.",
      explanation:
        "The failure is a DNS name resolution failure (never getting an IP address to route to at all), which happens entirely before kube-proxy's routing rules would ever come into play - kube-proxy only matters once a client already has an IP to send a packet to.",
    },
  ],
  correctOptionId: "negative-dns-cache-outlives-service-creation",
  resolution: `The timing tells the story on its own: repeated \`UnknownHostException\`
failures, then a clean success about a minute later, with nothing else
changing in between - not a gradual recovery, a hard cutover at roughly
one TTL's distance from the first failure. \`coredns-cache-notes\` explains
why: CoreDNS's \`cache\` plugin caches negative (NXDOMAIN) responses just
like positive ones, each with its own TTL, and this cluster's
negative-cache TTL had been overridden upward from the modern default at
some point for unrelated reasons. The very first lookup for pricing-v2
happened in the brief, real window before the newly-created Service had
fully propagated into CoreDNS's view - a genuine, honest NXDOMAIN at that
moment. CoreDNS cached that answer as negative for the full configured
TTL, and every subsequent lookup during that window kept receiving the
same stale "doesn't exist" answer from cache, even though the Service was
by then fully ready - right up until the cached entry finally expired and
a fresh query got the real, current answer.

The most direct fix is lowering the negative-cache TTL back down to a
value that limits how long a single unlucky first-lookup race can
matter:

\`\`\`yaml
# Corefile
.:53 {
    cache {
        success 3600
        denial 5    # seconds - a modern, low negative-cache TTL
    }
    ...
}
\`\`\`

A short negative TTL means an honestly-negative lookup right after
something's created only "poisons" the cache for a few seconds instead of
minutes. There's no way to fully eliminate the underlying propagation
race between a Service being created and it being visible to every
CoreDNS replica - but keeping the *cost* of one unlucky lookup landing in
that window small is exactly what negative-cache TTL tuning is for.`,
};
