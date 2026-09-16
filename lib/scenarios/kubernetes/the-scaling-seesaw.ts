import type { Scenario } from "../types";

export const theScalingSeesaw: Scenario = {
  id: "the-scaling-seesaw",
  title: "The Scaling Seesaw",
  subtitle: "image-resizer scales from 2 to 20 pods and back every few minutes, all day",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "hpa", "autoscaling"],
  briefing: `"image-resizer" is supposed to scale smoothly with load. Instead it's been
sawtoothing between 2 and 20 replicas every few minutes since it was
deployed, regardless of how steady real traffic actually is. Every scale-up
briefly overwhelms downstream dependencies before scaling right back down.`,
  constraints: [
    "Real incoming traffic to image-resizer has been flat and unremarkable all day, per the load balancer's own request-count graph - whatever's driving the scaling isn't actual demand.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "image-resizer", namespace: "media", labels: { app: "image-resizer" } },
        spec: {
          replicas: 6,
          template: {
            spec: {
              containers: [{ name: "image-resizer", image: "registry.internal/image-resizer:1.8.0" }],
            },
          },
        },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "1mo",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "image-resizer", namespace: "media" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "image-resizer" },
          minReplicas: 2,
          maxReplicas: 20,
          metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 60 } } }],
        },
        status: { currentReplicas: 6, desiredReplicas: 2, currentMetrics: [{ type: "Resource", resource: { name: "cpu", current: { averageUtilization: 12 } } }] },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "image-resizer-notes", namespace: "media" },
        spec: {
          data: {
            "notes.md":
              "image-resizer's container spec has no `resources.requests.cpu` set -\nit was never added when the Deployment was first written, and the HPA\nwas added later without anyone noticing the gap.\n\nEach pod briefly spikes to ~400m CPU while actively resizing an image,\nthen drops to near-zero between requests - actual sustained average load\nacross all pods is low and steady.\n",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`kubectl get hpa image-resizer -n media -o yaml` - it targets CPU `Utilization`, which is a *percentage of the requested* CPU, not an absolute value.",
    "`kubectl get deployment image-resizer -n media -o yaml` - does the container have a `resources.requests.cpu` set at all?",
    "Without a CPU request, the utilization percentage the HPA computes is either undefined or effectively meaningless (implementations vary, but none of them produce a stable, comparable number) - a metric that swings wildly for reasons unrelated to real load will drive a scaling decision that swings just as wildly.",
  ],
  options: [
    {
      id: "hpa-utilization-without-cpu-requests",
      label:
        "image-resizer's containers have no `resources.requests.cpu` set at all, so the HPA's CPU *Utilization* target - which is defined as a percentage of the requested CPU - has no stable baseline to measure against; brief per-pod CPU spikes during active resizing get read as huge utilization swings, and the HPA reacts to that noise instead of real, steady demand.",
      explanation:
        "`image-resizer-notes` confirms there's no CPU request configured, and separately confirms real traffic and average load are flat - the thing swinging wildly is each pod's momentary CPU usage during brief resize bursts, not actual demand. `Utilization`-type HPA metrics are fundamentally a ratio against the pod's CPU *request* - with no request set, that ratio is either undefined or wildly unstable depending on the metrics pipeline's fallback behavior, and either way it can't produce the smooth, comparable signal a stable autoscaling decision needs. The HPA isn't malfunctioning - it's making textbook-correct decisions against a metric that was never meaningful to begin with.",
    },
    {
      id: "hpa-max-too-high",
      label: "`maxReplicas: 20` is too high and is letting the HPA overscale unnecessarily.",
      explanation:
        "`maxReplicas` only sets a ceiling - it doesn't explain why the HPA is driving all the way up to 20 and immediately back down to 2 for load that's confirmed flat all day. The oscillation itself, not the ceiling, is the actual problem, and lowering the ceiling wouldn't stop the underlying flapping.",
    },
    {
      id: "downstream-service-throttling",
      label: "A downstream dependency is throttling image-resizer under load, causing it to compensate by scaling.",
      explanation:
        "The HPA scales purely off image-resizer's own CPU utilization metric - it has no awareness of downstream service behavior at all. Downstream services getting briefly overwhelmed is a *consequence* of the scale-up spikes here, not a signal feeding back into the scaling decision.",
    },
    {
      id: "multiple-hpas-conflicting",
      label: "Two different HPAs are both targeting the same Deployment and fighting each other.",
      explanation:
        "There's exactly one HorizontalPodAutoscaler targeting image-resizer in this namespace - there's no second HPA or competing scaling controller here to conflict with it.",
    },
  ],
  correctOptionId: "hpa-utilization-without-cpu-requests",
  resolution: `\`image-resizer-notes\` confirms both halves of this: real traffic is flat
and steady all day, while individual pods briefly spike to real CPU usage
during active image resizing before dropping back to near-idle - and
critically, the Deployment's containers have no
\`resources.requests.cpu\` set at all.

A CPU \`Utilization\`-type HPA metric is defined as *current usage divided
by the pod's requested CPU*, expressed as a percentage. Without a CPU
request, that ratio has no stable denominator - depending on the metrics
pipeline, it either can't be computed cleanly or ends up wildly unstable,
because "usage as a fraction of nothing meaningful" swings hugely from one
sampling interval to the next, especially for a workload whose per-pod CPU
usage is naturally bursty (busy while resizing, idle between requests).
The HPA is reacting exactly as designed to whatever number it's being fed
- the problem is that the number itself was never a meaningful measure of
real demand.

The fix is giving the Deployment an actual CPU request that reflects
typical usage, so the utilization percentage means something stable:

\`\`\`yaml
resources:
  requests:
    cpu: 200m
  limits:
    cpu: 500m
\`\`\`

Once there's a real request to measure against, the HPA's utilization
percentage tracks genuine sustained load instead of noise from momentary
bursts, and scaling decisions settle down to match how traffic actually
behaves. Any CPU- or memory-based HPA is only as stable as the resource
request it's computing a percentage against - an HPA added onto a
Deployment that was never given requests is a very easy way to end up with
autoscaling that's technically working and practically useless.`,
};
