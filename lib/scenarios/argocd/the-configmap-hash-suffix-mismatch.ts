import type { Scenario } from "../types";

export const theConfigmapHashSuffixMismatch: Scenario = {
  id: "the-configmap-hash-suffix-mismatch",
  title: "The ConfigMap Hash Suffix Mismatch",
  subtitle: "every sync for pricing-rules-api leaves an orphaned ConfigMap behind, forever",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "kustomize", "configmap-generator"],
  briefing: `"pricing-rules-api" uses Kustomize's configMapGenerator to produce a
content-hashed ConfigMap on every change, so the Deployment automatically
rolls when config changes. It works - deploys roll correctly - but every
single sync also leaves behind exactly one extra, unreferenced
ConfigMap with an old hash suffix that never gets pruned, and the
namespace now has dozens of them accumulating.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-configmap-hash-suffix-mismatch", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/pricing-rules-api.git", targetRevision: "main", path: "overlays/prod" },
          destination: { server: "https://kubernetes.default.svc", namespace: "pricing-rules" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced" }, health: { status: "Healthy" } },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pricing-rules-config-7dt29bfm4g", namespace: "pricing-rules", labels: { "app.kubernetes.io/instance": "the-configmap-hash-suffix-mismatch" }, annotations: { "argocd.argoproj.io/tracking-id": "the-configmap-hash-suffix-mismatch:/ConfigMap:pricing-rules/pricing-rules-config-7dt29bfm4g" } },
        spec: { data: { "rules.json": "{...current...}" } },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pricing-rules-config-2ck81hpq3x", namespace: "pricing-rules" },
        spec: { data: { "rules.json": "{...stale, from 2 deploys ago...}" } },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kustomize-generator-notes", namespace: "pricing-rules" },
        spec: {
          data: {
            "kustomization.yaml.excerpt":
              "configMapGenerator:\n  - name: pricing-rules-config\n    files:\n      - rules.json\ngeneratorOptions:\n  disableNameSuffixHash: false\n",
            "notes.md":
              "Kustomize's configMapGenerator correctly produces a fresh,\ncontent-hashed ConfigMap name on every change to rules.json, and Kustomize\nitself auto-updates every reference to the generated name across the\noverlay (the Deployment's volume/envFrom references get rewritten to the\nnew hash automatically) - this part works exactly as intended, which is\nwhy deploys correctly roll on config changes. But ArgoCD's pruning only\nremoves a resource it currently tracks as part of THIS Application whose\ndeclaration disappeared from git between syncs. The old-hash ConfigMap\nfrom two deploys ago has NO `app.kubernetes.io/instance` label and NO\n`argocd.argoproj.io/tracking-id` annotation at all - checking its history,\nit was originally created through a ONE-TIME manual `kubectl apply -k`\nrun directly from a developer's laptop during initial environment setup\nsix months ago, before this Application existed, using a hash that\nhappened to coincidentally collide with (and therefore get silently\nadopted/never replaced by) one of Kustomize's own early generated names -\nit has genuinely never been tracked by ArgoCD at all, at any point, and\nis not what's currently accumulating; the true accumulating pattern (per\na cluster-wide resource count check) is zero net growth per sync, this\nsingle untracked leftover is a one-time historical artifact, not a\nrecurring one.",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap -n pricing-rules --show-labels` - compare the currently-referenced ConfigMap's labels/annotations against the other, older one. Are they both actually tracked by this Application?",
    "Kustomize's configMapGenerator with hash suffixes is specifically designed so old, superseded generated ConfigMaps get pruned automatically by ArgoCD, since they simply stop being declared in git between syncs - check whether that pruning has actually been happening on every deploy, or if this one specific extra ConfigMap is something else entirely.",
    "`kubectl get configmap kustomize-generator-notes -n pricing-rules -o yaml` for the actual history of the older ConfigMap - was it ever created via a normal sync at all?",
  ],
  options: [
    {
      id: "old-configmap-is-one-time-manual-leftover-not-recurring",
      label:
        "Kustomize's hash-suffix generation and ArgoCD's pruning of superseded generated ConfigMaps are both actually working correctly on every sync - the one extra ConfigMap present is a one-time historical leftover from a manual kubectl apply months before this Application even existed, never tracked by ArgoCD at all, not a new one accumulating on every deploy as it appeared to at first glance.",
      explanation:
        "`kustomize-generator-notes` confirms the older ConfigMap has neither the tracking label nor the tracking-id annotation ArgoCD uses to know it owns a resource - it was created via a one-time manual `kubectl apply -k` six months ago, before the Application existed, and happened to collide with a hash Kustomize later also generated. It was never adopted or tracked by ArgoCD, so pruning (which only removes resources ArgoCD currently tracks whose declaration disappeared) correctly never touches it. The currently-referenced ConfigMap does carry proper tracking metadata and is correctly managed - confirming pruning genuinely works as intended on every real deploy, and this is a single historical artifact, not an ongoing leak.",
    },
    {
      id: "disableNameSuffixHash-misconfigured",
      label: "generatorOptions.disableNameSuffixHash is misconfigured, preventing old ConfigMaps from being cleaned up.",
      explanation:
        "`disableNameSuffixHash: false` is exactly the correct setting for content-hashed, auto-rolling ConfigMaps - if it were misconfigured (e.g. true), every deploy would reuse the same ConfigMap name and never roll the Deployment at all, which isn't what's happening; deploys are confirmed rolling correctly on every config change.",
    },
    {
      id: "argocd-prune-not-running-on-configmaps",
      label: "ArgoCD's automated prune isn't actually running on ConfigMap resources for this Application.",
      explanation:
        "The currently-active, properly-tracked ConfigMap confirms pruning genuinely does work for this Application's resources - if pruning weren't running at all, every single historically-generated hash-suffixed ConfigMap from every past deploy over six months would still be present, not just one specific untracked outlier.",
    },
    {
      id: "two-overlays-both-generate-configmap",
      label: "A second overlay is also generating a ConfigMap from the same base, causing a naming collision.",
      explanation:
        "There's no second overlay or Application involved - the older ConfigMap's origin is a one-time manual command run outside of any ArgoCD-managed sync at all, per its complete lack of tracking metadata, not a competing declaration from another overlay.",
    },
  ],
  correctOptionId: "old-configmap-is-one-time-manual-leftover-not-recurring",
  resolution: `\`kustomize-generator-notes\` clears this up: the currently-referenced
ConfigMap carries both the \`app.kubernetes.io/instance\` label and the
\`argocd.argoproj.io/tracking-id\` annotation, confirming ArgoCD properly
tracks and manages it - and by extension, that Kustomize's hash-suffix
generation and ArgoCD's pruning of superseded ConfigMaps are both
genuinely working correctly on every real deploy. The one extra
ConfigMap has neither piece of tracking metadata at all; it was created
via a one-time manual \`kubectl apply -k\` from a developer's laptop six
months ago, before this Application even existed, and happened to
coincidentally share a hash with one of Kustomize's own early generated
names. ArgoCD's pruning only ever removes resources it currently tracks
whose git declaration has disappeared - since it never tracked this
ConfigMap in the first place, it was never a candidate for pruning, on
any sync, ever. It isn't evidence of an ongoing leak; it's a single
leftover from before GitOps management of this service began.

Since it isn't managed by ArgoCD, cleaning it up is a plain manual
delete, safe to do once confirmed genuinely unreferenced by anything
live:

\`\`\`
kubectl get configmap pricing-rules-config-2ck81hpq3x -n pricing-rules -o yaml \\
  | grep -i "ownerReferences\\|tracking-id"   # confirm: no ArgoCD ownership
kubectl delete configmap pricing-rules-config-2ck81hpq3x -n pricing-rules
\`\`\`

Worth a quick namespace-wide check for any other resource lacking ArgoCD
tracking metadata from before this service was onboarded to GitOps - each
one is a similar one-time historical leftover, not something the current
sync process needs to change anything about.`,
};
