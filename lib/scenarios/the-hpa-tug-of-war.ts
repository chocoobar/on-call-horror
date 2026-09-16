import type { Scenario } from "./types";

export const theHpaTugOfWar: Scenario = {
  id: "the-hpa-tug-of-war",
  title: "The HPA Tug of War",
  subtitle: "video-transcoder's replica count keeps snapping back to 3 during traffic spikes",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 15,
  tags: ["argocd", "hpa", "selfheal"],
  briefing: `"video-transcoder" has a HorizontalPodAutoscaler that should scale it up
to handle traffic spikes. During this afternoon's spike, it scaled to 9
replicas as expected - then dropped back to 3 within about a minute, even
though load hadn't gone down. This keeps happening every time the HPA
tries to scale up.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-hpa-tug-of-war", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/video-transcoder.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "transcoding" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "c9d8e7f" }, health: { status: "Healthy" } },
        age: "4mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "video-transcoder", namespace: "transcoding", labels: { app: "video-transcoder" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "1m", message: "Scaled up replica set video-transcoder-8f7d to 9 from 3" },
          { type: "Normal", reason: "ScalingReplicaSet", age: "45s", message: "Scaled down replica set video-transcoder-8f7d to 3 from 9" },
        ],
        age: "4mo",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "video-transcoder", namespace: "transcoding" },
        spec: { minReplicas: 3, maxReplicas: 12, scaleTargetRef: { kind: "Deployment", name: "video-transcoder" } },
        status: { currentReplicas: 3, desiredReplicas: 9, currentMetrics: [{ type: "Resource" }] },
        events: [
          { type: "Normal", reason: "SuccessfulRescale", age: "1m", message: "New size: 9; reason: cpu resource utilization above target" },
        ],
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get application the-hpa-tug-of-war -n argocd -o yaml` - check `spec.syncPolicy.automated.selfHeal` specifically.",
    "`kubectl describe deployment video-transcoder -n transcoding` - the Events show two scaling operations back to back, in opposite directions, seconds apart.",
    "The Deployment's manifest in git declares `spec.replicas: 3` - what does an Application with selfHeal on do to anything that drifts from what git declares, including replica count the HPA itself changes?",
  ],
  options: [
    {
      id: "selfheal-fights-hpa-easy",
      label:
        "The Deployment manifest in git hardcodes `replicas: 3`, and because this Application has selfHeal enabled, ArgoCD treats every scale-up the HPA performs as unwanted drift and reverts it back to 3 within its next reconciliation - fighting the HPA every single time it tries to do its job.",
      explanation:
        "The Deployment's Events show a scale-up to 9 by the HPA (SuccessfulRescale) immediately followed by a scale-down back to 3, seconds later - not caused by load dropping, but by ArgoCD's selfHeal reverting the replica count to match git's hardcoded `replicas: 3`. This is the textbook selfHeal-vs-HPA conflict: whichever one 'wins' depends on reconciliation timing, but selfHeal will always eventually revert it back toward what git declares.",
    },
    {
      id: "hpa-metrics-flapping",
      label: "The HPA's CPU metrics are flapping, causing it to scale up and back down on its own.",
      explanation:
        "The HPA's own event says `SuccessfulRescale ... New size: 9` - it scaled up because utilization was genuinely above target, and there's no HPA event showing it decided on its own to scale back down. The scale-down event is on the Deployment, driven by something external overriding the replica count, not by the HPA changing its mind.",
    },
    {
      id: "resource-limits-too-low",
      label: "Pod resource limits are too low, causing new replicas to be OOMKilled immediately.",
      explanation:
        "There's no OOMKilled or crash-related event here at all - the Deployment's Events are plain scale-up/scale-down operations, not container failures. The replica count itself is being changed, not failing after creation.",
    },
    {
      id: "pdb-blocking-scale-up",
      label: "A PodDisruptionBudget is blocking the scale-up from completing.",
      explanation:
        "The scale-up actually completed successfully (readyReplicas reached its new size before the scale-down event), and PodDisruptionBudgets govern voluntary evictions/disruptions, not HorizontalPodAutoscaler-driven scale-ups - there's no disruption being blocked here.",
    },
  ],
  correctOptionId: "selfheal-fights-hpa-easy",
  resolution: `The Deployment's Events tell the whole story: the HPA successfully scales
it up to 9 replicas (matching its own \`SuccessfulRescale\` event), and
within about 45 seconds it's scaled back down to 3 - not because load
dropped, but because the Deployment manifest in git still hardcodes
\`spec.replicas: 3\`, and this Application has \`selfHeal: true\`. ArgoCD
treats any live replica count that doesn't match git as drift to correct,
which includes replica counts the HPA itself is actively managing. Every
time the HPA scales up, ArgoCD's next reconciliation scales it right back
down.

The standard fix is to stop declaring \`replicas\` in git for anything an
HPA manages, and tell ArgoCD to ignore that field specifically rather than
disabling selfHeal cluster-wide:

\`\`\`yaml
# on the Application
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: video-transcoder
      jsonPointers:
        - /spec/replicas
\`\`\`

Combined with removing the hardcoded \`replicas: 3\` from the Deployment
manifest in git (so the field simply isn't a declared opinion anymore),
this lets selfHeal keep correcting genuine drift everywhere else while
leaving replica count entirely to the HPA.`,
};
