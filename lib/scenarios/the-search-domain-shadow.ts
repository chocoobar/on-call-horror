import type { Scenario } from "./types";

export const theSearchDomainShadow: Scenario = {
  id: "the-search-domain-shadow",
  title: "The Search Domain Shadow",
  subtitle: "a health-check tool built for every other environment quietly connects to the wrong 'api' in staging",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "search-domain", "staging"],
  briefing: `A shared internal diagnostics tool, "svc-doctor," was rolled out to every
namespace to run periodic connectivity checks against each environment's
public API endpoint, configured with the short name "api" everywhere for
consistency. It works correctly in production and in two other staging
namespaces. In "staging-eu" specifically, its checks report success, but
against completely wrong data - as if it's silently hitting a different
service entirely.`,
  constraints: [
    "svc-doctor's configuration is byte-for-byte identical across every namespace it's deployed in - confirmed via diff.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "svc-doctor", namespace: "staging-eu", labels: { app: "svc-doctor" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "10d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "svc-doctor-6n7o8p-q9r0s", namespace: "staging-eu", labels: { app: "svc-doctor" } },
        status: { phase: "Running", containerStatuses: [{ name: "svc-doctor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "svc-doctor": [
            "2026-09-15T08:00:01.010Z INFO  svcdoctor.Checker - probing target 'api' for staging-eu",
            "2026-09-15T08:00:01.040Z INFO  svcdoctor.Checker - resolved 'api' -> 10.96.200.4 (via search domain expansion)",
            "2026-09-15T08:00:01.090Z INFO  svcdoctor.Checker - check passed: 200 OK, body contains unexpected field 'legacy_billing_version'",
          ],
        },
        age: "10d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "api", namespace: "staging-eu", labels: { app: "public-api" } },
        spec: { clusterIP: "10.96.201.9", selector: { app: "public-api" }, ports: [{ port: 443 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "api", namespace: "legacy-billing", labels: { app: "legacy-billing-api" } },
        spec: { clusterIP: "10.96.200.4", selector: { app: "legacy-billing-api" }, ports: [{ port: 443 }] },
        age: "3y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "staging-eu-dns-notes", namespace: "staging-eu" },
        spec: {
          data: {
            "notes.md":
              "The `staging-eu` namespace was created by cloning an old namespace\nmanifest from `legacy-billing`, which included a namespace-level custom\n`dnsConfig` search-order override applied via an admission webhook years\nago - it prepends `legacy-billing.svc.cluster.local` to the standard\nsearch list for every pod in `staging-eu`, ahead of `staging-eu.svc.\ncluster.local` itself. This override was never intentional for `staging-\neu` and nobody realized it carried over from the clone. Every other\nnamespace svc-doctor runs in has the normal, default search order,\nwhere a pod's own namespace is always searched first.\n",
          },
        },
        age: "10d",
      },
    ],
  },
  hints: [
    "svc-doctor's own log shows resolving `api` to `10.96.200.4` - but `staging-eu`'s own `api` Service has ClusterIP `10.96.201.9`. Whose IP is `10.96.200.4` actually?",
    "`kubectl get pod svc-doctor-6n7o8p-q9r0s -n staging-eu -o yaml` (or check the pod's `/etc/resolv.conf`) - what does this namespace's DNS search order actually look like, and is it the standard default?",
    "`kubectl get configmap staging-eu-dns-notes -n staging-eu -o yaml` - a namespace's own Service should always be searched first for a bare short name. Is that actually happening here?",
  ],
  options: [
    {
      id: "legacy-billing-search-suffix-shadows-own-namespace",
      label:
        "`staging-eu` inherited a leftover, unintentional DNS search-order override from being cloned off the `legacy-billing` namespace, which prepends `legacy-billing.svc.cluster.local` *ahead of* `staging-eu.svc.cluster.local` in the search list - so a bare hostname like `api` resolves against `legacy-billing`'s own `api` Service first, successfully, before the resolver would ever try `staging-eu`'s own (also existing, but shadowed) `api` Service, silently pointing svc-doctor at the wrong backend entirely.",
      explanation:
        "svc-doctor's log shows `api` resolving to `10.96.200.4`, which matches `legacy-billing`'s `api` Service exactly - not `staging-eu`'s own `api` Service at `10.96.201.9`. `staging-eu-dns-notes` explains why: a leftover search-order override, carried over unintentionally from cloning the namespace manifest, puts `legacy-billing`'s suffix ahead of the namespace's own in the search list. Since svc-doctor's own config is confirmed identical everywhere, the difference has to be namespace-level DNS configuration - exactly what's documented here, and exactly matching the response body's telltale `legacy_billing_version` field.",
    },
    {
      id: "svc-doctor-config-drift-in-staging-eu",
      label: "svc-doctor's own configuration in `staging-eu` was accidentally changed to point at a different target.",
      explanation:
        "svc-doctor's configuration is confirmed byte-for-byte identical across every namespace via diff - there's no per-namespace drift in the tool's own config; the difference has to be something about how the same configured value (`api`) actually resolves in this specific namespace.",
    },
    {
      id: "staging-eu-api-service-wrong-selector",
      label: "staging-eu's own `api` Service has the wrong selector and is routing to legacy-billing's pods.",
      explanation:
        "`staging-eu`'s own `api` Service has a distinct ClusterIP (`10.96.201.9`) and its own correctly-scoped selector - it isn't misrouting internally. The resolved address svc-doctor actually used (`10.96.200.4`) belongs to an entirely different Service in a different namespace, reached via DNS search-order expansion, not through `staging-eu`'s own Service at all.",
    },
    {
      id: "coredns-cache-poisoned",
      label: "CoreDNS's cache has been poisoned with a stale or incorrect record for `api`.",
      explanation:
        "There's no indication of any cache corruption - the resolution svc-doctor gets is a completely valid, correct answer for a different, legitimately-existing Service; the issue is which search suffix gets tried and matches first, a search-order configuration difference, not any incorrect or stale DNS data.",
    },
  ],
  correctOptionId: "legacy-billing-search-suffix-shadows-own-namespace",
  resolution: `svc-doctor's own log shows \`api\` resolving to \`10.96.200.4\` - which
matches \`legacy-billing\`'s \`api\` Service exactly, not \`staging-eu\`'s own
(equally real, equally present) \`api\` Service at \`10.96.201.9\`.
\`staging-eu-dns-notes\` explains why: the namespace was created by cloning
an old \`legacy-billing\` manifest, which carried along a namespace-level
DNS search-order override applied via an admission webhook - prepending
\`legacy-billing.svc.cluster.local\` *ahead of* the namespace's own
\`staging-eu.svc.cluster.local\` in the search list. A bare hostname like
\`api\` gets tried against the first search suffix first; since
\`legacy-billing\` now comes before the pod's own namespace, its \`api\`
Service wins every time, entirely shadowing \`staging-eu\`'s own -
matching svc-doctor's config being confirmed identical everywhere (the
difference is purely namespace-level DNS configuration) and the telltale
\`legacy_billing_version\` field in the response body.

The fix is removing the leftover override so \`staging-eu\`'s own
namespace is searched first, as it should be by default:

\`\`\`bash
kubectl get pod svc-doctor-6n7o8p-q9r0s -n staging-eu -o jsonpath='{.spec.dnsConfig}'
# remove the custom dnsConfig / admission-webhook override that
# prepends legacy-billing.svc.cluster.local ahead of the pod's own namespace
\`\`\`

or, more durably, correcting whatever admission webhook or namespace
template is still injecting this override so it doesn't recur on future
namespace clones. As a general safeguard, any service making calls by
short/unqualified name should prefer the fully-qualified form
(\`api.staging-eu.svc.cluster.local\`) specifically to avoid depending on
search-order correctness at all - a namespace-level DNS override like
this one produces silent, successful-looking wrong answers rather than
any visible failure.`,
};
