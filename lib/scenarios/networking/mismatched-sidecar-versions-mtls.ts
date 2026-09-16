import type { Scenario } from "../types";

export const mismatchedSidecarVersionsMtls: Scenario = {
  id: "mismatched-sidecar-versions-mtls",
  title: "The Sidecar Versions That Couldn't Agree",
  subtitle: "the mesh upgrade went fine everywhere except one call path, which now fails every single handshake",
  difficulty: "hard",
  type: "fix",
  topic: "networking",
  timeMinutes: 25,
  tags: ["service-mesh", "mtls", "canary-upgrade"],
  briefing: `The mesh's sidecar proxy version is being upgraded gradually, canary-style,
across the cluster - most namespaces have already moved to the new
version, with a handful still pending. "settlement-engine" (on the new
sidecar version) has started failing every mTLS handshake specifically
against "ledger-api" (still on the old sidecar version), while continuing
to work fine against every other service still on the old version.`,
  constraints: [
    "Every other new-version-to-old-version call pair in the mesh continues to work correctly during this gradual upgrade - this failure is isolated specifically to settlement-engine calling ledger-api.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "settlement-engine", namespace: "settlement", labels: { app: "settlement-engine" } },
        spec: { replicas: 2, template: { metadata: { annotations: { "sidecar.istio.io/proxyImage": "istio/proxyv2:1.22.0" } } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ledger-api", namespace: "ledger3", labels: { app: "ledger-api" } },
        spec: { replicas: 2, template: { metadata: { annotations: { "sidecar.istio.io/proxyImage": "istio/proxyv2:1.19.4" } } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "security.istio.io/v1",
        kind: "PeerAuthentication",
        metadata: { name: "ledger-api-strict-tls13", namespace: "ledger3" },
        spec: {
          selector: { matchLabels: { app: "ledger-api" } },
          mtls: { mode: "STRICT" },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ledger-api-tls-min-version", namespace: "ledger3" },
        spec: {
          data: {
            "envoy-tls-notes.md":
              "ledger-api's namespace carries a custom `EnvoyFilter`, added a year ago\nfor an unrelated compliance requirement, hardcoding\n`tls_minimum_protocol_version: TLSv1_3` on inbound mTLS listeners -\nsupported fine by proxy versions from that era onward. Separately, the\nnew sidecar proxy version (1.22.0) being canaried across the mesh\nshipped a change to its *default* TLS cipher suite preference order for\nmesh mTLS, preferring a cipher suite that proxy version 1.19.4 (still\nrunning on ledger-api) does not support at all under TLS 1.3 - 1.19.4\nonly supports that cipher suite under TLS 1.2, which the EnvoyFilter's\nhardcoded TLS 1.3 minimum explicitly disallows entirely, leaving no\ncipher suite both sides can agree on. Every other old-version service in\nthe mesh (without this same custom EnvoyFilter forcing TLS 1.3\nminimum) still permits TLS 1.2 as a fallback, where the older proxy\nversion happily supports the same cipher suite the new version prefers -\nwhich is exactly why this incompatibility is isolated to calls against\nledger-api specifically.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "Every other new-to-old sidecar version pairing in the mesh works fine during this canary upgrade - what's different about ledger-api specifically, versus every other still-on-old-version service?",
    "`kubectl get peerauthentication,envoyfilter -n ledger3 -o yaml` - does ledger-api's namespace have any custom TLS configuration beyond the mesh's own defaults?",
    "`kubectl get configmap ledger-api-tls-min-version -n ledger3 -o yaml` - the new sidecar version changed its default cipher suite preference; does the old sidecar version support that same cipher suite under every TLS version, or only some?",
  ],
  options: [
    {
      id: "tls13-minimum-plus-cipher-mismatch-leaves-no-common-suite",
      label:
        "ledger-api's namespace has a custom EnvoyFilter hardcoding a TLS 1.3 minimum on inbound mTLS, added for an unrelated compliance requirement - the new sidecar version's changed default cipher suite preference isn't supported by the old sidecar version (still running on ledger-api) under TLS 1.3, only under TLS 1.2, which the EnvoyFilter's hardcoded minimum explicitly forbids falling back to; every other old-version service in the mesh, lacking this same TLS 1.3 floor, still permits a TLS 1.2 fallback where both versions agree fine, which is exactly why this handshake failure is isolated specifically to calls against ledger-api.",
      explanation:
        "`ledger-api-tls-min-version` lays out the full chain: a namespace-specific EnvoyFilter forcing TLS 1.3 minimum (unrelated to and predating the sidecar canary), combined with the new sidecar version's changed cipher suite default that the old version only supports under TLS 1.2 - a fallback this specific namespace's hardcoded minimum disallows. Every other service still on the old sidecar version lacks that same TLS 1.3 floor and can freely fall back to TLS 1.2, where both proxy versions agree on a shared cipher suite - explaining precisely why the failure is isolated to settlement-engine calling ledger-api and nothing else in the mesh.",
    },
    {
      id: "settlement-engine-cert-not-trusted-by-ledger-api",
      label: "settlement-engine's sidecar certificate isn't trusted by ledger-api's root CA after the version upgrade.",
      explanation:
        "Both services participate in the same mesh CA trust domain, unaffected by sidecar proxy version - a genuine trust/CA issue would likely affect settlement-engine's calls to every service, not be isolated specifically to one particular old-version peer while every other old-version peer works fine.",
    },
    {
      id: "peerauthentication-strict-mode-blocking-new-version",
      label: "ledger-api's STRICT PeerAuthentication mode is specifically rejecting the new sidecar version.",
      explanation:
        "STRICT mTLS mode requires a valid mesh-issued client certificate from any caller - it isn't version-aware and doesn't distinguish between sidecar proxy versions at all. Every other old-version service in the mesh, receiving calls from new-version callers, continues to work fine, which rules out STRICT mode itself (a policy every one of these services shares in some form) as the version-specific cause.",
    },
    {
      id: "network-latency-during-canary-causing-handshake-timeout",
      label: "Increased network latency during the gradual canary rollout is causing handshake timeouts specifically on this path.",
      explanation:
        "A pure latency/timeout issue wouldn't be isolated so specifically and consistently to one particular pair of services out of the entire mesh undergoing the same gradual rollout - the failure described is a handshake failure (an inability to agree on TLS parameters), not a timeout, and namespace-specific TLS configuration provides a much more precise, deterministic explanation matching the exact isolation observed.",
    },
  ],
  correctOptionId: "tls13-minimum-plus-cipher-mismatch-leaves-no-common-suite",
  resolution: `\`ledger-api-tls-min-version\` traces the full chain of causes. ledger-api's
namespace carries a custom \`EnvoyFilter\`, added a year ago for an
unrelated compliance requirement, hardcoding a TLS 1.3 minimum on all
inbound mTLS connections. Separately and much more recently, the new
sidecar proxy version (1.22.0) being canaried across the mesh shipped a
changed default cipher suite preference for mesh mTLS - one the older
proxy version still running on ledger-api (1.19.4) only supports under
TLS 1.2, not TLS 1.3. Combined, there's no cipher suite both sides can
agree on for this specific pairing: the new version wants its new
preferred cipher, the old version can only offer it under TLS 1.2, and
ledger-api's own hardcoded TLS 1.3 minimum forbids falling back that far.
Every other service still on the old sidecar version, lacking this same
namespace-specific TLS 1.3 floor, can freely negotiate down to TLS 1.2
where both proxy versions agree fine - exactly why this handshake
failure is isolated specifically to calls against ledger-api and nothing
else in the mesh during the same gradual rollout.

There are two independent ways to resolve this, and either alone would
work: accelerating ledger-api's own sidecar upgrade to the new version
(closing the gap directly), or, as a faster interim fix, relaxing the
namespace's TLS floor to allow the fallback path that already works
everywhere else:

\`\`\`yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: ledger-api-tls-min-version
  namespace: ledger3
spec:
  configPatches:
    - applyTo: LISTENER
      patch:
        operation: MERGE
        value:
          tls_minimum_protocol_version: TLSv1_2   # was TLSv1_3
\`\`\`

with a plan to re-tighten back to TLS 1.3 once ledger-api's own sidecar
is upgraded to a version that supports the new cipher suite under it.
Any per-namespace TLS floor layered on top of a mesh-wide default is
worth explicitly re-validating against every in-flight sidecar version
canary - a hardcoded minimum that was perfectly safe against the mesh's
old default cipher preference can become an unexpected compatibility
wall the moment that default changes underneath it.`,
};
