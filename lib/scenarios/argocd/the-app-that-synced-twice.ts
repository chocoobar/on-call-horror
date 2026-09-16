import type { Scenario } from "../types";

export const theAppThatSyncedTwice: Scenario = {
  id: "the-app-that-synced-twice",
  title: "The App That Synced Twice",
  subtitle: "notifications-api's Deployment keeps flipping between two different images",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "gitops", "conflict"],
  briefing: `"notifications-api"'s Deployment has been flapping between two different
image tags every couple of minutes all afternoon, with no one touching it
manually. Each time it looks fixed, it flips back within minutes.`,
  constraints: [
    "Nobody has run `kubectl apply` or `kubectl edit` on this Deployment today - both syncs and both image tags are legitimately coming from ArgoCD, from git.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "notifications-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/notifications.git", targetRevision: "main", path: "manifests/notifications-api" },
          destination: { server: "https://kubernetes.default.svc", namespace: "notifications" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "1111aaa" }, health: { status: "Healthy" } },
        age: "3h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "notifications-api-canary", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/notifications.git", targetRevision: "canary-rollout", path: "manifests/notifications-api" },
          destination: { server: "https://kubernetes.default.svc", namespace: "notifications" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "2222bbb" }, health: { status: "Healthy" } },
        age: "40m",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notifications-api", namespace: "notifications", labels: { app: "notifications-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-app-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "A `notifications-api-canary` Application was created 40 minutes ago to\ntest a rollout branch (`canary-rollout`), pointed at the same manifests\npath and same destination namespace as the existing `notifications-api`\nApplication, as a quick way to preview the branch's changes 'without\ntouching the real Application.' Both have automated sync with selfHeal\nenabled.\n",
          },
        },
        age: "40m",
      },
    ],
  },
  hints: [
    "`kubectl get application -n argocd` - is there more than one Application that could plausibly own this Deployment?",
    "`kubectl get application notifications-api -n argocd -o yaml` and `kubectl get application notifications-api-canary -n argocd -o yaml` - compare `spec.destination` on both.",
    "Both Applications have `selfHeal: true`. If two Applications both manage the exact same live resource, what happens every time one of them notices the other's sync 'drifted' it away from its own desired state?",
  ],
  options: [
    {
      id: "two-applications-same-destination",
      label:
        "`notifications-api-canary` was pointed at the exact same destination namespace and manifest path as the existing `notifications-api` Application - both now manage the same live Deployment, and with `selfHeal` enabled on both, each one keeps 'correcting' the image tag back to its own source the moment the other Application syncs its version in.",
      explanation:
        "`argocd-app-notes` confirms the canary Application was created pointing at the same destination and path as the original, as a shortcut to preview a branch. With `syncPolicy.automated.selfHeal: true` on both, each Application treats the other's sync as unwanted drift from its own desired state and immediately re-syncs to correct it back - which is exactly a flip-flop between two different image tags with no human touching anything. Two ArgoCD Applications should never own the exact same live resources; whichever one runs its reconcile loop last always wins, until the other one runs and wins back.",
    },
    {
      id: "image-tag-mutable-registry",
      label: "The image tag is mutable in the registry and the underlying image content is changing.",
      explanation:
        "The Deployment's image *tag itself* is changing, not the content behind a stable tag - this is a config-level flip between two different declared versions in git, not a registry-side content change under a fixed tag.",
    },
    {
      id: "argocd-cache-stale",
      label: "ArgoCD's internal cache is stale and showing an outdated sync status.",
      explanation:
        "Both Applications report `Synced`/`Healthy` accurately and consistently reflect what's live at any given moment - there's no evidence of stale or incorrect status reporting, just two different sources of truth genuinely fighting over the same resource.",
    },
    {
      id: "kubernetes-scheduler-issue",
      label: "The Kubernetes scheduler is rescheduling pods with a different image each time.",
      explanation:
        "The scheduler places pods onto nodes based on the Deployment's pod template as it currently exists - it doesn't independently choose or change image tags. The image tag itself is being changed at the source (the Deployment spec), which is squarely ArgoCD's job, not the scheduler's.",
    },
  ],
  correctOptionId: "two-applications-same-destination",
  resolution: `\`argocd-app-notes\` explains exactly how this happened: someone created
\`notifications-api-canary\` to preview a branch, pointed at the *same*
destination namespace and manifest path as the existing
\`notifications-api\` Application - intending it as a quick, isolated
preview, but instead creating a second ArgoCD Application that manages
the exact same live Deployment. Both have \`selfHeal: true\`. Every time one
Application's reconcile loop runs, it sees the other's most recent sync as
unwanted drift away from its own desired state and immediately corrects
it back - and then the other one does the same thing right back, in an
endless loop with no human involved and no error reported by either side,
since as far as each Application is concerned, it's just doing its job
correctly.

The fix is making sure exactly one Application owns this Deployment.
Either delete the canary Application (\`argocd app delete
notifications-api-canary\` - not available from this read-only console, a
fix for the real cluster) once its branch has been reviewed, or point it
at an isolated destination namespace from the start next time, so a
preview can never collide with the resource a "real" Application already
manages:

\`\`\`yaml
# notifications-api-canary
spec:
  destination:
    namespace: notifications-canary   # isolated, not shared
\`\`\`

Two Applications targeting the same live resources is one of the more
dangerous ArgoCD footguns precisely because both sides report healthy and
successful the entire time - nothing in either Application's own status
ever flags that it's fighting another Application for the same object.`,
};
