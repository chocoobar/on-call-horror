import type { Scenario } from "../types";

export const theScalingTugOfWar: Scenario = {
  id: "the-scaling-tug-of-war",
  title: "The Scaling Tug of War",
  subtitle: "api-gateway's replica count keeps snapping back to 3 no matter how it's scaled",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "hpa", "deployment"],
  briefing: `During a traffic spike, someone manually scaled "api-gateway" from 3 to 12
replicas to get ahead of it. Within about a minute, it was back down to 3
- while traffic was still climbing. It's happened on every attempt to
scale it manually since, always reverting to exactly 3.`,
  constraints: [
    "There's no CI/CD pipeline or GitOps controller touching this Deployment's replica count - manual `kubectl scale` is the only thing setting it directly.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "api-gateway", namespace: "edge", labels: { app: "api-gateway" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "api-gateway-hpa", namespace: "edge" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "api-gateway" },
          minReplicas: 3,
          maxReplicas: 15,
          metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 70 } } }],
        },
        status: { currentReplicas: 3, desiredReplicas: 3, currentMetrics: [{ type: "Resource", resource: { name: "cpu", current: { averageUtilization: 12 } } }] },
        events: [
          { type: "Normal", reason: "SuccessfulRescale", age: "50s", message: "New size: 3; reason: All metrics below target" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "api-gateway-traffic-notes", namespace: "edge" },
        spec: {
          data: {
            "notes.md":
              "The traffic spike is real (per the load balancer's request-count\ngraph), but api-gateway's CPU utilization has stayed low (~10-15%)\nthroughout it - this workload is I/O-bound waiting on a slow downstream\ndependency, not CPU-bound, so CPU usage never reflects how loaded it\nactually is. api-gateway-hpa only watches CPU utilization and has no\nother metrics configured.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get hpa api-gateway-hpa -n edge` - check `currentMetrics` against `minReplicas`/`maxReplicas`, and read the most recent `SuccessfulRescale` event's reason.",
    "A HorizontalPodAutoscaler actively manages the Deployment's replica count on its own schedule - any manual `kubectl scale` is only a temporary override until the HPA's next reconcile.",
    "`kubectl get configmap api-gateway-traffic-notes -n edge -o yaml` - is the metric the HPA watches actually representative of how loaded this workload really is?",
  ],
  options: [
    {
      id: "hpa-overriding-manual-scale-on-low-cpu",
      label:
        "api-gateway-hpa is actively managing replicas based on CPU utilization, targeting 70% but currently seeing only ~10-15% because this workload is I/O-bound on a slow downstream dependency rather than CPU-bound - any manual scale-up gets reverted back down to `minReplicas: 3` within about a minute because, from the HPA's only visible metric, the workload looks completely idle and in no need of extra replicas, regardless of real traffic.",
      explanation:
        "The HPA's own event says it directly: \"New size: 3; reason: All metrics below target,\" and `currentMetrics` shows CPU at only 12% against a 70% target. `api-gateway-traffic-notes` explains why that's misleading - the workload is I/O-bound, so real load (the genuine traffic spike, confirmed by the load balancer's own graph) doesn't show up as CPU pressure at all. A HorizontalPodAutoscaler actively reconciles the replica count on its own schedule, so a manual `kubectl scale` is only ever a temporary override that the next HPA reconcile - using a metric that doesn't reflect real load - reverts right back to the minimum.",
    },
    {
      id: "deployment-controller-reverting",
      label: "The Deployment controller itself is resetting `spec.replicas` back to a stored value.",
      explanation:
        "Deployments have no built-in mechanism that reverts a manually-set replica count on its own - that behavior specifically belongs to a HorizontalPodAutoscaler actively managing the same Deployment, which is exactly what's present and actively rescaling here per its own event log.",
    },
    {
      id: "insufficient-node-capacity",
      label: "The cluster doesn't have enough node capacity to sustain 12 replicas, so extras get evicted.",
      explanation:
        "A capacity shortfall would show as some replicas stuck `Pending` rather than the Deployment's `spec.replicas` itself being reduced back to 3 - here the HPA's own event explicitly attributes the resize to a metrics decision (\"All metrics below target\"), not a scheduling failure.",
    },
    {
      id: "pdb-limiting-replica-count",
      label: "A PodDisruptionBudget is capping how many replicas can exist at once.",
      explanation:
        "A PodDisruptionBudget constrains voluntary *evictions* of existing pods, it has no mechanism to cap or reduce a Deployment's desired replica count - the HPA's own event is the direct, attributed cause of the resize back to 3, not any PDB-related limit.",
    },
  ],
  correctOptionId: "hpa-overriding-manual-scale-on-low-cpu",
  resolution: `The HPA's own event says exactly what happened: "New size: 3; reason:
All metrics below target," with \`currentMetrics\` showing CPU at 12%
against a 70% target. \`api-gateway-traffic-notes\` explains the mismatch -
this workload spends most of its time waiting on a slow downstream
dependency rather than burning CPU, so real load (confirmed independently
via the load balancer's request-count graph) simply doesn't register as
CPU pressure. A HorizontalPodAutoscaler reconciles its target's replica
count on its own schedule regardless of who else touches it, so every
manual scale-up was only ever a temporary override that got reverted the
moment the HPA's controller ran again and saw a CPU metric telling it
everything was fine.

The fix is giving the HPA a metric that actually reflects this
workload's real bottleneck - request latency, in-flight request count,
or a custom metric via a metrics adapter, rather than (or in addition to)
CPU:

\`\`\`yaml
metrics:
  - type: Pods
    pods:
      metric: { name: http_requests_in_flight }
      target: { type: AverageValue, averageValue: "20" }
  - type: Resource
    resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
\`\`\`

Multiple metrics on a v2 HPA scale on whichever one currently demands the
most replicas, so keeping CPU alongside a load-representative metric
covers both bottleneck types instead of just one. Until that's in place,
manually scaling this Deployment will keep losing a fight it was never
actually in control of.`,
};
