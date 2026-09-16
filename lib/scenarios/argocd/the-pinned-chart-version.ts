import type { Scenario } from "../types";

export const thePinnedChartVersion: Scenario = {
  id: "the-pinned-chart-version",
  title: "The Pinned Chart Version",
  subtitle: "the security fix everyone thinks is deployed to metrics-collector isn't",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "helm", "chart-version"],
  briefing: `A CVE fix shipped in "metrics-collector-chart" version 4.2.0 two weeks
ago, and the security team has been treating it as deployed ever since.
It isn't - "metrics-collector"'s Application still reports Synced and
Healthy the whole time, which is exactly why nobody thought to double-
check the actual chart version running in the cluster.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-pinned-chart-version", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://charts.example.com",
            chart: "metrics-collector-chart",
            targetRevision: "4.0.1",
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "metrics" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "4.0.1" }, health: { status: "Healthy" } },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "chart-release-notes", namespace: "metrics" },
        spec: {
          data: {
            "notes.md":
              "metrics-collector-chart release history:\n  4.0.1   deployed here, pinned explicitly\n  4.1.0   released 3 weeks ago (feature release)\n  4.2.0   released 2 weeks ago, includes the CVE-2026-41xx fix\n\nThe Application's spec.source.targetRevision is a fixed chart version\nstring, \"4.0.1\" - Helm chart sources in ArgoCD do not auto-track 'latest'\nunless targetRevision is explicitly left as a moving alias or updated\nmanually (there is no branch/HEAD concept for a Helm repo chart version\nthe way there is for a git source). Nothing about this Application's\nconfiguration causes it to notice or pick up newer chart releases on its\nown.",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl get application the-pinned-chart-version -n argocd -o yaml` - check `spec.source.targetRevision`. Is it a specific version number?",
    "Unlike a git source tracking a branch, a Helm chart source's `targetRevision` pinned to an exact version number never moves forward on its own, no matter how many new chart releases come out.",
    "`kubectl get configmap chart-release-notes -n metrics -o yaml` for the chart's release history since this Application was last touched.",
  ],
  options: [
    {
      id: "chart-version-pinned-never-bumped",
      label:
        "The Application's targetRevision is pinned to the exact chart version 4.0.1, and nobody ever bumped it after 4.2.0 (with the CVE fix) was released - a pinned Helm chart version never advances on its own, so it's been faithfully, correctly deploying the same old version this whole time, which is exactly why Synced/Healthy never looked wrong.",
      explanation:
        "`chart-release-notes` lays out the release history: 4.2.0, containing the CVE fix, came out two weeks ago, but `spec.source.targetRevision` on the Application is still hardcoded to `4.0.1`. A Helm chart source pinned to a specific version has no concept of 'track latest' - it stays exactly where it's pinned until someone edits that field, which is why the Application has correctly and unremarkably reported Synced against 4.0.1 the entire time.",
    },
    {
      id: "repo-server-cache-stale-chart",
      label: "argocd-repo-server's chart cache is serving a stale, outdated copy of the chart.",
      explanation:
        "A cache issue would cause ArgoCD to serve outdated content for the *same* requested version - here the Application is explicitly requesting version 4.0.1 in its own spec, and 4.0.1 is exactly what's deployed. There's no discrepancy between what's requested and what's delivered; the requested version itself is simply old.",
    },
    {
      id: "selfheal-reverting-chart-bump",
      label: "Someone bumped the chart version, but selfHeal reverted it back.",
      explanation:
        "selfHeal reverts live state to match what's declared in the Application's own spec - if someone had actually bumped `targetRevision` to 4.2.0 in the Application (or in a values file git source) and committed it, that would become the new declared state, and there'd be nothing for selfHeal to revert it away from. `spec.source.targetRevision` shown here is still 4.0.1, meaning no bump was ever made.",
    },
    {
      id: "cve-fix-not-actually-in-chart",
      label: "Version 4.2.0 doesn't actually contain the CVE fix despite what the release notes claim.",
      explanation:
        "There's no evidence here that the fix is missing from 4.2.0 - the chart release notes confirm it's included in that version. The Application simply was never updated to request that version at all; it's still deploying 4.0.1, two versions behind.",
    },
  ],
  correctOptionId: "chart-version-pinned-never-bumped",
  resolution: `\`chart-release-notes\` shows the CVE fix landed in chart version 4.2.0 two
weeks ago - but the Application's \`spec.source.targetRevision\` is still
hardcoded to \`4.0.1\`. A Helm chart source pinned to an exact version has
no "track latest" behavior the way a git source tracking a branch does;
it stays exactly where it's pinned until someone explicitly edits that
field and commits the change. The Application has been telling the exact
truth the whole time - Synced and Healthy against 4.0.1, which is
precisely the (now two-versions-stale) thing it was asked to deploy.

Fix by bumping the pinned version:

\`\`\`yaml
spec:
  source:
    chart: metrics-collector-chart
    targetRevision: 4.2.0
\`\`\`

Worth checking the CHANGELOG between 4.0.1 and 4.2.0 for any other
breaking changes riding along with the security fix before syncing. And
worth a broader process fix: for anything security-sensitive, pinning a
chart version needs a deliberate follow-up process to bump it when a CVE
fix lands - "Synced and Healthy" alone will never surface a pinned
version silently falling behind.`,
};
