import type { Scenario } from "./types";

export const theAppprojectRepoAllowlist: Scenario = {
  id: "the-appproject-repo-allowlist",
  title: "The AppProject Repo Allowlist",
  subtitle: "search-indexer's Application refuses to compare after a repo split",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "appproject", "sourcerepos"],
  briefing: `The "search" team split their monolithic repo into per-service repos
last week. "search-indexer"'s Application was updated to point at its new,
dedicated repository - but it's refused to sync ever since, with an error
that looks like a permissions problem rather than anything wrong with the
manifests themselves.`,
  constraints: [
    "The Application should keep using its new dedicated repo - don't point it back at the old monorepo.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-appproject-repo-allowlist", namespace: "argocd" },
        spec: {
          project: "search-project",
          source: { repoURL: "https://github.com/example/search-indexer.git", targetRevision: "main", path: "." },
          destination: { server: "https://kubernetes.default.svc", namespace: "search" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "InvalidSpecError",
              message:
                "application repo https://github.com/example/search-indexer.git is not permitted in project 'search-project'",
            },
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AppProject",
        metadata: { name: "search-project", namespace: "argocd" },
        spec: {
          description: "Search team project",
          sourceRepos: ["https://github.com/example/search-monorepo.git"],
          destinations: [{ namespace: "search", server: "https://kubernetes.default.svc" }],
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-appproject-repo-allowlist -n argocd` - the condition names the exact repo URL it considers 'not permitted'.",
    "`kubectl get appproject search-project -n argocd -o yaml` and check `spec.sourceRepos`.",
    "The AppProject was never updated when the repo split happened - it still only knows about the old monorepo URL.",
  ],
  options: [
    {
      id: "sourcerepos-still-old-repo",
      label:
        "The AppProject's sourceRepos allowlist still only includes the old monorepo URL, and was never updated to also allow the new dedicated search-indexer repo the Application was pointed at after the split.",
      explanation:
        "The InvalidSpecError condition names the new repo URL directly as 'not permitted in project'. The AppProject's `spec.sourceRepos` only lists the old `search-monorepo.git` URL - it was never updated for the split, so ArgoCD's own project-level validation rejects the new source before comparison even runs.",
    },
    {
      id: "repo-credentials-missing-allowlist",
      label: "ArgoCD has no stored credentials for the new search-indexer repository.",
      explanation:
        "The condition is an InvalidSpecError from AppProject validation ('is not permitted in project'), which happens before ArgoCD would ever attempt to authenticate to the repo - this is a policy rejection, not a credentials failure.",
    },
    {
      id: "path-doesnt-exist",
      label: "The path '.' doesn't contain valid manifests in the new repo.",
      explanation:
        "ArgoCD never gets far enough to look at the repo's contents - the condition is a project-level source rejection that happens before any manifest generation or path resolution is attempted.",
    },
    {
      id: "destination-namespace-blocked-allowlist",
      label: "The AppProject's destinations list no longer allows the 'search' namespace.",
      explanation:
        "`spec.destinations` still allowlists `search` correctly - the condition message is specifically about the source repo URL, not the destination namespace.",
    },
  ],
  correctOptionId: "sourcerepos-still-old-repo",
  resolution: `The condition is unambiguous: "application repo
https://github.com/example/search-indexer.git is not permitted in project
'search-project'". The AppProject's \`spec.sourceRepos\` only allowlists the
old \`search-monorepo.git\` URL from before the split - nobody updated it
when the Application was repointed at the new dedicated repo, so ArgoCD's
own project-level policy rejects the source outright, before any
comparison against the destination cluster is even attempted.

Fix by adding the new repo to the allowlist (and removing the old one
once every Application has migrated off it, if it's no longer needed):

\`\`\`
kubectl -n argocd patch appproject search-project --type json \\
  -p '[{"op":"add","path":"/spec/sourceRepos/-","value":"https://github.com/example/search-indexer.git"}]'
\`\`\`

The Application then compares and syncs normally on the next
reconciliation. Worth a quick check of any other Application whose repo
moved during the same split - each one needs its new repo added to its
project's allowlist individually.`,
};
