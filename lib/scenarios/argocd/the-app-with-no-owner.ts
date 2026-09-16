import type { Scenario } from "../types";

export const theAppWithNoOwner: Scenario = {
  id: "the-app-with-no-owner",
  title: "The App With No Owner",
  subtitle: "argocd app resources shows warning-that-shouldn't-be-there on half of shipping-tracker's Deployment",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 15,
  tags: ["argocd", "resource-tracking", "labels"],
  briefing: `"shipping-tracker" was migrated last week from an older Helm-based
deployment process onto ArgoCD. Since then, "argocd app resources" shows
its own Deployment listed with an orphaned/no-owner style warning, even
though the Application itself reports Synced and Healthy, and the
Deployment is clearly running exactly what's in git.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-app-with-no-owner", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/shipping-tracker.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "shipping" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "5e4d3c2" }, health: { status: "Healthy" } },
        age: "1w",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "shipping-tracker",
          namespace: "shipping",
          labels: { app: "shipping-tracker", "app.kubernetes.io/instance": "shipping-tracker-legacy-helm-release" },
        },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        events: [
          { type: "Warning", reason: "ResourceOutOfSync", age: "5d", message: "Resource shipping/Deployment/shipping-tracker has no recognized ArgoCD tracking annotation or matching instance label; ownership is ambiguous" },
        ],
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get deployment shipping-tracker -n shipping -o yaml` - look closely at the `app.kubernetes.io/instance` label's actual value.",
    "ArgoCD's default resource tracking method matches resources to an Application by the `app.kubernetes.io/instance` label equaling the Application's name - here the Deployment's label still carries a leftover value.",
    "This Deployment predates the ArgoCD migration - what tool originally set its instance label, and did anyone update it during the migration?",
  ],
  options: [
    {
      id: "leftover-instance-label-from-old-helm-release",
      label:
        "The Deployment still carries the `app.kubernetes.io/instance` label from its old, pre-migration Helm release name instead of the ArgoCD Application's name, so ArgoCD's default label-based tracking can't confidently match it to this Application, producing the no-owner warning even though the Application is otherwise successfully managing it.",
      explanation:
        "The Deployment's `app.kubernetes.io/instance` label reads `shipping-tracker-legacy-helm-release` - a leftover from the pre-migration Helm release name - rather than `the-app-with-no-owner` (the Application's actual name, which ArgoCD's default label-based tracking expects to match). The Application still applies and manages it correctly via other means, but tracking-by-label sees a mismatched label and flags ambiguous ownership, exactly matching the ResourceOutOfSync event.",
    },
    {
      id: "two-applications-conflict-owner",
      label: "A second, different Application is also trying to manage this same Deployment.",
      explanation:
        "There's only one Application here, and it reports Synced/Healthy with no conflicting operation errors - a genuine two-Applications-fighting-over-one-resource scenario would show drift or repeated re-applies from both sides, not a clean single-owner sync with a labeling mismatch warning.",
    },
    {
      id: "rbac-blocks-ownership-check",
      label: "ArgoCD's ServiceAccount lacks permission to read the Deployment's labels.",
      explanation:
        "ArgoCD clearly can read and manage the Deployment fine - it's Synced and Healthy, meaning ArgoCD successfully compared and applied against it. The warning is about the label's *value* not matching what tracking expects, not about being unable to read it at all.",
    },
    {
      id: "namespace-selector-picked-up-resource",
      label: "A namespace-wide resource selector is picking up this Deployment unintentionally.",
      explanation:
        "ArgoCD Applications don't use a namespace-wide selector to discover unrelated resources by default - this Deployment is legitimately declared in this Application's own git manifests. The mismatch is specifically in the tracking label's value, not in an over-broad selection mechanism.",
    },
  ],
  correctOptionId: "leftover-instance-label-from-old-helm-release",
  resolution: `The Deployment's \`app.kubernetes.io/instance\` label still reads
\`shipping-tracker-legacy-helm-release\` - carried over from the
pre-migration Helm release rather than being updated to
\`the-app-with-no-owner\`, the actual ArgoCD Application name that
label-based tracking expects to match. ArgoCD's default resource tracking
method compares this label against the Application's own name to
establish ownership; a mismatch here produces exactly the ambiguous-
ownership warning seen in the Deployment's events, even though ArgoCD is,
in practice, still successfully applying and managing it via its own
apply operations.

Fix by correcting the label to match what tracking expects (either
directly, or by letting the next sync re-apply it if the manifest in git
is updated):

\`\`\`yaml
metadata:
  labels:
    app.kubernetes.io/instance: the-app-with-no-owner
\`\`\`

If dozens of resources came over from the same legacy Helm release with
the same stale label, it's worth switching this Application to
annotation-based tracking instead (\`argocd.argoproj.io/tracking-id\`,
via \`application.resourceTrackingMethod: annotation\` in
\`argocd-cm\`), which doesn't depend on a specific label value at all and
avoids this exact class of migration leftover going forward.`,
};
