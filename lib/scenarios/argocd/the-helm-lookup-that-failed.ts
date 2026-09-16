import type { Scenario } from "../types";

export const theHelmLookupThatFailed: Scenario = {
  id: "the-helm-lookup-that-failed",
  title: "The Helm Lookup That Failed",
  subtitle: "vendor-integration-hub renders a completely empty Secret, but only sometimes",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "helm", "repo-server"],
  briefing: `"vendor-integration-hub"'s Helm chart uses the "lookup" template function
to check whether a Secret already exists in the cluster before generating
a fresh random value for it, so redeploys don't rotate credentials
unnecessarily. Most syncs work fine. Every so often, the sync renders the
Secret as completely empty, wiping out a working credential that then has
to be manually restored from a backup.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-helm-lookup-that-failed", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/vendor-integration-hub.git",
            targetRevision: "main",
            path: "chart",
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "vendor-integration" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced" }, health: { status: "Degraded" } },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "helm-lookup-notes", namespace: "vendor-integration" },
        spec: {
          data: {
            "secret.yaml.excerpt":
              "{{- $existing := lookup \"v1\" \"Secret\" .Release.Namespace \"vendor-api-token\" }}\napiVersion: v1\nkind: Secret\nmetadata:\n  name: vendor-api-token\nstringData:\n  token: {{ if $existing }}{{ $existing.data.token | b64dec }}{{ else }}{{ randAlphaNum 32 }}{{ end }}\n",
            "notes.md":
              "Helm's `lookup` function requires a live connection to a real\nKubernetes API server to query for the existing resource - it cannot\nwork against a purely offline/dry-run render, and critically, it returns\nan EMPTY result (not an error) if the query fails or the caller lacks\npermission, rather than failing the whole template render loudly. Most\nof the time, argocd-repo-server's lookup call succeeds fine. On syncs\nwhere it doesn't - intermittently, tied to brief periods of API server\nload/latency spikes seen elsewhere on this cluster around the same\ntimes - `lookup` silently returns an empty result instead of erroring,\nthe template's `{{ if $existing }}` branch takes the 'not found' path,\nand `randAlphaNum 32` generates a fresh, different random token,\noverwriting the real, working credential with a completely new,\ndisconnected one - indistinguishable in the rendered manifest from a\ngenuinely fresh Secret.",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "Helm's `lookup` function needs a live API server connection to work - what does it return if that lookup itself fails or times out, rather than erroring loudly?",
    "`kubectl get configmap helm-lookup-notes -n vendor-integration -o yaml` for exactly what happens when `lookup` comes back empty versus when the Secret genuinely doesn't exist yet.",
    "This isn't a deterministic template bug - it's tied to brief windows where a call to the live cluster from within the render step doesn't succeed as expected.",
  ],
  options: [
    {
      id: "lookup-silently-empty-on-transient-failure-regenerates-secret",
      label:
        "Helm's `lookup` function returns an empty result rather than erroring when its live API server query fails or times out - during intermittent windows of API server load, the lookup for the existing Secret silently comes back empty even though the Secret genuinely exists, and the chart's template logic can't distinguish that from a real first-time render, so it generates and applies a brand-new random token over the working one.",
      explanation:
        "`helm-lookup-notes` explains the exact failure mode: `lookup` fails silently (empty result, no error) rather than loudly on a transient API query failure, and the chart's own template logic has no way to distinguish 'genuinely doesn't exist yet' from 'lookup call didn't succeed this time' - both render identically as 'take the randAlphaNum branch.' Tied to brief periods of API server load elsewhere on the cluster, this intermittently overwrites a real, working credential with a fresh, unrelated one, exactly matching the 'works most of the time, occasionally wipes it' pattern.",
    },
    {
      id: "randalphanum-seed-not-deterministic",
      label: "randAlphaNum isn't seeded deterministically, so it generates a different value on every render regardless of lookup.",
      explanation:
        "randAlphaNum being non-deterministic is expected and fine for its actual purpose (generating a fresh token the *one time* it's genuinely needed) - it isn't the bug. The problem is the `lookup`-based branching logic incorrectly taking the 'generate fresh' path on syncs where the Secret genuinely already exists, not randomness in what gets generated once that branch is (incorrectly) taken.",
    },
    {
      id: "secret-being-pruned-then-recreated",
      label: "ArgoCD's pruning is deleting and recreating the Secret on every sync, resetting its value.",
      explanation:
        "The Secret is declared consistently in git on every sync - it isn't disappearing from the manifest and getting pruned, it's being re-rendered with genuinely different, unintended template output due to the lookup failure. This is a template-rendering issue, not a prune/re-create cycle.",
    },
    {
      id: "wrong-namespace-in-lookup-call",
      label: "The lookup call queries the wrong namespace, so it never finds the existing Secret.",
      explanation:
        "`.Release.Namespace` correctly resolves to the Application's actual destination namespace on every render, and the chart works correctly *most of the time* - a namespace mismatch would cause it to fail to find the Secret on every single render consistently, not intermittently tied to API load windows.",
    },
  ],
  correctOptionId: "lookup-silently-empty-on-transient-failure-regenerates-secret",
  resolution: `\`helm-lookup-notes\` explains precisely why this is intermittent rather
than a deterministic bug: Helm's \`lookup\` function needs a live query
against the real API server to check for the existing Secret, and
critically, it returns an *empty* result rather than an error when that
query fails or times out - which happens during brief windows of API
server load seen elsewhere on this cluster. The chart's template has no
way to distinguish "the Secret genuinely doesn't exist yet" from "the
lookup call itself just didn't succeed this time" - both take the same
\`{{ else }}\` branch, generating a fresh \`randAlphaNum 32\` token that
overwrites the real, working credential with a completely unrelated new
one, indistinguishable in the rendered manifest from a legitimate
first-time render.

The safest fix is removing the silent-failure risk from the critical
path entirely - stop relying on \`lookup\`'s fragile existence check for
something this consequential, and instead only ever create the Secret
once, explicitly, outside the normal templated-on-every-sync path:

\`\`\`yaml
{{- if not (lookup "v1" "Secret" .Release.Namespace "vendor-api-token") }}
apiVersion: v1
kind: Secret
metadata:
  name: vendor-api-token
  annotations:
    argocd.argoproj.io/sync-options: Prune=false  # never let a subsequent
                                                      # sync's regenerated
                                                      # manifest silently
                                                      # replace it either
stringData:
  token: {{ randAlphaNum 32 }}
{{- end }}
\`\`\`

combined with \`ignoreDifferences\` on this Secret's \`data\` field so
ArgoCD never attempts to reconcile it back toward a freshly-rendered
(and therefore lookup-dependent) value on any subsequent sync at all:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: ""
      kind: Secret
      name: vendor-api-token
      jsonPointers:
        - /data
\`\`\`

This way, the Secret is created once and then never re-rendered by
subsequent syncs at all - removing the intermittent lookup call from the
critical path entirely, rather than hoping it succeeds every time.`,
};
