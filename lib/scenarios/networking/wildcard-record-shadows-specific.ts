import type { Scenario } from "../types";

export const wildcardRecordShadowsSpecific: Scenario = {
  id: "wildcard-record-shadows-specific",
  title: "The Wildcard That Ate The Subdomain",
  subtitle: "a brand-new, specific DNS record exists. everything keeps resolving somewhere else.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "wildcard", "split-dns"],
  briefing: `A dedicated DNS record was just created for "partner-sandbox.example.com"
to point at a new isolated testing environment. Every lookup for that
exact hostname, from anywhere, keeps returning the production
environment's IP instead - the one the wildcard "*.example.com" record
has always pointed at.`,
  constraints: [
    "The new partner-sandbox.example.com A record is confirmed to exist in the DNS zone, with the correct IP, and has propagated fully according to the DNS provider's own status page.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dns-zone-notes", namespace: "platform2" },
        spec: {
          data: {
            "notes.md":
              "The example.com DNS zone has had a wildcard record,\n`*.example.com A 203.0.113.10` (pointing at production), in place for\nyears, intentionally catching any undefined subdomain and routing it to\nproduction as a safe default. A new, specific record was just added:\n`partner-sandbox.example.com A 198.51.100.30`. Per standard DNS\nresolution rules, an exact-match record always takes precedence over a\nwildcard record covering the same name - *when both are hosted by the\nsame authoritative nameserver and queried together*. This zone, however,\nis split across two different DNS providers as a migration-in-progress:\nthe wildcard record lives on the *old* authoritative nameservers (still\nlisted first in the domain's own NS delegation), while the new specific\nrecord was created on the *new* provider, which the domain's NS records\ndon't fully point to yet. Resolvers are still being referred to the old\nnameservers first, which only know about the wildcard and have never\nheard of the new specific record at all.\n",
          },
        },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dns-lookup-trace", namespace: "platform2" },
        spec: {
          data: {
            "trace.txt":
              "$ dig +trace partner-sandbox.example.com\n...\nexample.com.  NS  ns1.old-dns-provider.net.\nexample.com.  NS  ns2.old-dns-provider.net.\n...\n;; ANSWER SECTION:\npartner-sandbox.example.com. 300 IN A 203.0.113.10   ; from *.example.com wildcard, old-dns-provider\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "The new record is confirmed to exist with the right IP on 'the DNS provider' - but is that the same provider actually authoritative for the zone right now, according to the domain's own NS delegation?",
    "`kubectl get configmap dns-lookup-trace -n platform2 -o yaml` - a `dig +trace` shows which nameservers are actually authoritative for `example.com` today, and which one answered. Does it match where the new record was created?",
    "An exact-match record only wins over a wildcard when both are visible to the *same* authoritative answer - a specific record sitting on a nameserver nobody is actually querying yet doesn't help at all.",
  ],
  options: [
    {
      id: "specific-record-on-wrong-nameserver-not-yet-delegated",
      label:
        "The zone is mid-migration between two DNS providers, and the domain's own NS delegation still points to the old provider, which only ever knew about the long-standing wildcard record - the new, specific `partner-sandbox.example.com` record was created on the new provider, which nothing is actually querying yet, so every real lookup still gets answered by the old nameservers via the wildcard, and the new specific record - correct in every way, just hosted in the wrong place for right now - has no effect on live resolution at all.",
      explanation:
        "The `dig +trace` output confirms the domain's NS records still point to `old-dns-provider.net`, and the actual answer received comes explicitly from the wildcard on that old provider - not from the new provider the specific record was created on. This isn't a wildcard-vs-specific precedence issue in the usual sense (an exact match genuinely would win if both were on the same authoritative server); it's that the specific record is sitting somewhere nobody is actually asking yet, because the NS delegation migration to the new provider hasn't completed.",
    },
    {
      id: "wildcard-always-wins-regardless",
      label: "A wildcard DNS record always takes precedence over a more specific record, regardless of provider.",
      explanation:
        "This isn't how DNS resolution actually works - per the DNS specification, an exact-match record takes precedence over a wildcard covering the same name, whenever both are visible to the same authoritative answer. The behavior observed here is specifically because the specific record lives on a nameserver that isn't authoritative yet, not because wildcards categorically override specific records.",
    },
    {
      id: "ttl-caching-old-wildcard-answer",
      label: "A cached copy of the wildcard's old answer, from before the new record was created, just hasn't expired yet.",
      explanation:
        "The `dig +trace` output shows a fresh, live authoritative answer being generated in real time by the old nameservers via the wildcard rule - it's not a cached response at all, it's the actual current, correct answer from whichever nameserver is presently authoritative, which still doesn't know about the new record.",
    },
    {
      id: "new-record-typo-in-hostname",
      label: "The new record was created with a typo in the hostname that doesn't quite match what's being looked up.",
      explanation:
        "The new record is confirmed to exist with the exact correct hostname and IP on the new provider - there's no typo in the record itself; the issue is that the new provider hosting it isn't yet the one resolvers are actually being referred to by the domain's own NS delegation.",
    },
  ],
  correctOptionId: "specific-record-on-wrong-nameserver-not-yet-delegated",
  resolution: `The \`dig +trace\` output shows the domain's own NS delegation still
pointing at \`old-dns-provider.net\`, and the actual answer received for
\`partner-sandbox.example.com\` explicitly comes from that old provider's
long-standing wildcard rule - not from anything on the new provider the
specific record was created on. \`dns-zone-notes\` confirms the underlying
situation: the zone is mid-migration between two DNS providers, and
while an exact-match record genuinely does take precedence over a
wildcard *when both are visible to the same authoritative nameserver*,
that's not what's happening here. The new, correctly-configured specific
record exists only on the new provider, which the domain's NS records
don't fully point to yet - so no resolver actually queries it. Every real
lookup keeps landing on the old nameservers, which have never heard of
the new record at all and simply fall through to their own wildcard.

The fix is completing the NS delegation cutover to the new provider (or,
as an interim step, replicating the new specific record onto the *old*
provider until the cutover finishes):

\`\`\`bash
# interim: add the same A record on the OLD provider too,
# so it's answered correctly regardless of which NS is queried
partner-sandbox.example.com.  300  IN  A  198.51.100.30

# durable: complete the registrar-level NS delegation to the new provider
# and verify with dig +trace that new nameservers are actually being used
\`\`\`

Any DNS provider migration needs the NS delegation cutover treated as
the actual point of truth for "is this live yet" - creating records on a
new provider ahead of that cutover accomplishes nothing for real
traffic, since resolvers keep following the domain's existing NS records
to the old provider until the registrar-level delegation itself changes.`,
};
