import type { Scenario } from "./types";

export const hostnameTypoInTheUpstream: Scenario = {
  id: "hostname-typo-in-the-upstream",
  title: "The Upstream Hostname With A Typo",
  subtitle: "a fresh config push, and the shipping-rates integration has been dead ever since",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["dns", "configmap", "external-api"],
  briefing: `"shipping-calculator" was reconfigured this morning to call a carrier's
new rate-quoting API endpoint, replacing an old, soon-to-be-retired one.
Every call since the change has failed immediately with a DNS resolution
error - not a timeout, not a rejection, the hostname itself doesn't seem
to exist.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-calculator", namespace: "shipping", labels: { app: "shipping-calculator" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipping-calculator-4k5l6m-n7o8p", namespace: "shipping", labels: { app: "shipping-calculator" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipping-calculator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipping-calculator": [
            "2026-09-15T07:30:01.010Z ERROR c.e.shipping.RateClient - java.net.UnknownHostException: rates-api.carirerco.com",
            "2026-09-15T07:30:01.010Z ERROR c.e.shipping.RateClient - java.net.UnknownHostException: rates-api.carirerco.com",
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipping-calculator-config", namespace: "shipping" },
        spec: {
          data: {
            "application.yaml": "carrier:\n  ratesEndpoint: https://rates-api.carirerco.com/v2/quote\n  timeoutMs: 5000\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "The error is `UnknownHostException`, a DNS resolution failure - that means the hostname itself was never even found, before any connection attempt was made.",
    "`kubectl get configmap shipping-calculator-config -n shipping -o yaml` - read `ratesEndpoint` letter by letter. Is `carirerco.com` actually the carrier's real domain?",
    "A DNS failure on a freshly-changed hostname, right after a config push, is almost always either a typo in the hostname itself or a record that genuinely doesn't exist yet - check the spelling first.",
  ],
  options: [
    {
      id: "hostname-typo-carirerco",
      label:
        "The new `ratesEndpoint` URL in the ConfigMap has a typo - `rates-api.carirerco.com` instead of the carrier's real domain, `rates-api.carrierco.com` - so DNS resolution fails immediately with `UnknownHostException` for every call, since the misspelled hostname was never a real, registered domain at all.",
      explanation:
        "Reading the ConfigMap's `ratesEndpoint` value letter by letter shows `carirerco.com` - transposed letters from the intended `carrierco.com`. Since the misspelled domain doesn't exist, every DNS lookup against it fails with `UnknownHostException`, exactly matching the logs, and exactly matching a failure that started the moment this new config was applied.",
    },
    {
      id: "carrier-api-decommissioned-new-endpoint",
      label: "The carrier decommissioned the new endpoint before it was announced as ready.",
      explanation:
        "A decommissioned but previously-valid hostname would still resolve via DNS (just fail to connect, or connect and reject the request) - `UnknownHostException` means the name itself was never resolvable at all, which points at the hostname never having existed as typed, not at a real endpoint being taken down.",
    },
    {
      id: "coredns-cluster-wide-outage",
      label: "CoreDNS in the cluster is down or failing to resolve external hostnames entirely.",
      explanation:
        "There's no indication any other external call from any other service in the cluster is failing - a cluster-wide CoreDNS outage would affect every outbound DNS lookup cluster-wide, not just this one specific, recently-changed hostname.",
    },
    {
      id: "networkpolicy-blocking-new-domain",
      label: "A NetworkPolicy is blocking egress specifically to the carrier's new domain.",
      explanation:
        "A NetworkPolicy egress block would still allow the DNS *lookup* itself to succeed (DNS and the actual connection are enforced independently by most NetworkPolicy setups, and a block would typically show as a connection timeout, not `UnknownHostException`) - this failure is specifically a name-resolution failure, consistent with the hostname simply being misspelled and non-existent.",
    },
  ],
  correctOptionId: "hostname-typo-carirerco",
  resolution: `Reading the ConfigMap's \`ratesEndpoint\` value character by character shows
\`rates-api.carirerco.com\` - two letters transposed from the carrier's
real domain, \`carrierco.com\`. Since the misspelled domain was never
registered or resolvable at all, every DNS lookup against it fails
immediately with \`UnknownHostException\`, exactly matching
shipping-calculator's logs, and exactly matching the moment the new
config was applied three hours ago.

The fix is a one-character-level correction to the hostname:

\`\`\`yaml
carrier:
  ratesEndpoint: https://rates-api.carrierco.com/v2/quote
  timeoutMs: 5000
\`\`\`

After applying the corrected ConfigMap, the pods need to pick up the
change (either via a restart, or automatically if shipping-calculator
watches the ConfigMap for live reloads) before the fix takes effect.
Anytime a config change introduces a brand-new external hostname, a
quick DNS resolution check (\`nslookup\` or \`dig\` from a debug pod) against
the exact value before rolling it out would have caught this before it
ever reached production.`,
};
