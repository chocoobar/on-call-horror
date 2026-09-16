import type { Scenario } from "./types";

export const theFieldManagerStandoff: Scenario = {
  id: "the-field-manager-standoff",
  title: "The Field Manager Standoff",
  subtitle: "user-profile-service is stuck OutOfSync no matter how many times someone hits sync",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "server-side-apply", "field-manager"],
  briefing: `"user-profile-service" started showing OutOfSync two days ago, right
after the platform team rolled out a cluster-wide admission webhook that
auto-injects a sidecar container into every pod template. Manually
syncing "succeeds" every time - and the Application flips right back to
OutOfSync within a minute of every single attempt.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-field-manager-standoff", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/user-profile-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "profiles" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "field-manager-notes", namespace: "profiles" },
        spec: {
          data: {
            "notes.md":
              "`argocd app diff` shows a single consistent difference every time:\ngit declares `spec.template.spec.containers` with one entry (the app\ncontainer); live state has two (the app container plus a\n`mesh-sidecar` container, injected by the new cluster-wide mutating\nadmission webhook on every pod template it touches). ArgoCD applies\nmanifests via server-side apply, which tracks field ownership per\n'field manager' - the webhook's mutation isn't part of what ArgoCD's own\nfield manager declared, so ArgoCD's comparison correctly flags the\nsidecar as drift on every reconciliation, sync notwithstanding: a sync\nreapplies exactly what git declares (still one container), the webhook\nimmediately re-injects the sidecar on the resulting object, and ArgoCD's\nnext comparison sees the same 'unexpected' second container again.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`argocd app diff the-field-manager-standoff` - what specific field is flagged as different, every single time, even right after a successful sync?",
    "A cluster-wide mutating admission webhook was rolled out two days ago, right when this started - what does it do to every pod template it processes?",
    "ArgoCD compares live state against git on every reconciliation - a mutation applied by something *other* than ArgoCD after every apply (like an admission webhook) will keep reappearing as drift, sync after sync, unless ArgoCD is told to ignore that specific field.",
  ],
  options: [
    {
      id: "admission-webhook-injects-sidecar-every-apply",
      label:
        "A cluster-wide mutating admission webhook injects a mesh-sidecar container into every pod template on every apply, including ArgoCD's own syncs - since git only declares one container, ArgoCD's comparison correctly (and repeatedly) flags the webhook-injected sidecar as drift after every single sync, because the webhook re-adds it the moment the sync's apply goes through.",
      explanation:
        "`field-manager-notes` confirms `argocd app diff` consistently shows a second container (`mesh-sidecar`) present live but absent from git - injected by the new webhook, which processes every pod template including the ones ArgoCD applies. Every sync reapplies git's one-container spec, the webhook immediately mutates the resulting object to add the sidecar back, and ArgoCD's next comparison sees that addition as new drift - a cycle that repeats indefinitely unless ArgoCD is told to stop comparing that specific field.",
    },
    {
      id: "selfheal-reverting-manual-sidecar",
      label: "Someone manually added a sidecar container and selfHeal keeps trying (and failing) to remove it.",
      explanation:
        "The sidecar is being added by a cluster-wide admission webhook on every apply, not by a one-time manual edit - selfHeal reverting a one-time manual change would eventually settle once corrected, but this recurs every single sync because the webhook re-injects it freshly each time, not because of a stubborn manual change.",
    },
    {
      id: "webhook-rejecting-argocd-applies",
      label: "The new admission webhook is rejecting ArgoCD's apply requests outright.",
      explanation:
        "The Application's syncs are reported as succeeding, and the resulting live object does contain everything git declares (plus the extra sidecar) - a rejecting webhook would cause failed sync operations with apply-time errors, not successful syncs that immediately drift again afterward.",
    },
    {
      id: "repo-server-caching-old-manifest",
      label: "argocd-repo-server is serving a cached, outdated version of the manifests missing the sidecar.",
      explanation:
        "The manifests in git were never meant to include the sidecar at all - it's injected entirely by the webhook, external to anything in git or the repo-server's rendering. A caching issue wouldn't explain a consistent, webhook-timed extra container appearing specifically two days after this admission webhook was rolled out.",
    },
  ],
  correctOptionId: "admission-webhook-injects-sidecar-every-apply",
  resolution: `\`argocd app diff\` consistently flags the same thing: a second container,
\`mesh-sidecar\`, present in live state but absent from git. \`field-
manager-notes\` traces it to the cluster-wide mutating admission webhook
rolled out two days ago, which injects that sidecar into every pod
template it processes - ArgoCD's own applies included. Every sync
reapplies exactly what git declares (one container); the webhook
immediately mutates the resulting object to add the sidecar back before
ArgoCD's next comparison runs; that comparison sees the added container
as new drift. Sync "succeeds" every time in the narrow sense that the
apply goes through - it just never actually reaches a stable, matching
state, because something outside ArgoCD keeps changing the object right
after.

The fix is telling ArgoCD to stop comparing the field the webhook owns,
rather than fighting the webhook:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: user-profile-service
      jsonPointers:
        - /spec/template/spec/containers/1
\`\`\`

or, more robustly if ArgoCD is on a version supporting it, exclude
changes made by the webhook's own field manager specifically rather than
a fixed array index:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: user-profile-service
      managedFieldsManagers:
        - "mesh-sidecar-injector"
\`\`\`

Once the injected field is excluded from comparison, the Application
settles into a stable Synced state, and the sidecar keeps being injected
by the webhook exactly as intended - without ArgoCD perpetually
"correcting" something it was never responsible for in the first place.`,
};
