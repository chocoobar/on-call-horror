import type { Scenario } from "../types";

export const externalnameServiceStaleHost: Scenario = {
  id: "externalname-service-stale-host",
  title: "The ExternalName Nobody Updated",
  subtitle: "the vendor's real endpoint moved months ago. Kubernetes is still forwarding everyone to the old one.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["service", "externalname", "dns"],
  briefing: `"data-enrichment" calls a third-party lookup API through an internal
Kubernetes Service that's supposed to act as a stable alias for the
vendor's actual hostname. Every call has started failing with connection
refused in the last hour, right after the vendor sent an email (missed
by everyone until now) announcing their old endpoint was being retired
today.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "data-enrichment", namespace: "enrichment", labels: { app: "data-enrichment" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "data-enrichment-1d2e3f-g4h5i", namespace: "enrichment", labels: { app: "data-enrichment" } },
        status: { phase: "Running", containerStatuses: [{ name: "data-enrichment", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "data-enrichment": [
            "2026-09-15T14:05:01.020Z ERROR c.e.enrichment.LookupClient - connect refused: lookup-vendor.enrichment.svc.cluster.local:443",
            "2026-09-15T14:05:31.050Z ERROR c.e.enrichment.LookupClient - connect refused: lookup-vendor.enrichment.svc.cluster.local:443",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "lookup-vendor", namespace: "enrichment" },
        spec: { type: "ExternalName", externalName: "api-v1.lookupvendor.io" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "vendor-migration-notice", namespace: "enrichment" },
        spec: {
          data: {
            "notice.md":
              "Email from LookupVendor Inc., received 3 months ago (into a shared\ninbox nobody was actively monitoring): 'Our legacy `api-v1.lookupvendor\n.io` endpoint will be fully decommissioned on 2026-09-15. Please migrate\nall integrations to `api-v2.lookupvendor.io` before that date, which has\nbeen live and fully supported since this notice was sent.' Today is\n2026-09-15.\n",
          },
        },
        age: "90d",
      },
    ],
  },
  hints: [
    "`kubectl get svc lookup-vendor -n enrichment -o yaml` - this is an ExternalName Service. What hostname does it actually forward to?",
    "`kubectl get configmap vendor-migration-notice -n enrichment -o yaml` - is there any relevant context about the vendor's own infrastructure changing recently, and what today's date is relative to it?",
    "An ExternalName Service is just a DNS-level CNAME alias - it doesn't proxy or health-check anything; if the hostname it points to stops resolving or stops accepting connections, every caller through the Service fails identically and immediately.",
  ],
  options: [
    {
      id: "externalname-points-at-decommissioned-v1-endpoint",
      label:
        "The `lookup-vendor` Service is an ExternalName Service pointing at `api-v1.lookupvendor.io`, the vendor's legacy endpoint - the vendor announced (via an email nobody caught in time) that endpoint would be fully decommissioned today, in favor of `api-v2.lookupvendor.io`, which has been live and ready for months; the ExternalName Service is just a DNS alias with no logic of its own, so the moment the vendor actually retired the old endpoint today, every call through this Service started failing identically, exactly matching the timing.",
      explanation:
        "The Service's `spec.externalName` is confirmed to be `api-v1.lookupvendor.io`. `vendor-migration-notice` confirms that exact hostname was scheduled for full decommissioning today, with a replacement (`api-v2.lookupvendor.io`) that's been available for three months. Since an ExternalName Service is purely a DNS-level alias with no health checking or failover logic, the instant the vendor's old endpoint actually went away, every caller through this Service started getting connection refused simultaneously - matching the failure starting in the last hour, right on schedule.",
    },
    {
      id: "data-enrichment-app-cert-expired",
      label: "data-enrichment's own client certificate used to authenticate with the vendor has expired.",
      explanation:
        "An expired client certificate would typically produce a TLS handshake or authentication-level rejection after a successful connection, not a connection refused - a refused connection means nothing is listening on the other end at all, consistent with the destination host itself no longer accepting connections, not an auth failure.",
    },
    {
      id: "coredns-not-resolving-externalname",
      label: "CoreDNS itself is failing to resolve the ExternalName Service's CNAME properly.",
      explanation:
        "A CNAME resolution failure at the CoreDNS layer would produce an unknown-host-style DNS error, not a connection refused - the error indicates a real connection attempt was made against a resolved address and actively rejected, consistent with successfully resolving to the vendor's now-decommissioned host rather than any resolution failure inside the cluster.",
    },
    {
      id: "networkpolicy-blocking-vendor-egress",
      label: "A NetworkPolicy was recently changed and is now blocking egress to the vendor's IP range.",
      explanation:
        "Nobody made any Kubernetes-level networking changes recently, and a NetworkPolicy block typically produces a connection timeout (packets silently dropped) rather than an active connection refused, which specifically indicates something did respond, actively declining the connection - consistent with reaching the vendor's infrastructure and being told nothing is listening there anymore.",
    },
  ],
  correctOptionId: "externalname-points-at-decommissioned-v1-endpoint",
  resolution: `The \`lookup-vendor\` Service's \`spec.externalName\` is
\`api-v1.lookupvendor.io\` - the vendor's legacy endpoint.
\`vendor-migration-notice\` reveals the vendor announced, three months ago
via an email that went unnoticed, that this exact endpoint would be
fully decommissioned today, with \`api-v2.lookupvendor.io\` live and ready
as the replacement the entire time. An ExternalName Service is purely a
DNS-level CNAME alias with no health checking, failover, or logic of its
own - it simply forwards DNS resolution to whatever hostname it's
configured with. The moment the vendor actually retired the old endpoint
today, on schedule, every caller going through this Service started
getting connection refused simultaneously, since there's nothing on the
other end anymore and nothing about the Service itself to catch or work
around that.

The fix is updating the ExternalName Service to point at the vendor's
current, supported endpoint:

\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: lookup-vendor
  namespace: enrichment
spec:
  type: ExternalName
  externalName: api-v2.lookupvendor.io
\`\`\`

Since \`api-v2\` has been live and stable for months, this is a low-risk,
immediate fix - though it's worth a quick check of the v2 API's request/
response shape against what data-enrichment's client actually sends, in
case anything changed between versions beyond just the hostname. More
broadly, this is a good case for routing vendor deprecation notices
somewhere actively monitored (a shared on-call inbox, or a ticket queue)
rather than a mailbox nobody was watching - an ExternalName Service
pointing at a vendor endpoint is exactly the kind of dependency that can
go stale silently until the vendor's own timeline forces the issue.`,
};
