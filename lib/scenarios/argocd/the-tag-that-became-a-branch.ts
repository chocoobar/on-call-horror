import type { Scenario } from "../types";

export const theTagThatBecameABranch: Scenario = {
  id: "the-tag-that-became-a-branch",
  title: "The Tag That Became a Branch",
  subtitle: "release-manager swears v2.3.0 is pinned and stable, but pods keep changing",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "targetrevision", "git-tags"],
  briefing: `"invoice-generator" is supposedly pinned to the git tag "v2.3.0" for
stability - the release manager is confident nothing should change until
the next intentional release. Yet the Application has synced three
different revisions over the past two days, each time picking up new,
unreviewed commits.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-tag-that-became-a-branch", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/invoice-generator.git", targetRevision: "v2.3.0", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "invoicing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "9f8e7d6" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "release-tag-notes", namespace: "invoicing" },
        spec: {
          data: {
            "notes.md":
              "`v2.3.0` in this repo was never created as an actual git tag - it's a\nlong-lived git *branch* that happens to be named `v2.3.0`, left over\nfrom an old branch-per-release workflow the team stopped using a while\nback. Engineers have kept merging routine commits directly into it,\nassuming it was inert/frozen, not realizing it's a live, mutable branch\nthat ArgoCD's targetRevision tracks exactly like any other branch -\nfollowing its HEAD on every sync, not a fixed, immutable commit the way\na real git tag would be.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "Check the actual git repo: is `v2.3.0` a tag or a branch? (`git ls-remote --tags` vs `--heads`.)",
    "ArgoCD's targetRevision treats a branch name and a tag name identically as strings - it has no way of knowing 'this should be immutable' unless it actually resolves to a real, fixed git tag or a specific commit SHA.",
    "`kubectl get configmap release-tag-notes -n invoicing -o yaml` for what actually happened to this ref.",
  ],
  options: [
    {
      id: "v2-3-0-is-a-mutable-branch-not-a-tag",
      label:
        "\"v2.3.0\" was never an actual git tag - it's a long-lived branch left over from an old workflow that people keep merging routine commits into, assuming it's frozen. ArgoCD's targetRevision just tracks whatever \"v2.3.0\" resolves to, following the branch's moving HEAD exactly like it would any other branch.",
      explanation:
        "`release-tag-notes` confirms `v2.3.0` is a branch, not a tag, despite the release-looking name - and it's still receiving routine commits from engineers who assume it's frozen. ArgoCD's `targetRevision` has no concept of \"this string should be immutable\"; it resolves whatever ref name it's given on every reconciliation, and a branch's HEAD moves with every push to it, exactly matching the three unexpected syncs over two days.",
    },
    {
      id: "selfheal-picking-up-new-tags",
      label: "selfHeal is causing ArgoCD to re-resolve and follow new tags as they're created.",
      explanation:
        "selfHeal corrects live drift against whatever the current targetRevision resolves to - it doesn't change which revision is being tracked or cause new tags to be picked up. The actual mechanism here is that `v2.3.0` itself is a moving branch ref, not a tag-following behavior from selfHeal.",
    },
    {
      id: "webhook-triggering-wrong-revision",
      label: "A misconfigured webhook is triggering syncs against the wrong revision entirely.",
      explanation:
        "Each sync is against a different real commit that landed on the actual `v2.3.0` ref itself (per the branch history) - it's not syncing against some unrelated revision by mistake, it's correctly following the ref it's told to track, which just happens to be a mutable branch rather than a stable tag.",
    },
    {
      id: "repo-server-cache-tag-reuse",
      label: "argocd-repo-server is caching an outdated resolution of the tag to a stale commit.",
      explanation:
        "The opposite problem is happening - the Application is picking up *new* commits, not stale cached ones. A caching issue would show old content persisting despite new commits, not new unreviewed commits appearing unexpectedly.",
    },
  ],
  correctOptionId: "v2-3-0-is-a-mutable-branch-not-a-tag",
  resolution: `\`release-tag-notes\` confirms \`v2.3.0\` was never actually created as a git
tag - it's a leftover long-lived branch from an old branch-per-release
workflow, and engineers have kept merging routine commits into it,
assuming (reasonably, given the name) that it was frozen. ArgoCD's
\`targetRevision\` doesn't distinguish "this looks like a release name" from
"this is a mutable ref" - it resolves whatever ref it's given on every
reconciliation, and a branch's HEAD moves every time something is pushed
to it, exactly like the three unexpected syncs over two days.

Two-part fix. First, pin the Application to something actually immutable
- a real annotated tag, or a specific commit SHA if no tag exists yet for
the intended release point:

\`\`\`yaml
spec:
  source:
    targetRevision: v2.3.0-release   # an actual git tag, created fresh
\`\`\`

\`\`\`
git tag v2.3.0-release <known-good-commit-sha>
git push origin v2.3.0-release
\`\`\`

Second, since the old \`v2.3.0\` branch is actively misleading anyone who
assumes tag semantics from its name, it's worth renaming or deleting it
(after confirming nothing else references it) so the next person doesn't
make the same assumption.`,
};
