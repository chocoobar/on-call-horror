import type { Scenario } from "./types";
import type { K8sObject } from "./types";

function apiPod(n: number): K8sObject {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: `api-6c8d7f9b4-${String(n).padStart(4, "0")}`, namespace: "api", labels: { app: "api" } },
    status: { phase: "Running", containerStatuses: [{ name: "api", ready: true, restartCount: 0, state: { running: {} } }] },
    age: "9m",
  };
}

export const driftInTheDark: Scenario = {
  id: "drift-in-the-dark",
  title: "Drift in the Dark",
  subtitle: "someone kubectl-edited prod and ArgoCD noticed",
  difficulty: "medium",
  type: "do",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "drift", "self-heal"],
  briefing: `A teammate "just this once" ran a live kubectl change against the "api"
Deployment instead of going through the GitOps repo, because it was an
emergency and they didn't want to wait for a PR review.

The emergency has passed. ArgoCD now shows the "drift-in-the-dark"
Application as OutOfSync, and it isn't correcting itself - this Application
does not have selfHeal enabled, on purpose, so accidental drift doesn't get
silently reverted before anyone notices it.`,
  constraints: [
    "The manual change should be reverted, not adopted into git - it wasn't an intentional capacity change.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "drift-in-the-dark", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "api" },
          syncPolicy: { automated: { prune: true, selfHeal: false } },
        },
        status: { sync: { status: "OutOfSync", revision: "9f1a2b3c4d5e" }, health: { status: "Healthy" } },
        age: "2h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "api", namespace: "api", labels: { app: "api" } },
        spec: { replicas: 5 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 5 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "9m", message: "Scaled up replica set api-6c8d7f9b4 to 5 from 2" },
        ],
        age: "2h",
      },
      apiPod(1),
      apiPod(2),
      apiPod(3),
      apiPod(4),
      apiPod(5),
    ],
    argocdDiff: {
      "drift-in-the-dark": [
        "===== apps/Deployment api/api ======",
        "9,9c9,9",
        "<   replicas: 2",
        "---",
        ">   replicas: 5",
      ].join("\n"),
    },
  },
  hints: [
    "`kubectl get application drift-in-the-dark -n argocd` - what does sync status say, and what does health status say? Those two rarely disagree like this without a reason.",
    "`argocd app diff drift-in-the-dark` will show you exactly which field disagrees between git and live state.",
    "`kubectl describe deployment api -n api` - the Events section shows who/what actually changed the replica count and when.",
  ],
  options: [
    {
      id: "git-changed",
      label: "The Deployment manifest in git was changed to request 5 replicas.",
      explanation:
        "It's the opposite: the diff shows git still declares 2 replicas (the `<` side), and live state has drifted to 5 (the `>` side). Nothing in git changed.",
    },
    {
      id: "manual-scale-no-selfheal",
      label: "Someone manually scaled the Deployment with kubectl, and selfHeal is disabled so ArgoCD won't auto-revert the drift.",
      explanation:
        "`argocd app diff` shows live replicas (5) don't match git's declared value (2), the Deployment's own Events show a ScalingReplicaSet event with no corresponding sync operation, and the Application's syncPolicy has selfHeal: false - so ArgoCD flags the drift (OutOfSync) but won't correct it automatically.",
    },
    {
      id: "automated-disabled",
      label: "The Application's automated sync policy is completely disabled.",
      explanation:
        "Automated sync is still on (prune: true) - only selfHeal is off. That's an important distinction: ArgoCD would still auto-sync a change from git, it just won't fight live drift on its own.",
    },
    {
      id: "project-blocks-scale",
      label: "The AppProject blocks scaling operations on this Application.",
      explanation:
        "AppProjects don't have a concept of blocking \"scaling\" specifically, and there's no permission-related condition on this Application - the sync status/health/diff all point at plain drift, not an authorization error.",
    },
  ],
  correctOptionId: "manual-scale-no-selfheal",
  resolution: `\`argocd app diff drift-in-the-dark\` shows live replicas (5) don't match what
git declares (2). The Deployment's own Events include a ScalingReplicaSet
entry with no ArgoCD sync operation behind it - a live, out-of-band
\`kubectl scale\`. Because this Application's \`syncPolicy.automated.selfHeal\`
is \`false\`, ArgoCD deliberately left the drift in place instead of
reverting it silently.

To reconcile: \`argocd app sync drift-in-the-dark\` (or manually
\`kubectl scale deployment/api -n api --replicas=2\`) brings live state back
in line with git, and the Application returns to Synced.`,
};
