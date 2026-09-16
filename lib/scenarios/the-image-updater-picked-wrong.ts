import type { Scenario } from "./types";

export const theImageUpdaterPickedWrong: Scenario = {
  id: "the-image-updater-picked-wrong",
  title: "The Image Updater Picked Wrong",
  subtitle: "gateway-service is somehow running a two-month-old image again",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "image-updater", "tags"],
  briefing: `"gateway-service" uses ArgoCD Image Updater to auto-deploy whatever image
tag matches a semver constraint on every push to the registry. This
morning it rolled back to a build from two months ago, even though the CI
pipeline has been pushing fresh nightly builds the whole time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-image-updater-picked-wrong",
          namespace: "argocd",
          annotations: {
            "argocd-image-updater.argoproj.io/image-list": "gateway=registry.example.com/gateway-service",
            "argocd-image-updater.argoproj.io/gateway.update-strategy": "semver",
            "argocd-image-updater.argoproj.io/gateway.allow-tags": "regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/gateway-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "gateway" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "f1e2d3c" }, health: { status: "Healthy" } },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gateway-registry-tags-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "Tags currently in the registry for gateway-service:\n  v3.4.0        (2 months old, previously deployed)\n  v3.4.1        (2 months old)\n  nightly-0912  (3 days old)\n  nightly-0914  (1 day old)\n  nightly-0915  (this morning)\n\nCI has been pushing `nightly-YYYYMMDD` tags daily for weeks - none of\nthem match the image-list's semver `allow-tags` pattern\n(`^v[0-9]+\\.[0-9]+\\.[0-9]+$`), so Image Updater ignores every nightly tag\nentirely and keeps selecting the highest semver-looking tag it can find,\nwhich is still v3.4.1 from 2 months ago.",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get application the-image-updater-picked-wrong -n argocd -o yaml` - check the `argocd-image-updater.argoproj.io/*` annotations, especially `allow-tags`.",
    "`kubectl get configmap gateway-registry-tags-notes -n argocd -o yaml` for the actual list of tags currently in the registry.",
    "Image Updater only ever considers tags matching its configured `allow-tags` pattern - anything else, no matter how recent, is invisible to it.",
  ],
  options: [
    {
      id: "allow-tags-excludes-nightly",
      label:
        "CI switched to pushing `nightly-YYYYMMDD` tags, but the Application's `allow-tags` regexp only matches strict semver tags like v3.4.1 - every nightly build is invisible to Image Updater, which keeps redeploying the newest semver tag it can actually see, an old one from before the nightly switch.",
      explanation:
        "The `allow-tags` annotation is a regexp that only matches `vX.Y.Z`-style tags. `gateway-registry-tags-notes` confirms CI has switched entirely to `nightly-YYYYMMDD` tags for weeks - none of which match that pattern - so Image Updater's semver strategy keeps selecting the highest matching tag it can find, which happens to be a 2-month-old v3.4.1, exactly matching what actually got deployed.",
    },
    {
      id: "registry-credentials-stale",
      label: "Image Updater's registry credentials expired, so it's using a cached, stale tag list.",
      explanation:
        "If credentials had failed, Image Updater would typically stop updating entirely or log an auth error - here it's actively and successfully selecting a real, valid tag (v3.4.1), just the wrong one, because of the tag pattern it's filtering by, not a stale/cached view of the registry.",
    },
    {
      id: "wrong-registry-configured",
      label: "The Application points Image Updater at the wrong container registry entirely.",
      explanation:
        "The selected tag v3.4.1 genuinely exists in the correct registry (per the notes) - if the registry itself were wrong, Image Updater wouldn't be finding any valid tag at all, let alone one that's a real, previously-deployed build from this same registry's history.",
    },
    {
      id: "update-strategy-wrong-easy",
      label: "The update-strategy should be 'latest' instead of 'semver', so it picks up newer builds.",
      explanation:
        "Switching strategies wouldn't fix the actual problem: the nightly tags are excluded by `allow-tags` regardless of which selection strategy picks among the tags that pass the filter. The fix has to be in what tags are allowed through, not in how the allowed tags are ranked.",
    },
  ],
  correctOptionId: "allow-tags-excludes-nightly",
  resolution: `\`gateway-registry-tags-notes\` shows the mismatch directly: CI has been
pushing \`nightly-YYYYMMDD\` tags for weeks, but the Application's
\`argocd-image-updater.argoproj.io/gateway.allow-tags\` annotation is a
regexp that only matches strict \`vX.Y.Z\` semver tags. Every nightly build
is completely invisible to Image Updater's tag selection - it faithfully
keeps deploying the newest tag that actually matches its filter, which is
\`v3.4.1\` from two months ago, exactly what's live.

Fix the allow-tags pattern to match what CI is actually producing now (or
switch CI back to semver tags, if nightly wasn't an intentional
convention change):

\`\`\`yaml
metadata:
  annotations:
    argocd-image-updater.argoproj.io/gateway.allow-tags: regexp:^nightly-[0-9]{4}$
    argocd-image-updater.argoproj.io/gateway.update-strategy: latest
\`\`\`

(\`latest\` by build/push time is the right strategy for date-stamped tags
like these - semver ordering doesn't apply to them.) Once the pattern
matches the real tag format, Image Updater picks up today's nightly on
its next poll and deploys it automatically.`,
};
