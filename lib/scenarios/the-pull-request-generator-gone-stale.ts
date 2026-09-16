import type { Scenario } from "./types";

export const thePullRequestGeneratorGoneStale: Scenario = {
  id: "the-pull-request-generator-gone-stale",
  title: "The Pull Request Generator Gone Stale",
  subtitle: "three preview environments are still running, weeks after their PRs merged and closed",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "applicationset", "pull-request-generator"],
  briefing: `"preview-envs" is an ApplicationSet using a pull request generator to spin
up an ephemeral preview environment for every open PR against
"storefront-web", and tear it down once the PR closes. A cost review just
found three preview environments that have been running - and billing -
for weeks after their PRs were merged and closed.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "preview-envs", namespace: "argocd" },
        spec: {
          generators: [
            {
              pullRequest: {
                github: { owner: "example", repo: "storefront-web", labels: ["preview"] },
                requeueAfterSeconds: 1800,
              },
            },
          ],
          template: {
            metadata: { name: "preview-pr-{{number}}" },
            spec: {
              source: { repoURL: "https://github.com/example/storefront-web.git", targetRevision: "{{head_sha}}", path: "manifests" },
              destination: { server: "https://kubernetes.default.svc", namespace: "preview-pr-{{number}}" },
              syncPolicy: { automated: { prune: true, selfHeal: true } },
            },
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pr-generator-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "All three stale preview environments correspond to PRs that were\nmerged without the `preview` label ever being removed first - engineers\nhave been in the habit of merging with the label still attached, since\nremoving it manually before merging felt like an unnecessary extra step.\nThe pull request generator's github source filters on OPEN PRs matching\nthe `labels: [preview]` filter - GitHub's PR API stops returning a PR at\nall once it's merged/closed, regardless of what labels it still carries,\nso from the generator's point of view a merged PR simply disappears from\nits result set, same as if the label had been removed. This *should*\nmean the ApplicationSet correctly prunes the generated Application once\nthe PR closes... and for most PRs, it does. These three specifically\nwere merged via GitHub's 'squash and merge' with the source branch NOT\ndeleted afterward (an unchecked box in the merge dialog) - and this\nrepo's branch protection rules keep an open PR from closing automatically\nin rare edge cases where a merge commit lands on the base branch through\na route other than GitHub's own merge button (here, a separate git-based\nsync tool this repo also uses mirrored the squash commit onto main\ndirectly, which satisfied the PR's merge requirement from GitHub's\nperspective without GitHub itself ever transitioning the PR to a formally\n'closed' state).",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get application -n argocd -l argocd.argoproj.io/application-set-name=preview-envs` - are the three stale Applications' corresponding PRs actually showing as closed on GitHub right now, or something odder?",
    "A pull request generator only stops generating an Application once the PR itself drops out of its filtered result set (open + matching labels) - what exactly makes a PR drop out of that set from GitHub's side?",
    "`kubectl get configmap pr-generator-notes -n argocd -o yaml` for what actually happened to these three specific PRs' state on GitHub.",
  ],
  options: [
    {
      id: "prs-never-formally-closed-on-github-despite-merge",
      label:
        "These three PRs' commits landed on the base branch through a separate git-sync tool rather than GitHub's own merge button, which satisfied GitHub's merge requirement without ever formally transitioning the PR to 'closed' - so from the pull request generator's point of view, still-open (if stale) PRs matching the label filter, it correctly kept generating and maintaining their preview Applications the whole time.",
      explanation:
        "`pr-generator-notes` confirms exactly this edge case: a separate git-based sync tool mirrored the squash commit onto main directly, satisfying the merge from GitHub's content perspective without GitHub's own PR state machine ever formally closing the PR. Since the pull request generator's result set is driven by PR state (open, matching labels) as GitHub reports it - not by whether the branch's commits happen to already be on the base branch - these three PRs never actually left the generator's result set, so their Applications were correctly (if surprisingly) never pruned.",
    },
    {
      id: "requeueAfterSeconds-too-long",
      label: "requeueAfterSeconds (1800s / 30 minutes) is too long, so the generator hasn't refreshed recently enough to notice the PRs closed.",
      explanation:
        "30 minutes would explain a delay of up to half an hour, not weeks - if these PRs had genuinely transitioned to closed on GitHub, even the existing 30-minute requeue interval would have caught it within the same day, not left three environments running for weeks afterward.",
    },
    {
      id: "label-filter-matches-closed-prs-too",
      label: "The generator's labels filter matches merged/closed PRs as well as open ones, ignoring PR state entirely.",
      explanation:
        "A GitHub pull request generator inherently filters to open PRs as part of its normal, documented behavior - the labels filter narrows further within that open set, it doesn't override or bypass the open-PR-only scoping. The actual gap here is that these specific PRs never transitioned to a closed state on GitHub at all, not that closed PRs are being incorrectly included.",
    },
    {
      id: "appset-controller-missed-generation",
      label: "The ApplicationSet controller simply failed to run its generation refresh for these three specifically.",
      explanation:
        "Every other PR's preview environment is confirmed being correctly torn down by this same generator and controller - a controller-level failure to refresh wouldn't selectively affect exactly three specific Applications while working correctly for everything else on the identical schedule and mechanism.",
    },
  ],
  correctOptionId: "prs-never-formally-closed-on-github-despite-merge",
  resolution: `\`pr-generator-notes\` traces the exact, unusual mechanism: these three PRs'
commits landed on \`main\` via a separate git-based sync tool this repo
also uses, rather than through GitHub's own merge button - which
satisfied the PR's merge requirement (the commits are genuinely on the
base branch) without GitHub's own PR state machine ever formally
transitioning the PR to "closed." The pull request generator's result
set is driven entirely by PR state as GitHub itself reports it (open,
matching the \`preview\` label filter) - it has no independent way to
notice that a PR's content already landed on the base branch through some
other route. From the generator's perspective, these three PRs never
actually left its result set, so it correctly (if surprisingly) kept
generating and maintaining their preview Applications the whole time.

Immediate fix: manually close the three stuck-open PRs on GitHub, which
removes them from the generator's result set on its next refresh and lets
it prune their Applications normally:

\`\`\`
gh pr close 412 439 447 --repo example/storefront-web
\`\`\`

Longer term, this is worth flagging as a process gap with whichever team
relies on the separate git-sync tool - merging content onto the base
branch outside GitHub's own merge flow needs to also close the
corresponding PR (or the workflow needs to stop leaving the source branch
undeleted / PR open as a side effect), otherwise this exact stale-preview-
environment pattern will keep recurring for any PR merged the same way.`,
};
