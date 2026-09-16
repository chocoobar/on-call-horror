import type { Scenario } from "./types";

export const theBranchThatGotForcePushed: Scenario = {
  id: "the-branch-that-got-force-pushed",
  title: "The Branch That Got Force-Pushed",
  subtitle: "three days of commits to ad-serving-api just vanished from what's deployed",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "git", "force-push"],
  briefing: `"ad-serving-api" tracks "main" directly. This morning, a teammate doing
interactive rebase cleanup on a shared "main" branch (against strong
convention, during an emergency incident-response cleanup) force-pushed a
version of main missing three days of legitimate, already-deployed
commits. ArgoCD picked it up immediately via selfHeal and reverted
production back to a three-day-old state, mid-business-day.`,
  constraints: [
    "The immediate priority is restoring the three days of lost commits to what's actually deployed - assume the force-push itself has already been addressed/reverted in git by the time this is being investigated, and focus on why ArgoCD reacted the way it did.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-branch-that-got-force-pushed", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/ad-serving-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "ad-serving" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "e0d1c2b" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "force-push-incident-notes", namespace: "ad-serving" },
        spec: {
          data: {
            "notes.md":
              "`git log --oneline main` on the remote now shows main's HEAD at a\ncommit from 3 days ago - the force-push replaced the branch tip\nentirely, discarding every commit made since. This Application's\ntargetRevision (`main`) is a plain moving branch reference, exactly as\nintended for normal day-to-day deploys - selfHeal correctly did its job\nas designed: it noticed live state (matching the 3-days-ago-and-newer\ncommits, correctly deployed at the time) diverged from what `main` now\nresolves to, and reconciled live state DOWN to match the rewritten\nbranch, exactly as it would for any other kind of drift. The three days\nof commits themselves are not lost from git history entirely - they\nexist in the reflog of whoever last had a local main up to date before\nthe force-push, and possibly as dangling commits on GitHub's server\nreachable by SHA for some retention window, but are no longer reachable\nfrom any branch or tag.",
          },
        },
        age: "10m",
      },
    ],
  },
  hints: [
    "`git log --oneline main` on the remote - does it actually contain the three days of commits everyone expects, or does history itself no longer include them?",
    "selfHeal reconciles live state to match whatever targetRevision currently resolves to - what happens when the thing targetRevision points at gets rewritten out from under it, rather than moved forward normally?",
    "`kubectl get configmap force-push-incident-notes -n ad-serving -o yaml` for where the missing commits might still be recoverable from.",
  ],
  options: [
    {
      id: "selfheal-correctly-followed-rewritten-branch-backward",
      label:
        "A force-push rewrote main's history, discarding three days of legitimate commits from the branch entirely - selfHeal did exactly what it's designed to do, reconciling live state to match whatever main currently resolves to, which after the rewrite is an old state; the commits aren't lost from git forever, but they're no longer reachable from main and need to be recovered and reapplied, not just re-synced.",
      explanation:
        "`force-push-incident-notes` confirms main's remote HEAD genuinely is now the 3-days-ago commit - the branch itself was rewritten, not just moved forward. selfHeal's job is reconciling live state to match whatever targetRevision currently resolves to; it has no concept of 'branch history got rewritten backward, don't follow it' versus 'branch moved forward normally, do follow it' - both look identical to it as 'live state doesn't match main, fix it.' The three days of commits still exist as dangling/reflog-reachable objects for now, but aren't part of any branch ArgoCD would sync toward until someone restores them.",
    },
    {
      id: "argocd-cache-bug-force-push",
      label: "ArgoCD's git cache has a bug that caused it to resolve main incorrectly.",
      explanation:
        "ArgoCD is resolving `main` completely correctly - to whatever its actual current HEAD is, which the git log confirms really is the rewritten, 3-day-old state. There's no cache malfunction here; the branch itself was genuinely rewritten, and ArgoCD followed it exactly as designed.",
    },
    {
      id: "selfheal-should-have-refused-large-diff",
      label: "selfHeal should have some kind of safety check that refuses to revert a large number of commits at once.",
      explanation:
        "This describes a reasonable feature request for the future, not what actually happened or a config that was misconfigured - selfHeal as it exists and is documented does not have (and this Application wasn't configured to expect) any such safety threshold; it faithfully reconciled to whatever the branch pointed at, exactly as intended for its normal use case.",
    },
    {
      id: "wrong-targetrevision-should-be-sha",
      label: "targetRevision should have been pinned to a specific commit SHA all along, not a branch name.",
      explanation:
        "Pinning to a branch name for continuous, automatic deployment is completely standard and intentional practice, not a misconfiguration - the actual failure mode here is a branch getting force-pushed against strong convention, an unusual and directly-caused incident, not a general flaw in tracking a branch under normal circumstances.",
    },
  ],
  correctOptionId: "selfheal-correctly-followed-rewritten-branch-backward",
  resolution: `\`force-push-incident-notes\` confirms main's remote HEAD is now genuinely
the three-day-old commit - the force-push didn't just fail to include new
work, it rewrote the branch's history entirely, discarding everything
since. selfHeal did exactly what it's designed to do: it noticed live
state (correctly reflecting the legitimate commits from the last three
days) no longer matched what \`main\` currently resolves to, and reconciled
live state to match - which, because the branch itself moved backward
rather than forward, meant reverting production to an old state. There's
no concept in selfHeal of "this branch rewrite looks suspicious" versus
"this branch moved forward normally" - both are just "live state doesn't
match targetRevision" to it.

The commits aren't gone from git forever - they're dangling objects,
reachable via reflog on whoever had a local \`main\` up to date, and likely
still fetchable by SHA from GitHub's server for some retention window.
Recovery is a two-step process: restore the branch in git first, then let
ArgoCD (or a manual sync) bring the cluster back in line with the
restored history:

\`\`\`
# from someone's local main that was up to date before the force-push
git push origin <last-good-sha>:main --force-with-lease
\`\`\`

Once \`main\` is restored to include the three days of commits, ArgoCD's
next reconciliation (automatic, given selfHeal) picks it back up and
redeploys the intended state. Worth pairing this with actual branch
protection on \`main\` (require pull requests, disallow force-pushes for
everyone including admins) so a future emergency cleanup can't rewrite
the branch ArgoCD is continuously deploying from in the first place -
that's the systemic fix, not anything on ArgoCD's side.`,
};
