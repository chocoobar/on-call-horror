import type { Scenario } from "../types";

export const theHpaSelfhealStandoff: Scenario = {
  id: "the-hpa-selfheal-standoff",
  title: "The HPA / selfHeal Standoff",
  subtitle: "streaming-gateway's Application flips Synced/OutOfSync roughly once a minute, all day",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "hpa", "selfheal"],
  briefing: `"streaming-gateway" scales aggressively with load via an HPA, and someone
set up dashboards to track ArgoCD's "time since last sync" as a rough
deploy-freshness signal for the whole org. That dashboard has been nearly
useless for this Application - it re-syncs constantly, dozens of times an
hour, even during periods with no actual deploys or manual changes at
all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-hpa-selfheal-standoff", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/streaming-gateway.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "streaming" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "f1a2b3c" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "streaming-gateway", namespace: "streaming", labels: { app: "streaming-gateway" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "3m", message: "Scaled up replica set streaming-gateway-6d7e to 9 from 6" },
          { type: "Normal", reason: "ScalingReplicaSet", age: "1m", message: "Scaled down replica set streaming-gateway-6d7e to 6 from 9" },
        ],
        age: "1y",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "streaming-gateway", namespace: "streaming" },
        spec: { minReplicas: 4, maxReplicas: 20, scaleTargetRef: { kind: "Deployment", name: "streaming-gateway" } },
        status: { currentReplicas: 6, desiredReplicas: 6 },
        age: "1y",
      },
    ],
  },
  hints: [
    "`argocd app diff the-hpa-selfheal-standoff` right after one of the scaling events - what field shows a difference, even momentarily?",
    "`kubectl describe deployment streaming-gateway -n streaming` - the Events show the HPA scaling up and back down within minutes, which is completely normal for variable load.",
    "With selfHeal on and no ignoreDifferences for replicas, every HPA-driven change - even a brief, legitimate one - is something ArgoCD notices and reacts to as drift needing a sync.",
  ],
  options: [
    {
      id: "selfheal-syncing-every-hpa-scale-event",
      label:
        "The Deployment's replicas field isn't excluded from comparison, so every time the HPA scales the Deployment up or down in response to normal load variation, ArgoCD's selfHeal treats the new replica count as drift and triggers a sync to 'correct' it back toward git's declared value - even though the HPA's own scaling is completely legitimate and expected.",
      explanation:
        "The Deployment's Events show the HPA scaling up to 9 and back down to 6 within a couple minutes - completely normal, healthy autoscaling behavior for variable load. With no `ignoreDifferences` entry for `/spec/replicas` on this Application and selfHeal enabled, ArgoCD's comparison flags every one of these transient replica-count changes as drift, triggering a sync each time, dozens of times a day, purely from the HPA doing its job.",
    },
    {
      id: "hpa-thrashing-genuine-problem",
      label: "The HPA itself is misconfigured and thrashing between scale-up and scale-down unnecessarily.",
      explanation:
        "Scaling from 6 to 9 and back to 6 within a few minutes, tracking genuinely variable load, is normal HPA behavior, not thrashing on a stable signal - there's no indication of an unstable or flapping metric here. The actual issue is ArgoCD reacting to each legitimate scaling event as if it were unwanted drift, not the HPA's own decision-making.",
    },
    {
      id: "dashboard-metric-wrong",
      label: "The dashboard's 'time since last sync' metric is being calculated incorrectly.",
      explanation:
        "The dashboard is accurately reporting what it's designed to report - ArgoCD genuinely is re-syncing constantly. The dashboard isn't miscalculating anything; it's correctly surfacing a real, if misleading-for-its-intended-purpose, high sync frequency driven by HPA/selfHeal interaction.",
    },
    {
      id: "automated-prune-causing-resyncs",
      label: "Automated pruning is what's triggering the repeated sync operations.",
      explanation:
        "Pruning acts on resources that are no longer declared in git at all - it has no bearing on a Deployment's replica count field changing due to the HPA, which is a live-state field drift issue, not a prune-eligible orphaned-resource issue.",
    },
  ],
  correctOptionId: "selfheal-syncing-every-hpa-scale-event",
  resolution: `The Deployment's Events confirm completely normal HPA behavior: scaling
up to 9 and back down to 6 within a couple of minutes, tracking real load
variation. The actual problem is that this Application has no
\`ignoreDifferences\` entry for \`/spec/replicas\`, so every one of those
legitimate, transient scaling events is something ArgoCD's comparison
notices as drift from git's declared replica count - and with selfHeal
on, each one triggers a fresh sync to "correct" it, dozens of times a
day, purely as a side effect of the HPA doing exactly what it's supposed
to.

Fix by excluding the HPA-managed field from comparison, same pattern as
any other HPA-fronted Deployment:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: streaming-gateway
      jsonPointers:
        - /spec/replicas
\`\`\`

Also worth removing the now-stale hardcoded \`replicas: 6\` from the
Deployment manifest in git, since the HPA fully owns that field in
practice. Once replicas is excluded, sync frequency drops to reflect
actual deploys and drift again, and the org's "time since last sync"
dashboard becomes a meaningful freshness signal for this Application
instead of noise dominated by autoscaling.`,
};
