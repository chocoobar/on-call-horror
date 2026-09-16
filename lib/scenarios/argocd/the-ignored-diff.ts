import type { Scenario } from "../types";

export const theIgnoredDiff: Scenario = {
  id: "the-ignored-diff",
  title: "The Ignored Diff",
  subtitle: "someone changed the production image tag by hand, and ArgoCD hasn't said a word",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "drift", "self-heal"],
  briefing: `A post-incident review found that "user-profile-api" was running a
different image tag than what's in git for the better part of a week - a
hotfix someone applied directly with \`kubectl edit\` during an incident,
and then forgot to also commit to git. ArgoCD's Application has shown
Synced the entire time, with selfHeal enabled.`,
  constraints: [
    "selfHeal is confirmed working correctly for this Application in general - a manual scale change was tested and reverted within a minute during the same investigation.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "user-profile-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/user-profile-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "profiles" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
          ignoreDifferences: [
            { group: "apps", kind: "Deployment", jsonPointers: ["/spec/template/spec/containers/0/image"] },
          ],
        },
        status: { sync: { status: "Synced", revision: "7a8b9c0d1e2f" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "user-profile-api", namespace: "profiles", labels: { app: "user-profile-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-ignore-diff-history", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "This `ignoreDifferences` entry was added 8 months ago for a *different*\nDeployment in this same repo (`user-profile-worker`, since retired) that\nhad its replica count managed by an HPA and needed ArgoCD to stop\nfighting the HPA over `spec.replicas`. When that Deployment was removed,\nthe `ignoreDifferences` block was copy-pasted into `user-profile-api`'s\nApplication as a starting point for a similar HPA setup that was later\ndecided against - but the block itself, now targeting `containers/0/image`\ninstead of `replicas` due to a copy-paste edit, was never removed.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get application user-profile-api -n argocd -o yaml` - look at `spec.syncPolicy.ignoreDifferences`. What field, exactly, is ArgoCD told to stop comparing?",
    "`selfHeal` can only correct drift on fields ArgoCD is actually watching for differences - `ignoreDifferences` removes a field from that comparison entirely, which is a very different thing from selfHeal being broken.",
    "`kubectl get configmap argocd-ignore-diff-history -n argocd -o yaml` - was this `ignoreDifferences` entry actually written with `user-profile-api`'s current situation in mind?",
  ],
  options: [
    {
      id: "ignoredifferences-masks-image-drift",
      label:
        "The Application's `ignoreDifferences` explicitly excludes `spec/template/spec/containers/0/image` from comparison - a leftover from a different, now-retired Deployment's HPA workaround that got copy-pasted here - so ArgoCD never even looks at whether the live image tag matches git, and correctly reports Synced/Healthy the entire time the hand-edited image tag diverged from git.",
      explanation:
        "`argocd-ignore-diff-history` confirms this exact `ignoreDifferences` entry was written for a different Deployment's replica-count/HPA situation and ended up pointed at the image field on this Application by accident, never cleaned up. Once a field is listed in `ignoreDifferences`, ArgoCD treats it as out of scope for diffing entirely - not just for reporting drift, but for `selfHeal` too, since selfHeal only acts on differences ArgoCD is actually comparing. The confirmed selfHeal test (a manual scale change reverting within a minute) worked precisely because `replicas` isn't in the ignore list - only `image` is, which is exactly the field someone changed by hand during the incident.",
    },
    {
      id: "selfheal-broken",
      label: "selfHeal itself is broken or disabled for this Application.",
      explanation:
        "selfHeal is confirmed working - a manual scale change to `replicas` was reverted within a minute during the same investigation. The Application isn't failing to self-heal in general, it's specifically not comparing the one field that was hand-edited.",
    },
    {
      id: "argocd-controller-not-running",
      label: "The ArgoCD application controller isn't running, so no reconciliation happens at all.",
      explanation:
        "Reconciliation is clearly happening - the confirmed selfHeal test on `replicas` reverting within a minute requires an active, working application controller. The controller is running and doing its job on every field it's configured to watch.",
    },
    {
      id: "git-webhook-not-firing",
      label: "A missing git webhook is preventing ArgoCD from noticing changes.",
      explanation:
        "This isn't about ArgoCD failing to notice a *git-side* change - git hasn't changed at all for this field. The issue is a *live cluster* change (the hand-edited image tag) that ArgoCD is explicitly configured to never compare against git in the first place, regardless of webhooks or polling.",
    },
  ],
  correctOptionId: "ignoredifferences-masks-image-drift",
  resolution: `\`argocd-ignore-diff-history\` traces exactly how this happened:
\`ignoreDifferences\` targeting the container image field was written
originally for a *different*, now-retired Deployment's replica-count/HPA
situation, then copy-pasted into \`user-profile-api\`'s Application as a
starting point for a similar setup that was ultimately never built - but
the block itself was never removed, and a copy-paste edit along the way
left it pointed at \`containers/0/image\` instead of \`replicas\`.

\`ignoreDifferences\` doesn't just suppress a warning about a mismatched
field - it removes that field from ArgoCD's comparison entirely, for both
drift *reporting* and \`selfHeal\`'s ability to correct it. That's exactly
consistent with everything observed: the confirmed selfHeal test on
\`replicas\` worked because that field isn't excluded, while the hand-edited
image tag sat drifted from git for a week with ArgoCD reporting a
perfectly accurate, if incomplete, "Synced" - accurate about every field
it was told to check, silent about the one it wasn't.

The fix is removing the stale entry so the image field goes back to being
actively compared and self-healed like everything else:

\`\`\`yaml
spec:
  syncPolicy:
    automated:
      selfHeal: true
    # ignoreDifferences block removed entirely
\`\`\`

\`ignoreDifferences\` is a sharp tool for real cases (an HPA-managed
\`replicas\`, a mutating webhook injecting a field, etc.) but it's easy to
forget once the reason for adding it goes away - and unlike most
misconfigurations, its failure mode is a status that looks completely
healthy the entire time, which is exactly why this went unnoticed for a
week.`,
};
