import type { Scenario } from "./types";

export const theTagStrategyMismatch: Scenario = {
  id: "the-tag-strategy-mismatch",
  title: "The Tag Strategy Mismatch",
  subtitle: "media-encoder keeps redeploying the same image over and over, all night",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "image-updater", "tag-strategy"],
  briefing: `"media-encoder" uses ArgoCD Image Updater with a "digest" update strategy
so it always runs the latest build of a floating "latest" tag. Overnight,
the Application synced eleven times, each one against the exact same
image digest as before - churning restarts on a service with expensive
warm-up costs, with nothing actually changing.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-tag-strategy-mismatch",
          namespace: "argocd",
          annotations: {
            "argocd-image-updater.argoproj.io/image-list": "encoder=registry.example.com/media-encoder:latest",
            "argocd-image-updater.argoproj.io/encoder.update-strategy": "digest",
            "argocd-image-updater.argoproj.io/write-back-method": "argocd",
          },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/media-encoder.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "media" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "e8f9a0b" }, health: { status: "Healthy" } },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "image-updater-writeback-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "write-back-method is set to `argocd`, which stores the resolved image\nreference directly as an override on the Application object itself\n(spec.source.helm.parameters or a kustomize image override, depending on\ntooling) rather than committing anything back to git. The digest for\nregistry.example.com/media-encoder:latest genuinely has not changed\novernight - confirmed by comparing the digest recorded in each of the\nlast 11 sync operations' results, all identical. Image Updater's own\ncomponent, when using the `argocd` write-back method, re-applies its\nresolved override via a fresh Application patch on every single polling\ncycle regardless of whether the resolved value actually changed from the\nprevious cycle - and because selfHeal is on, each of those patches\nis treated by ArgoCD as a new spec change requiring a fresh sync.",
          },
        },
        age: "10h",
      },
    ],
  },
  hints: [
    "`argocd app history the-tag-strategy-mismatch` - compare the resolved image digest across the last several sync operations. Is it actually changing between them?",
    "`kubectl get configmap image-updater-writeback-notes -n argocd -o yaml` for how the `argocd` write-back method actually behaves on each polling cycle.",
    "Two different things can each individually 'work correctly' and still combine to cause needless churn: Image Updater re-patching the same value every cycle, and selfHeal treating every patch as something to sync.",
  ],
  options: [
    {
      id: "writeback-repatches-unchanged-value-every-cycle",
      label:
        "Image Updater's `argocd` write-back method re-applies its resolved image override as a fresh patch to the Application on every polling cycle, even when the resolved digest hasn't actually changed - and because selfHeal is on, each of those patches is treated as a new spec change requiring a sync, producing repeated no-op redeploys all night even though the underlying image genuinely never changed.",
      explanation:
        "`image-updater-writeback-notes` confirms the digest recorded across all 11 recent sync operations is identical - the image itself truly hasn't changed. The `argocd` write-back method re-applies its resolved value on every cycle regardless of whether it changed from before, and each of those patches, combined with selfHeal being on, is treated as new drift worth syncing - producing the repeated no-op redeploys, driven by the write-back mechanism's own behavior rather than any real image update.",
    },
    {
      id: "registry-serving-new-digest-each-pull",
      label: "The container registry is serving a genuinely different image digest on every pull due to a caching bug on its end.",
      explanation:
        "The sync operation history shows the *same* recorded digest across all 11 syncs - if the registry were serving different digests each time, each sync's result would show a distinct, changing digest value, not identical ones repeated eleven times.",
    },
    {
      id: "selfheal-alone-explains-churn",
      label: "selfHeal alone, independent of Image Updater, is causing the repeated syncs.",
      explanation:
        "selfHeal only reconciles drift against whatever the Application's current spec declares - it doesn't generate new drift on its own. The actual driver of repeated changes to reconcile against is Image Updater's write-back re-patching the same (unchanged) value every cycle; selfHeal is just faithfully reacting to each of those patches as if it were new.",
    },
    {
      id: "update-strategy-should-be-latest",
      label: "The update-strategy should be 'latest' instead of 'digest' for a floating tag.",
      explanation:
        "'digest' is actually the correct and recommended strategy for tracking a floating tag like `latest` by its resolved content rather than by tag name alone - changing strategy wouldn't address the actual issue, which is the write-back method re-applying an unchanged value on every cycle regardless of which update strategy resolved it.",
    },
  ],
  correctOptionId: "writeback-repatches-unchanged-value-every-cycle",
  resolution: `\`argocd app history\` shows the resolved image digest is identical across
all 11 of last night's sync operations - the image genuinely never
changed. \`image-updater-writeback-notes\` explains the actual mechanism:
with \`write-back-method: argocd\`, Image Updater re-applies its resolved
image override as a fresh patch to the Application object on every
polling cycle, regardless of whether the value differs from what it
patched last cycle. Combined with selfHeal being enabled, ArgoCD treats
each of those patches as a new spec change worth reconciling, triggering
a full sync - even though nothing about the actual image or the intended
end state changed at all.

The most direct fix is switching Image Updater's write-back method to
git, which only commits (and therefore only triggers a sync) when the
resolved value actually changes:

\`\`\`yaml
metadata:
  annotations:
    argocd-image-updater.argoproj.io/write-back-method: git
    argocd-image-updater.argoproj.io/git-branch: main
\`\`\`

This also has the side benefit of making every image update visible as a
normal, reviewable git commit instead of an invisible Application patch.
If staying on the \`argocd\` write-back method is required for some
reason, Image Updater's own idempotency behavior around re-patching
unchanged values would need to improve upstream - the git write-back
path is the well-supported way to avoid this churn today.`,
};
