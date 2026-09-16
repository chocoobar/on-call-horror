import type { Scenario } from "../types";

export const theFiveSecondDelay: Scenario = {
  id: "the-five-second-delay",
  title: "The Five-Second Delay",
  subtitle: "every call to an external API takes suspiciously exactly ~5 seconds longer than it should",
  difficulty: "hard",
  type: "fix",
  topic: "networking",
  timeMinutes: 25,
  tags: ["dns", "networking", "kubernetes"],
  briefing: `"invoicing-api" calls out to \`api.stripe.com\` to process payments. The
call itself, per Stripe's own status page and everyone else's integration,
should take well under a second. In this cluster, it reliably takes just
over 5 seconds longer than that - not occasionally, not under load, every
single time, like clockwork.`,
  constraints: [
    "This isn't Stripe being slow, and it isn't network congestion - the delay is exactly, suspiciously consistent, which usually means something is deterministically retrying or waiting rather than something being organically overloaded.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoicing-api", namespace: "invoicing", labels: { app: "invoicing-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              dnsPolicy: "ClusterFirst",
              dnsConfig: { options: [{ name: "ndots", value: "5" }] },
              containers: [{ name: "invoicing-api", image: "registry.internal/invoicing-api:1.9.0" }],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoicing-api-5m6n7o8p9-q0r1s", namespace: "invoicing", labels: { app: "invoicing-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoicing-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoicing-api": [
            "2026-09-15T11:00:00.001Z INFO  c.e.invoicing.StripeClient - charging invoice inv-7841 via api.stripe.com",
            "2026-09-15T11:00:05.312Z INFO  c.e.invoicing.StripeClient - charge succeeded for invoice inv-7841 (5311ms)",
            "2026-09-15T11:04:10.002Z INFO  c.e.invoicing.StripeClient - charging invoice inv-7842 via api.stripe.com",
            "2026-09-15T11:04:15.288Z INFO  c.e.invoicing.StripeClient - charge succeeded for invoice inv-7842 (5286ms)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "network-notes", namespace: "invoicing" },
        spec: {
          data: {
            "resolv.conf.excerpt":
              "search invoicing.svc.cluster.local svc.cluster.local cluster.local corp.example.internal\noptions ndots:5\n",
            "notes.md":
              "`api.stripe.com` is called as a bare hostname (no trailing dot) from\n`StripeClient`. Every other internal call in this service uses short\nnames like `billing-service` or `billing-service.billing`, which is why\nnobody noticed this pattern until now.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap network-notes -n invoicing -o yaml` - look at the `search` list and `ndots` option together.",
    "`ndots:5` means: if a hostname has fewer than 5 dots in it, the resolver tries appending each `search` domain first, in order, before ever trying the name as given. `api.stripe.com` has exactly 2 dots.",
    "Each failed lookup against a search-domain-qualified name (like `api.stripe.com.invoicing.svc.cluster.local`) still has to fail (usually via NXDOMAIN) before the resolver moves on to the next one - and that adds up per external call.",
  ],
  options: [
    {
      id: "ndots-search-domain-expansion",
      label:
        "With `ndots:5` and a 4-entry `search` list, a call to the bare hostname `api.stripe.com` (only 2 dots) triggers the resolver to try `api.stripe.com.invoicing.svc.cluster.local`, `...svc.cluster.local`, `...cluster.local`, and `...corp.example.internal` first - each one a real DNS query that has to fail - before finally trying `api.stripe.com` on its own, and those extra round trips are exactly the ~5 extra seconds on every call.",
      explanation:
        "`network-notes` shows `ndots:5` plus a 4-domain search list, and confirms `api.stripe.com` is called as a bare hostname. Kubernetes' default DNS policy (`ClusterFirst`) generates exactly this configuration, and it's a well-known trap: any external hostname with fewer than 5 dots gets every search-domain-qualified variant tried against DNS first, each contributing its own round-trip (and, depending on the resolver's retry/timeout settings, its own multi-second stall) before the resolver falls back to the name as typed. Four failed lookups plus the one that succeeds lines up with a consistent, deterministic multi-second delay on every single external call - exactly what's observed here.",
    },
    {
      id: "stripe-is-slow",
      label: "Stripe's API is just slow for this account/region.",
      explanation:
        "Stripe's own status and every other integration elsewhere show normal sub-second latency - and the delay here is suspiciously exact and repeatable on every call, which points at something deterministic in this cluster's own resolution path rather than a third party being generically slow.",
    },
    {
      id: "outbound-firewall-throttling",
      label: "An egress firewall or proxy is throttling outbound HTTPS traffic to third-party domains.",
      explanation:
        "Throttling would typically show up as variable, load-dependent delay, not the same ~5 seconds added on every single call regardless of traffic. A fixed, repeatable delay is much more consistent with a deterministic resolution process than a rate limiter.",
    },
    {
      id: "connection-pool-exhausted",
      label: "invoicing-api's HTTP client connection pool is exhausted, so every request waits for a free connection.",
      explanation:
        "A connection pool problem would produce delay that scales with concurrent traffic and queuing - it wouldn't explain the same, nearly identical ~5-second addition on isolated, back-to-back calls with plenty of time between them.",
    },
  ],
  correctOptionId: "ndots-search-domain-expansion",
  resolution: `\`network-notes\` lays out both halves of this: the pod's resolver config
has \`ndots:5\` and a 4-entry \`search\` list (\`invoicing.svc.cluster.local\`,
\`svc.cluster.local\`, \`cluster.local\`, \`corp.example.internal\`) - which is
exactly what Kubernetes' default \`ClusterFirst\` DNS policy sets up so that
short in-cluster names like \`billing-service\` resolve without being fully
qualified. \`StripeClient\` calls \`api.stripe.com\` as a bare hostname, which
has only 2 dots - fewer than \`ndots:5\`.

glibc's resolver rule for \`ndots\` is: if a name has fewer dots than
\`ndots\`, try it with each \`search\` domain appended, in order, *before*
trying the name exactly as given. So a single call to \`api.stripe.com\`
actually triggers up to five DNS queries in sequence:

\`\`\`
api.stripe.com.invoicing.svc.cluster.local   -> NXDOMAIN
api.stripe.com.svc.cluster.local             -> NXDOMAIN
api.stripe.com.cluster.local                 -> NXDOMAIN
api.stripe.com.corp.example.internal         -> NXDOMAIN
api.stripe.com                               -> succeeds
\`\`\`

Each of the first four has to actually fail before moving to the next,
and each failure costs a real round trip (and, depending on the
resolver/timeout configuration involved, can cost multiple seconds on its
own) - which is exactly the extra, suspiciously consistent delay showing
up on every external call.

The most direct fix is to make the external call unambiguous by adding a
trailing dot, which tells the resolver "this is already fully qualified,
skip the search list entirely":

\`\`\`java
// before
httpClient.get("https://api.stripe.com/v1/charges");

// after - trailing dot skips ndots search-domain expansion
httpClient.get("https://api.stripe.com./v1/charges");
\`\`\`

(Some HTTP clients/TLS stacks need the trailing dot handled carefully for
SNI/cert validation - an equally common fix is lowering \`ndots\` for pods
that make a lot of external calls, via \`dnsConfig.options\`, so short
internal names still resolve in fewer hops while external FQDNs skip the
search list sooner.) Either way, once the resolver stops trying four
internal-domain variants of a public hostname, the extra ~5 seconds
disappears from every call.`,
};
