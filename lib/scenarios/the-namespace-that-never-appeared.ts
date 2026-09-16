import type { Scenario } from "./types";

export const theNamespaceThatNeverAppeared: Scenario = {
  id: "the-namespace-that-never-appeared",
  title: "The Namespace That Never Appeared",
  subtitle: "analytics-pipeline's Application is Synced, but nothing is running",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 10,
  tags: ["argocd", "namespace", "sync-options"],
  briefing: `A brand-new Application, "analytics-pipeline", was pointed at a fresh
namespace, "analytics-prod", that has never existed on this cluster before
today. The Application claims it synced successfully, but "kubectl get
pods -n analytics-prod" returns nothing at all - not even an error, the
namespace itself doesn't exist.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-namespace-that-never-appeared", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/analytics-pipeline.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "analytics-prod" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "d4e5f6a" },
          health: { status: "Missing" },
          operationState: {
            phase: "Failed",
            message: 'one or more objects failed to apply, reason: namespaces "analytics-prod" not found',
          },
        },
        age: "8m",
      },
    ],
  },
  hints: [
    "`kubectl get namespace analytics-prod` - does it actually exist?",
    "`kubectl describe application the-namespace-that-never-appeared -n argocd` - look at `status.operationState.message` closely, not just `status.sync.status`.",
    "`syncPolicy.automated` and `syncPolicy.syncOptions` are two different fields - one turns on auto-sync, the other controls things like `CreateNamespace=true`.",
  ],
  options: [
    {
      id: "createnamespace-missing",
      label:
        "The Application's syncPolicy is missing the `CreateNamespace=true` sync option, so ArgoCD never created the destination namespace before trying to apply objects into it, and every namespaced object failed to apply.",
      explanation:
        "`status.operationState.message` says exactly this: `namespaces \"analytics-prod\" not found`. `spec.syncPolicy` only has `automated`, with no `syncOptions` array containing `CreateNamespace=true` - so ArgoCD never created the namespace and every apply into it failed, even though the top-level sync status still reports Synced because ArgoCD considers the operation 'complete' (failed) rather than pending.",
    },
    {
      id: "wrong-cluster-target",
      label: "The Application's destination.server points at the wrong cluster entirely.",
      explanation:
        "`spec.destination.server` is `https://kubernetes.default.svc` - the standard in-cluster destination, the same one every other Application on this cluster uses. The failure is specifically about the namespace not existing, not about reaching the wrong cluster.",
    },
    {
      id: "rbac-create-namespace",
      label: "ArgoCD's ServiceAccount lacks RBAC permission to create namespaces cluster-wide.",
      explanation:
        "If ArgoCD had actually attempted to create the namespace and been denied by RBAC, the error would be a Forbidden/RBAC-style message naming the ServiceAccount - the message here is a plain 'not found', consistent with ArgoCD never even trying to create it because the sync option that tells it to isn't set.",
    },
    {
      id: "appproject-namespace-not-onboarded",
      label: "The AppProject doesn't list analytics-prod as an allowed destination.",
      explanation:
        "If the AppProject's destinations list rejected this namespace, ArgoCD would report an InvalidSpecError condition before ever attempting a sync operation - here the sync operation ran and specifically failed on 'namespace not found', which is a Kubernetes apply-time error, not an ArgoCD-side permission rejection.",
    },
  ],
  correctOptionId: "createnamespace-missing",
  resolution: `\`status.operationState.message\` names the exact failure: \`namespaces
"analytics-prod" not found\`. ArgoCD only auto-creates a destination
namespace when the Application's \`syncPolicy.syncOptions\` explicitly
includes \`CreateNamespace=true\` - here \`spec.syncPolicy\` only sets
\`automated\`, with no \`syncOptions\` at all, so ArgoCD tried to apply every
namespaced manifest into a namespace that was never created and every
single one failed at the API server.

Fix:

\`\`\`yaml
spec:
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
\`\`\`

The next automated sync creates \`analytics-prod\` first, then applies the
rest of the manifests into it normally. Worth noting for new Applications
generally: pointing at a namespace that doesn't exist yet is a common
first-deploy trap, and it's worth checking \`CreateNamespace=true\` is set
(or the namespace is pre-provisioned) before wiring up a brand-new app.`,
};
