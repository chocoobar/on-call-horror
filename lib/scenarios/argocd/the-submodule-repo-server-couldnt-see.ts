import type { Scenario } from "../types";

export const theSubmoduleRepoServerCouldntSee: Scenario = {
  id: "the-submodule-repo-server-couldnt-see",
  title: "The Submodule Repo Server Couldn't See",
  subtitle: "partner-integration-api renders manifests referencing files that don't exist",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "git-submodules", "repo-server"],
  briefing: `"partner-integration-api"'s manifests reference a shared schema library
kept as a git submodule inside the repo. The Application fails comparison
with an error about a missing file that the team can see plainly sitting
in the repo on GitHub, in the exact path the error names.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-submodule-repo-server-couldnt-see", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/partner-integration-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "partner-integration" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message: "open manifests/schemas/partner-schema-lib/openapi.yaml: no such file or directory",
            },
          ],
        },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "submodule-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "manifests/schemas/partner-schema-lib is a git submodule pointing at a\nseparate schema repo, added 2 months ago. It's visible and populated\nwhen browsing on GitHub's own UI (GitHub resolves and displays submodule\ncontents automatically), which is why the team assumed it was fine.\nArgoCD's argocd-repo-server, by default, performs a shallow, non-\nrecursive git checkout - it does not fetch or initialize submodules\nunless explicitly told to. There is a documented\n`spec.source.repoURL`-level setting for this,\n`argocd-cm`'s `--submodule` flag equivalent isn't set for this repo, and\nthe Application itself has no explicit config requesting submodule\ninitialization either.",
          },
        },
        age: "40m",
      },
    ],
  },
  hints: [
    "GitHub's own web UI resolves and displays submodule contents automatically when you browse a repo there - that doesn't mean any other git client does the same by default.",
    "`kubectl get configmap submodule-notes -n argocd -o yaml` - does argocd-repo-server's checkout process initialize git submodules by default?",
    "The missing path is exactly where the submodule is supposed to live - check whether the submodule itself was ever actually fetched into the checkout ArgoCD is comparing against, versus just being referenced.",
  ],
  options: [
    {
      id: "repo-server-doesnt-init-submodules-by-default",
      label:
        "argocd-repo-server's default checkout doesn't fetch or initialize git submodules unless explicitly configured to - the submodule directory is a real, valid reference in the repo (which is why it renders fine on GitHub's own UI), but ArgoCD's own checkout leaves it as an empty placeholder path, so any file inside it is genuinely missing from ArgoCD's point of view.",
      explanation:
        "`submodule-notes` confirms this directly: GitHub's web UI auto-resolves submodule contents for display, which is why the team sees it fine there, but argocd-repo-server's default git checkout does not initialize submodules unless explicitly told to. The error - a specific file inside the submodule path genuinely not existing - matches exactly what an uninitialized submodule directory looks like to any tool that doesn't special-case it the way GitHub's UI does.",
    },
    {
      id: "wrong-path-in-application",
      label: "The Application's spec.source.path is pointed at the wrong directory.",
      explanation:
        "`spec.source.path` (`manifests`) is correct - the error is about a specific file several levels deeper, inside the submodule directory that the path correctly leads to. The submodule directory itself exists as an empty placeholder; it's what should be inside it (fetched via submodule init) that's missing.",
    },
    {
      id: "file-deleted-from-submodule-repo",
      label: "The file was deleted from the underlying submodule's own repository.",
      explanation:
        "The team confirms the file is visible in the exact path the error names when browsing on GitHub - it genuinely exists in the submodule repo at the referenced commit. The problem is ArgoCD's own checkout process never actually fetching the submodule's contents, not the file being missing from its source.",
    },
    {
      id: "repo-credentials-lack-submodule-access",
      label: "ArgoCD's repo credentials don't have access to the separate submodule repository.",
      explanation:
        "If credentials access were the blocker, the error would typically reference an authentication/access failure when attempting to fetch the submodule, not a plain 'no such file or directory' for a specific file - the described behavior is consistent with submodules never being initialized at all by default, not a failed, attempted fetch.",
    },
  ],
  correctOptionId: "repo-server-doesnt-init-submodules-by-default",
  resolution: `\`submodule-notes\` explains the gap precisely: GitHub's own web UI
transparently resolves and displays submodule contents when browsing a
repo there, which is why the team assumed everything was fine - but
that's GitHub-UI-specific behavior, not something every git client does
automatically. argocd-repo-server's default checkout does not fetch or
initialize git submodules unless explicitly configured to. The submodule
directory exists as an empty, uninitialized placeholder in ArgoCD's own
checkout, so any file expected inside it (like \`openapi.yaml\`) genuinely
doesn't exist from ArgoCD's point of view, even though it's perfectly
visible and correct in the repo itself.

Fix by telling ArgoCD to initialize submodules for this repo, either at
the repository connection level:

\`\`\`
argocd repo add https://github.com/example/partner-integration-api.git \\
  --submodules
\`\`\`

or cluster-wide via \`argocd-cm\` if multiple repos need it:

\`\`\`yaml
data:
  # applies to repo-server's git client generally when a repo needs it;
  # the per-repo --submodules flag above is the more targeted fix
\`\`\`

Once submodules are initialized as part of the checkout, ArgoCD's next
comparison finds the schema files exactly where the repo declares them,
and the Application returns to a normal comparison and sync. Worth
flagging for the team: browsing a repo's submodule contents on GitHub is
not a reliable signal that every tool interacting with that repo sees the
same thing.`,
};
