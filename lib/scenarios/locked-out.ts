import type { Scenario } from "./types";

export const lockedOut: Scenario = {
  id: "locked-out",
  title: "Locked Out",
  subtitle: "the billing app is denied by its own AppProject",
  difficulty: "medium",
  type: "fix",
  timeMinutes: 20,
  tags: ["argocd", "rbac", "appproject"],
  briefing: `Platform security ran a "namespace allowlist hardening" pass on all
AppProjects last week. Ever since, the "locked-out" Application (which
deploys to the "billing" namespace) has refused to sync, failing with a
permission-style error instead of a normal comparison error.

Nothing about the Application or its manifests changed - only the
AppProject did.`,
  constraints: [
    "The Application should keep deploying to the 'billing' namespace, and should stay in 'locked-out-project' - the fix belongs on the AppProject's allowlist, not by moving the app elsewhere.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "locked-out", namespace: "argocd" },
        spec: {
          project: "locked-out-project",
          source: { repoURL: "https://github.com/example/billing.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "billing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Missing" },
          conditions: [
            {
              type: "InvalidSpecError",
              message:
                "application destination {server: https://kubernetes.default.svc, namespace: billing} is not permitted in project 'locked-out-project'",
            },
          ],
        },
        events: [
          {
            type: "Warning",
            reason: "InvalidSpecError",
            age: "3h",
            message: "application destination namespace billing is not permitted in project 'locked-out-project'",
          },
        ],
        age: "3h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AppProject",
        metadata: { name: "locked-out-project", namespace: "argocd" },
        spec: {
          description: "Billing team project (namespace allowlist hardened)",
          sourceRepos: ["*"],
          destinations: [{ namespace: "billing-legacy", server: "https://kubernetes.default.svc" }],
          clusterResourceWhitelist: [],
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl describe application locked-out -n argocd` - the condition is a permission error, not a manifest/comparison error. Note exactly which namespace it names.",
    "`kubectl get appproject locked-out-project -n argocd -o yaml` and look at `spec.destinations`.",
    "Compare the AppProject's allowlisted namespace against the Application's `spec.destination.namespace`. They don't match.",
  ],
  options: [
    {
      id: "rbac-sa",
      label: "The Application's service account lacks RBAC to create Deployments in the billing namespace.",
      explanation:
        "The condition is an InvalidSpecError from ArgoCD's own AppProject validation (\"is not permitted in project\"), which happens before any Kubernetes RBAC check would even come into play - ArgoCD refused the destination outright.",
    },
    {
      id: "sourceRepos",
      label: "The AppProject's sourceRepos list blocks this Application's git repo.",
      explanation:
        "sourceRepos is set to \"*\" (wide open) - the condition message is specifically about the destination namespace, not the source repo.",
    },
    {
      id: "destinations-mismatch",
      label: "The AppProject's destinations allowlist doesn't include the 'billing' namespace the Application actually deploys to.",
      explanation:
        "The AppProject only allowlists `billing-legacy`, but the Application's `spec.destination.namespace` is `billing` - exactly what the InvalidSpecError condition names. The security hardening pass allowlisted the wrong namespace.",
    },
    {
      id: "wrong-project",
      label: "The Application was assigned to the wrong AppProject entirely.",
      explanation:
        "\"locked-out-project\" is the billing team's own project (its description says so) - the problem isn't which project it's in, it's that this project's destinations list is missing the right namespace.",
    },
  ],
  correctOptionId: "destinations-mismatch",
  resolution: `The condition on the Application reads: "application destination namespace
billing ... is not permitted in project 'locked-out-project'". Looking at the
AppProject, \`spec.destinations\` only allowlists \`billing-legacy\` - not
\`billing\`, which is what this Application actually deploys to. The
"hardening pass" allowlisted the wrong namespace.

The fix is additive on the AppProject (don't widen it to a wildcard, and
don't move the Application to billing-legacy):

\`\`\`
kubectl -n argocd patch appproject locked-out-project --type json \\
  -p '[{"op":"add","path":"/spec/destinations/-","value":{"namespace":"billing","server":"https://kubernetes.default.svc"}}]'
\`\`\`

ArgoCD's automated sync then proceeds on its own.`,
};
