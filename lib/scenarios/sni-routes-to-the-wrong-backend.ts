import type { Scenario } from "./types";

export const sniRoutesToTheWrongBackend: Scenario = {
  id: "sni-routes-to-the-wrong-backend",
  title: "SNI Routes To The Wrong Backend",
  subtitle: "one customer's traffic keeps landing on a completely different customer's dedicated instance",
  difficulty: "hard",
  type: "fix",
  topic: "networking",
  timeMinutes: 25,
  tags: ["tls", "sni", "shared-load-balancer"],
  briefing: `A shared TLS-passthrough Network Load Balancer routes traffic for several
enterprise customers to their own dedicated backend instance, chosen
purely by the TLS SNI hostname in each connection's ClientHello - no TLS
termination happens at the load balancer itself. One customer,
"acme-corp.tenants.example.com," has started intermittently receiving
another customer's data in API responses - roughly one request in fifty.`,
  constraints: [
    "Every affected instance's own application logs show it genuinely receiving and correctly answering the request it got - it has no idea the request was meant for someone else.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "acme-corp-instance", namespace: "tenants2", labels: { app: "acme-corp-instance" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "globex-instance", namespace: "tenants2", labels: { app: "globex-instance" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sni-router-config", namespace: "tenants2" },
        spec: {
          data: {
            "router.conf": "# SNI-based TCP routing rules, evaluated top to bottom, first match wins\nmap $ssl_preread_server_name $backend {\n    ~^acme    acme_upstream;\n    ~^globex-corp.tenants.example.com$   globex_upstream;\n    default   acme_upstream;\n}\n",
          },
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sni-router-notes", namespace: "tenants2" },
        spec: {
          data: {
            "notes.md":
              "This SNI passthrough router matches each connection's ClientHello\nserver_name against an ordered list of regex patterns, first match\nwins. A new enterprise customer, 'acme-payments-processor', onboarded 8\nmonths ago with hostname 'acme-payments-processor.tenants.example.com' -\ndistinct from and unrelated to the original 'acme-corp' tenant - but its\nSNI rule was added using the loose prefix pattern `~^acme`, matching\n*any* hostname starting with those four letters, rather than a\nfull-hostname anchor. Since regex rules are evaluated top to bottom with\nfirst-match-wins, and this loose rule was placed above the more specific\nrules for other tenants, roughly 1 in 50 requests - specifically, any\nrequest actually destined for the *new* acme-payments-processor tenant -\nnow incorrectly matches this same loose rule ahead of its own intended,\nmore specific destination, while acme-corp's own genuine traffic\ncontinues to match correctly (since it also starts with 'acme' and was\nnever the problem) - the real leak is acme-payments-processor's traffic\nbeing misrouted to acme-corp's dedicated instance, not the reverse.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "The SNI router config matches hostnames against an ordered list of patterns - first match wins. Is every pattern anchored to a full, exact hostname, or are any of them loose prefixes?",
    "`kubectl get configmap sni-router-notes -n tenants2 -o yaml` - was a new tenant onboarded recently with a hostname that happens to share a prefix with an existing one?",
    "The pattern `~^acme` matches any hostname *starting with* 'acme' - what other tenant hostnames, beyond the intended one, would also match that same loose rule?",
  ],
  options: [
    {
      id: "loose-prefix-regex-matches-newer-tenant-too",
      label:
        "The SNI router's rule for the original `acme-corp` tenant uses a loose, unanchored prefix pattern (`~^acme`) rather than a full-hostname match, and it sits above more specific rules in the evaluation order - when a newer, unrelated tenant, `acme-payments-processor`, was onboarded 8 months later with a hostname that happens to also start with 'acme', its connections now incorrectly match the older, loose rule first and get routed to acme-corp's dedicated instance instead of their own, roughly matching the reported 1-in-50 leak rate for whatever fraction of total traffic belongs to the newer tenant.",
      explanation:
        "`sni-router-notes` and the router's own config confirm this exactly: the `~^acme` pattern is unanchored and matches any hostname with that prefix, placed above other tenants' more specific rules, and a newer tenant (`acme-payments-processor`) onboarded 8 months ago shares that prefix - so its traffic, not acme-corp's own, is the traffic actually being misrouted onto acme-corp's dedicated instance. This matches every affected instance's logs showing it genuinely and correctly answering whatever request it received - the instance has no way to know the request was meant for a different tenant, since the misrouting happens entirely at the SNI layer before any request ever reaches it.",
    },
    {
      id: "load-balancer-connection-pooling-bug",
      label: "The load balancer's own connection pooling is reusing an established connection across different clients.",
      explanation:
        "This is a TLS-passthrough SNI router making a fresh routing decision per new connection based on each ClientHello's own server_name - it isn't terminating or pooling connections across different clients at the TLS layer at all, and the router's own configuration shows a clear, deterministic (if overly broad) matching rule fully explaining the observed pattern without needing to invoke any connection-reuse bug.",
    },
    {
      id: "dns-caching-mixing-tenant-hostnames",
      label: "DNS caching somewhere in the path is mixing up which hostname resolves to which backend IP.",
      explanation:
        "The SNI router receives connections already addressed to its own single, shared load-balancer IP - DNS resolution for any tenant's hostname all points to the same front-door address by design; the actual backend selection happens afterward, based on the TLS ClientHello's SNI field being matched against the router's own rules, which is exactly where the loose pattern match is documented to occur.",
    },
    {
      id: "acme-corp-instance-serving-cached-globex-data",
      label: "acme-corp's own instance has a caching bug and is serving stale data from a different tenant.",
      explanation:
        "Every affected instance's logs confirm it's genuinely receiving and correctly answering the specific request it got - there's no indication of any cross-tenant data being cached or mixed up within a single instance's own application logic; the instance simply doesn't know the request routed to it was actually meant for someone else.",
    },
  ],
  correctOptionId: "loose-prefix-regex-matches-newer-tenant-too",
  resolution: `\`sni-router-notes\` and the router's own configuration together explain the
exact mechanism: the SNI routing rule for the original \`acme-corp\` tenant
uses a loose, unanchored prefix pattern, \`~^acme\`, rather than a full,
exact hostname match - and it's positioned above other tenants' more
specific rules in a first-match-wins evaluation order. When a newer,
entirely unrelated enterprise customer, \`acme-payments-processor\`, was
onboarded 8 months later with a hostname that happens to also start with
"acme", its connections now match that older, loose rule before ever
reaching any rule actually meant for it - misrouting its traffic onto
acme-corp's dedicated instance instead. This explains every detail of
the report: a leak rate matching whatever fraction of total traffic
belongs to the newer tenant (not acme-corp's own traffic, which was
never actually the problem), and every affected instance's logs showing
it genuinely and correctly serving whatever request it received, with no
way to know the request was ever meant for someone else - the mistake
happens entirely at the SNI-matching layer, invisible to the application.

The fix is anchoring every tenant's SNI rule to its full, exact hostname,
removing any ambiguity from prefix matching:

\`\`\`nginx
map $ssl_preread_server_name $backend {
    "acme-corp.tenants.example.com"               acme_upstream;
    "acme-payments-processor.tenants.example.com" acme_payments_upstream;
    "globex-corp.tenants.example.com"             globex_upstream;
    default                                        deny_upstream;
}
\`\`\`

with a hard \`default\` that denies or safely rejects unmatched hostnames
rather than falling through to any specific tenant's backend. For any
SNI-based routing shared across multiple tenants - especially ones
handling potentially sensitive, tenant-isolated data - every rule should
use an exact, fully-anchored hostname match, never a prefix or loose
pattern; a shared-infrastructure misrouting bug like this one is a
genuine data-isolation incident, not just a routing inconvenience, and
is worth treating (and disclosing, per whatever contractual/compliance
obligations apply) accordingly.`,
};
