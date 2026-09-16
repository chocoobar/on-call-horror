import type { Scenario } from "../types";

export const theChartDependencyThatDrifted: Scenario = {
  id: "the-chart-dependency-that-drifted",
  title: "The Chart Dependency That Drifted",
  subtitle: "identity-provider's chart hasn't changed, but its rendered manifests suddenly have",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "helm", "chart-dependencies"],
  briefing: `Nobody touched "identity-provider"'s chart, values, or any manifest this
week - but this morning's routine sync applied a batch of unexpected
changes to Deployment annotations and a new default NetworkPolicy that no
one in the team wrote. The Application's own repo shows no new commits
at all around the time of the change.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-chart-dependency-that-drifted", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/identity-provider.git",
            targetRevision: "main",
            path: "chart",
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "identity" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "f4e5d6c" }, health: { status: "Healthy" } },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "chart-dependency-drift-notes", namespace: "identity" },
        spec: {
          data: {
            "Chart.yaml.excerpt":
              "dependencies:\n  - name: common-security-baseline\n    version: \"^2.0.0\"\n    repository: \"https://charts.internal.example.com\"\n",
            "notes.md":
              "identity-provider's own Chart.yaml has been unchanged for 8 months, and\nno commits landed to the repo around the time of this morning's\nunexpected changes. But its Chart.yaml declares a dependency on\n`common-security-baseline` with a caret version range (`^2.0.0`, meaning\nany 2.x.x is acceptable), not a pinned exact version. The\ncommon-security-baseline chart itself published a new 2.4.0 release\nlast night, which added the new default NetworkPolicy and the\nDeployment annotation changes now showing up. Because ArgoCD re-resolves\nand re-fetches Helm chart dependencies fresh on every comparison (rather\nthan locking to whatever version was resolved on a prior sync, absent a\ncommitted Chart.lock), each comparison picks up whatever the latest\nmatching version currently published is - which, as of last night, is\n2.4.0's new content rather than whatever 2.x version was current at the\nlast time this was checked.",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "Check the identity-provider repo's own commit history around the time of the change - is there anything there at all?",
    "`kubectl get configmap chart-dependency-drift-notes -n identity -o yaml` and look closely at Chart.yaml's dependencies section - is the version a pinned exact value, or a range?",
    "A Helm chart dependency declared with a version range (like a caret range) can resolve to a different, newer version on every comparison as new matching releases get published - even with zero changes to the consuming chart itself.",
  ],
  options: [
    {
      id: "unpinned-dependency-range-resolved-newer-version",
      label:
        "identity-provider's Chart.yaml declares its common-security-baseline dependency with an unpinned caret version range rather than an exact version, and a new 2.4.0 release of that dependency published last night - since ArgoCD re-resolves Helm chart dependencies fresh on every comparison, it picked up the new version's changes automatically, with zero commits to identity-provider's own repo at all.",
      explanation:
        "`chart-dependency-drift-notes` confirms Chart.yaml pins the dependency with `^2.0.0` - a range, not an exact version - and that the dependency chart itself published a new 2.4.0 release last night containing exactly the new NetworkPolicy and annotation changes observed. Because ArgoCD resolves Helm dependencies fresh on each comparison rather than locking to a previously-resolved version, the newly published release was picked up automatically on the next sync, fully explaining unexpected changes with zero corresponding commits to identity-provider's own repo.",
    },
    {
      id: "repo-server-cache-corrupted-drift",
      label: "argocd-repo-server's chart cache became corrupted and started serving different content.",
      explanation:
        "The new content (the NetworkPolicy, the annotation changes) corresponds exactly to a real, newly-published 2.4.0 release of a legitimately-referenced dependency, not arbitrary or corrupted content - this is dependency resolution working as configured (to a range) rather than a caching malfunction.",
    },
    {
      id: "someone-edited-values-directly",
      label: "Someone edited the Application's Helm values directly without committing to git.",
      explanation:
        "A live-only values edit wouldn't survive as Synced against the same git revision on a subsequent comparison - ArgoCD would flag it as drift immediately, not silently incorporate it as part of a clean sync. The changes here are fully explained by a dependency's own new release matching an already-declared version range.",
    },
    {
      id: "target-revision-changed-drifted",
      label: "The Application's targetRevision was changed to track a different branch.",
      explanation:
        "`spec.source.targetRevision` is still `main`, unchanged, and there are no new commits to the identity-provider repo itself at all around the time of the change - the actual source of the new content is a separate chart dependency's own new release, not a different branch of this repo.",
    },
  ],
  correctOptionId: "unpinned-dependency-range-resolved-newer-version",
  resolution: `\`chart-dependency-drift-notes\` confirms identity-provider's own Chart.yaml
pins its \`common-security-baseline\` dependency with a caret range,
\`^2.0.0\` - meaning any 2.x.x release satisfies it, not a specific pinned
version. That dependency chart published a new 2.4.0 release last night,
adding exactly the NetworkPolicy and Deployment annotation changes seen
this morning. ArgoCD resolves Helm chart dependencies fresh on every
comparison rather than locking to whatever version was resolved on a
previous sync (absent a committed \`Chart.lock\`), so the newly published
2.4.0 got picked up automatically - fully explaining unexpected,
unreviewed changes with zero commits to identity-provider's own repo at
all.

The fix is pinning the dependency to an exact version, so nothing changes
without an explicit, reviewable bump:

\`\`\`yaml
# Chart.yaml
dependencies:
  - name: common-security-baseline
    version: "2.3.1"   # pinned exact version, was ^2.0.0
    repository: "https://charts.internal.example.com"
\`\`\`

and committing a \`Chart.lock\` alongside it so the resolved dependency
graph is explicit and reproducible rather than re-resolved fresh each
time. Bumping to 2.4.0 (or staying pinned at 2.3.1 for now) then becomes
a deliberate, reviewable commit rather than something that happens
silently overnight. Worth auditing every other chart's dependencies for
the same unpinned-range pattern - each one is a standing risk of
unreviewed changes landing in production the moment an upstream
dependency happens to cut a new release.`,
};
