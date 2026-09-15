import type { Scenario } from "./types";

export const theIgnoreDifferencesTypo: Scenario = {
  id: "the-ignore-differences-typo",
  title: "The ignoreDifferences Typo",
  subtitle: "auth-service shows perpetually Synced, but the replica count keeps drifting anyway",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "ignoredifferences", "drift"],
  briefing: `Someone configured "ignoreDifferences" on "auth-service" months ago to
stop ArgoCD from fighting the HPA over replica count. Today someone
manually (and mistakenly) scaled it to 1 replica during a debugging
session and forgot to scale it back - but the Application still shows
Synced/Healthy, hiding the fact that it's now badly under-provisioned.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-ignore-differences-typo", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/auth-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "auth" },
          syncPolicy: { automated: { prune: true, selfHeal: false } },
          ignoreDifferences: [
            { group: "apps", kind: "Deployment", jsonPointers: ["/spec/replicas"] },
          ],
        },
        status: { sync: { status: "Synced", revision: "b1a2c3d" }, health: { status: "Healthy" } },
        age: "3mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "auth-service", namespace: "auth", labels: { app: "auth-service" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "3h", message: "Scaled down replica set auth-service-5f6g7h to 1 from 8" },
        ],
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get application the-ignore-differences-typo -n argocd -o yaml` - check `spec.ignoreDifferences`. What field does it actually cover, and how broadly?",
    "`kubectl describe deployment auth-service -n auth` - the Events show who scaled it and when.",
    "ignoreDifferences applied cluster/HPA-wide to a Deployment's replica count means ArgoCD will never flag *any* replica count as drift on that resource - including an accidental manual change that has nothing to do with the HPA.",
  ],
  options: [
    {
      id: "ignoredifferences-masks-manual-scale-down",
      label:
        "The Application's ignoreDifferences entry for `/spec/replicas` was added to stop ArgoCD from fighting the HPA, but it's blind to *any* replica-count drift - including this morning's accidental manual scale-down to 1, which ArgoCD now has no way to flag as a problem at all.",
      explanation:
        "The Deployment's own Events show a manual scale-down from 8 to 1 three hours ago - a real, unintended change. But `spec.ignoreDifferences` on the Application blanket-excludes `/spec/replicas` from comparison entirely, so ArgoCD has no visibility into replica count drift whatsoever, whether it's the HPA doing its job or a human mistake. Synced/Healthy is technically accurate (nothing ArgoCD is watching has drifted) but is hiding a real production problem.",
    },
    {
      id: "hpa-actually-scaled-down-typo",
      label: "The HPA legitimately scaled the Deployment down to 1 due to low load.",
      explanation:
        "The Deployment's own Events attribute the scale-down to a plain ScalingReplicaSet event with no HPA rescale event alongside it, and there's no HPA resource shown managing this Deployment at all - this is a manual/external scale, not autoscaler behavior.",
    },
    {
      id: "selfheal-off-hides-it",
      label: "selfHeal being disabled is why ArgoCD isn't correcting the replica count.",
      explanation:
        "selfHeal being off is a red herring here - even with selfHeal on, this specific drift would never be detected or corrected, because ignoreDifferences excludes `/spec/replicas` from comparison entirely; selfHeal only acts on drift ArgoCD actually notices in the first place.",
    },
    {
      id: "deployment-not-tracked-typo",
      label: "The Deployment isn't actually tracked by this Application anymore.",
      explanation:
        "The Application reports Healthy, which requires it to still be evaluating this Deployment's health - an untracked resource wouldn't factor into the Application's health status at all. It's tracked; the specific field that changed is just excluded from diffing.",
    },
  ],
  correctOptionId: "ignoredifferences-masks-manual-scale-down",
  resolution: `The Deployment's Events show a manual scale-down from 8 to 1 replicas
three hours ago - a real, unintended change from a debugging session that
never got reverted. But the Application's \`spec.ignoreDifferences\`
excludes \`/spec/replicas\` from comparison entirely (originally added,
reasonably, to stop ArgoCD fighting an HPA over that field). The tradeoff
of a blanket ignoreDifferences entry is that it makes ArgoCD blind to
*any* change to that field, good or bad - there's no way to distinguish
"the HPA adjusted this" from "someone fat-fingered a manual scale" once
the field is excluded outright.

Immediate fix: scale it back manually to restore capacity:

\`\`\`
kubectl scale deployment auth-service -n auth --replicas=8
\`\`\`

Longer term, if the intent really is "let the HPA manage this and don't
let ArgoCD fight it," a managedFieldsManagers-based exclusion (available
in newer ArgoCD versions) is more precise than a blanket jsonPointers
ignore - it only ignores changes made by the HPA's own field manager,
still catching drift from any other actor:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: auth-service
      managedFieldsManagers:
        - "horizontal-pod-autoscaler"
\`\`\``,
};
