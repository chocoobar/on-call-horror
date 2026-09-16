import type { Scenario } from "../types";

export const theHpaReplicaDiffNoise: Scenario = {
  id: "the-hpa-replica-diff-noise",
  title: "The HPA Replica Diff Noise",
  subtitle: "search-api pages 'OutOfSync' every few minutes for no reason anyone can find",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "hpa", "notifications"],
  briefing: `A Slack alert fires every time "search-api" flips to OutOfSync - which,
since an HPA was added to it two days ago, has been happening every few
minutes around the clock, even though nothing is actually wrong with the
deployment. The on-call channel is now full of noise nobody trusts
anymore.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-hpa-replica-diff-noise",
          namespace: "argocd",
          annotations: { "notifications.argoproj.io/subscribe.on-sync-status-changed.slack": "search-oncall" },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/search-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "search" },
          syncPolicy: { automated: { prune: true, selfHeal: false } },
        },
        status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-api", namespace: "search", labels: { app: "search-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 7, updatedReplicas: 7, availableReplicas: 7 },
        age: "2d",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "search-api", namespace: "search" },
        spec: { minReplicas: 3, maxReplicas: 10, scaleTargetRef: { kind: "Deployment", name: "search-api" } },
        status: { currentReplicas: 7, desiredReplicas: 7 },
        age: "2d",
      },
    ],
  },
  hints: [
    "`argocd app diff the-hpa-replica-diff-noise` - what's the only field it's actually flagging as different?",
    "The Deployment's manifest in git declares `replicas: 4`, but the HPA is legitimately managing it up to 7 based on load - selfHeal is off here, so ArgoCD isn't reverting it, just constantly re-noticing the same expected difference.",
    "The notification subscription is on `on-sync-status-changed` - every flip between Synced and OutOfSync fires it, even when the 'drift' is expected and harmless.",
  ],
  options: [
    {
      id: "hpa-replicas-flagged-as-drift-no-ignore",
      label:
        "The Deployment's replicas field is actively managed by the HPA (currently 7, scaling within its 3-10 range), but nothing tells ArgoCD to ignore that field - so it's perpetually flagged as OutOfSync against git's declared value of 4, and the on-sync-status-changed notification fires every time that flips, purely from normal autoscaling.",
      explanation:
        "`argocd app diff` would show only `/spec/replicas` differing (git: 4, live: 7) - exactly what an HPA actively scaling within its configured range produces, and there's no `ignoreDifferences` entry on this Application excluding that field. Since the notification subscribes to `on-sync-status-changed` rather than something narrower, every time the HPA's desired replica count causes the diff to appear or momentarily resolve, it re-fires - constant noise from entirely expected, harmless behavior.",
    },
    {
      id: "selfheal-fighting-hpa-noise",
      label: "selfHeal is fighting the HPA, repeatedly reverting and re-drifting the replica count.",
      explanation:
        "`spec.syncPolicy.automated.selfHeal` is explicitly `false` here - ArgoCD isn't taking any corrective action on the drift at all, it's simply detecting and reporting the same expected difference repeatedly. There's no revert-then-redrift cycle happening; the Deployment's replica count is left alone by ArgoCD throughout.",
    },
    {
      id: "hpa-metrics-server-flapping-noise",
      label: "The metrics-server feeding the HPA is flapping, causing the HPA to change its mind repeatedly.",
      explanation:
        "The HPA's `status.currentReplicas` and `desiredReplicas` both steadily read 7 - there's no sign of an oscillating or unstable desired count. The notification noise is driven by ArgoCD's repeated re-detection of the same static, expected diff, not by the HPA's decision changing.",
    },
    {
      id: "notifications-controller-retry-loop",
      label: "The argocd-notifications-controller is stuck in a retry loop, resending the same alert.",
      explanation:
        "There's no indication of a stuck retry loop - each alert corresponds to a genuine (if expected and harmless) transition of the Application's sync status, driven by ArgoCD's normal comparison cycle re-noticing the same HPA-driven diff, not a controller malfunction resending identical past alerts.",
    },
  ],
  correctOptionId: "hpa-replicas-flagged-as-drift-no-ignore",
  resolution: `An \`argocd app diff\` shows the only difference is \`/spec/replicas\` -
git declares 4, live state (via the HPA, currently scaled to 7 within its
3-10 range) has drifted. There's no \`ignoreDifferences\` entry excluding
that field on this Application, so ArgoCD's comparison legitimately flags
it as OutOfSync on every reconciliation the HPA's desired count differs
from git's declared value - which, given normal load fluctuation, is
often. The Application's notification subscription is on
\`on-sync-status-changed\`, which fires on every transition between Synced
and OutOfSync, so this expected, harmless HPA-driven diff turns into
constant alert noise.

Fix by excluding the HPA-managed field from comparison, same as any other
HPA-fronted Deployment:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: search-api
      jsonPointers:
        - /spec/replicas
\`\`\`

Once replicas is excluded from the diff, the Application stops flipping
to OutOfSync purely from autoscaling, and the notification stops firing
for something that was never actually a problem. Also worth removing the
now-stale hardcoded \`replicas: 4\` from the Deployment manifest in git,
since it no longer reflects anything meaningful once the HPA fully owns
that field.`,
};
