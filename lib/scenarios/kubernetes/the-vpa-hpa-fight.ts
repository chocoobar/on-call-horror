import type { Scenario } from "../types";

export const theVpaHpaFight: Scenario = {
  id: "the-vpa-hpa-fight",
  title: "The VPA/HPA Fight",
  subtitle: "video-encoder pods keep restarting with new resource values, and replica count won't settle either",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "autoscaling", "vpa"],
  briefing: `"video-encoder" was recently given a VerticalPodAutoscaler to right-size
its resource requests automatically, on top of the HorizontalPodAutoscaler
it's had for over a year. Since then, it's been unstable in a strange way
- pods restart every few minutes with different CPU/memory requests each
time, and replica count swings unpredictably alongside it.`,
  constraints: [
    "Actual traffic/load on video-encoder has been steady - neither autoscaler is reacting to a genuine change in demand.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "video-encoder", namespace: "media", labels: { app: "video-encoder" } },
        spec: { replicas: 4, template: { spec: { containers: [{ name: "video-encoder", image: "registry.internal/video-encoder:3.1.0", resources: { requests: { cpu: "800m", memory: "1.2Gi" } } }] } } },
        status: { readyReplicas: 3, updatedReplicas: 4, availableReplicas: 3 },
        age: "3d",
      },
      {
        apiVersion: "autoscaling.k8s.io/v1",
        kind: "VerticalPodAutoscaler",
        metadata: { name: "video-encoder-vpa", namespace: "media" },
        spec: { targetRef: { kind: "Deployment", name: "video-encoder" }, updatePolicy: { updateMode: "Auto" } },
        status: { recommendation: { containerRecommendations: [{ containerName: "video-encoder", target: { cpu: "650m", memory: "900Mi" } }] } },
        age: "6d",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "video-encoder-hpa", namespace: "media" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "video-encoder" },
          minReplicas: 3,
          maxReplicas: 10,
          metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 70 } } }],
        },
        status: { currentReplicas: 4, desiredReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "video-encoder-autoscaling-notes", namespace: "media" },
        spec: {
          data: {
            "notes.md":
              "video-encoder-vpa runs in `updateMode: Auto`, which means it doesn't\njust recommend new resource requests - it actively evicts and recreates\npods with updated requests whenever its recommendation changes\nmeaningfully. video-encoder-hpa scales on CPU *utilization* (used /\nrequested), a ratio - every time the VPA changes the request denominator,\nthe utilization percentage shifts even with identical real CPU usage,\nwhich can trigger the HPA to scale replica count in response to a change\nthat has nothing to do with actual load. Running a request-mutating VPA\nand a request-relative-metric HPA on the same container is explicitly\ncalled out as an unsupported combination upstream.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get vpa video-encoder-vpa -n media -o yaml` - check `spec.updatePolicy.updateMode`. What does `Auto` actually do to running pods, versus just recommending?",
    "`kubectl get hpa video-encoder-hpa -n media -o yaml` - it scales on CPU *utilization*, which is used-CPU divided by *requested*-CPU - what happens to that ratio if the request itself keeps changing underneath it?",
    "Two autoscalers changing two different but related things (resource requests vs. replica count) on the same Deployment, with one's output feeding the other's input math, is a documented anti-pattern.",
  ],
  options: [
    {
      id: "vpa-auto-mode-destabilizes-hpa-utilization-metric",
      label:
        "video-encoder-vpa runs in `updateMode: Auto`, which evicts and recreates pods with new resource requests whenever its recommendation shifts - and because video-encoder-hpa scales on CPU *utilization* (a ratio of used-over-requested CPU), every VPA-driven request change moves that ratio even with unchanged real load, causing the HPA to react to phantom demand signals and triggering both the constant pod restarts and the erratic replica count, exactly the unsupported combination the platform notes call out.",
      explanation:
        "`video-encoder-autoscaling-notes` names the mechanism and the outcome directly: `updateMode: Auto` actively recreates pods (not just recommends), and the HPA's utilization-based metric is mathematically coupled to the request value the VPA keeps changing - with steady real traffic confirmed by the scenario's own constraint, the only thing actually moving is the request denominator, which is sufficient on its own to explain both the pod churn (VPA evictions) and the replica-count swings (HPA reacting to a shifting ratio) without any real change in load.",
    },
    {
      id: "hpa-misconfigured-target-utilization",
      label: "The HPA's target CPU utilization of 70% is set too aggressively.",
      explanation:
        "A simply-too-aggressive target would produce a steady bias toward more replicas, not the erratic, unstable swings described - and it wouldn't explain the pod *restarts* with changing resource requests at all, which is a distinct symptom directly attributable to the VPA's `Auto` mode evicting and recreating pods, a mechanism the target percentage alone doesn't touch.",
    },
    {
      id: "vpa-recommendation-engine-buggy",
      label: "The VPA's recommendation algorithm itself has a bug producing wildly inconsistent values.",
      explanation:
        "The VPA's current recommendation (650m CPU / 900Mi memory) is a single, reasonable-looking value, not an erratic or nonsensical one - the instability comes from the *interaction* between the VPA actively applying changes and the HPA reacting to the resulting ratio shift, not from the VPA's recommendation itself being wrong or unstable.",
    },
    {
      id: "node-resource-contention",
      label: "video-encoder is contending for resources with other pods on the same nodes.",
      explanation:
        "There's no evidence of resource contention here - no throttling, no pending pods due to insufficient capacity - and the scenario's own constraint confirms load has been steady. The described instability (restarts with changing requests, erratic replica count) matches the VPA/HPA interaction pattern precisely, which doesn't require any node-level contention to occur.",
    },
  ],
  correctOptionId: "vpa-auto-mode-destabilizes-hpa-utilization-metric",
  resolution: `\`video-encoder-autoscaling-notes\` names both halves of the interaction
that's causing this. First, \`video-encoder-vpa\` runs in \`updateMode:
Auto\`, which doesn't just recommend a new resource request - it actively
evicts and recreates pods to apply it, which alone explains the frequent
restarts with different requests each time. Second,
\`video-encoder-hpa\` scales on CPU *utilization*, a ratio of used CPU
over *requested* CPU - so every time the VPA changes that denominator,
the utilization percentage shifts even though real usage (confirmed
steady) hasn't changed at all, and the HPA reacts to that phantom signal
by adjusting replica count. Running a request-mutating VPA and a
request-relative HPA metric on the same container is a documented,
unsupported combination for exactly this reason - the two controllers
end up feeding each other noise.

The standard fix is picking one axis of scaling automation per resource
dimension instead of letting both fight over related ones. Two common
approaches:

\`\`\`yaml
# Option A: VPA in recommendation-only mode, applied manually/periodically
spec:
  updatePolicy:
    updateMode: "Off"   # or "Initial" - VPA recommends, doesn't evict
\`\`\`

\`\`\`yaml
# Option B: keep VPA Auto for memory only, HPA scales on a non-CPU metric
# (e.g. queue depth, in-flight jobs) so the two don't share a denominator
\`\`\`

Given video-encoder is CPU-bound encoding work where horizontal scaling
under real load matters more than automatic vertical right-sizing,
switching the VPA to \`"Off"\` (recommendation-only, reviewed and applied
by hand periodically) while leaving the HPA in full control of CPU-based
scaling removes the feedback loop entirely and lets both signals be
trusted again.`,
};
