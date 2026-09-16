import type { Scenario } from "../types";

export const theScaledToZeroMystery: Scenario = {
  id: "the-scaled-to-zero-mystery",
  title: "The Scaled-to-Zero Mystery",
  subtitle: "recon-service has been completely dark for forty minutes, no pods anywhere",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "deployment", "scaling"],
  briefing: `"recon-service" processes an hourly batch reconciliation feed and needs to
be up continuously to keep pace with it. Downstream consumers started
alerting on stale data forty minutes ago. There isn't a single pod for it
running anywhere in the cluster right now.`,
  constraints: [
    "Nothing crashed - there's no CrashLoopBackOff, no OOM, no failed scheduling anywhere in this namespace's recent history.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recon-service", namespace: "reconciliation", labels: { app: "recon-service" } },
        spec: { replicas: 0 },
        status: { readyReplicas: 0, updatedReplicas: 0, availableReplicas: 0 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "40m", message: "Scaled down replica set recon-service-7d8e9f0g1 to 0 from 3" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "recon-service-oncall-notes", namespace: "reconciliation" },
        spec: {
          data: {
            "notes.md":
              "40 minutes ago, an engineer ran `kubectl scale deployment/recon-service\n--replicas=0 -n reconciliation` while debugging an unrelated duplicate-\nprocessing issue in a *different* service that shares recon-service's\ndatabase - the intent was to pause recon-service temporarily to rule it\nout as a cause, with a plan to scale it back up right after. They got\npulled into an unrelated incident immediately afterward and never\nfollowed up.\n",
          },
        },
        age: "35m",
      },
    ],
  },
  hints: [
    "`kubectl get deployment recon-service -n reconciliation -o yaml` - check `spec.replicas` directly, and look at the Deployment's own recent Events.",
    "A `ScalingReplicaSet` event scaling down to exactly 0 is a deliberate action, not a crash - crashes leave failed pods behind, not an absence of any pods at all.",
    "`kubectl get configmap recon-service-oncall-notes -n reconciliation -o yaml` - was there a recent manual intervention that might explain this?",
  ],
  options: [
    {
      id: "manually-scaled-to-zero-and-forgotten",
      label:
        "An engineer manually scaled recon-service to 0 replicas 40 minutes ago while debugging an unrelated issue in a different service, intending it as a temporary pause - they got pulled into another incident immediately after and never scaled it back up, leaving recon-service completely and deliberately offline with nothing actually broken about the Deployment itself.",
      explanation:
        "`spec.replicas: 0` combined with the Deployment's own event - \"Scaled down replica set recon-service-7d8e9f0g1 to 0 from 3\" - confirms a deliberate scale-down, not a crash (there's no CrashLoopBackOff, OOM, or scheduling failure anywhere, consistent with the scenario's own constraint). `recon-service-oncall-notes` supplies the human story: a debugging action from 40 minutes ago that was meant to be temporary but was never followed up on once the engineer got pulled elsewhere.",
    },
    {
      id: "hpa-scaled-down-on-no-traffic",
      label: "A HorizontalPodAutoscaler scaled recon-service down to zero due to lack of traffic.",
      explanation:
        "Standard HorizontalPodAutoscalers require `minReplicas >= 1` and cannot scale a Deployment to 0 - there's no HPA object present here at all, and the Deployment's own event directly attributes the scale-down to a manual action, not an autoscaler decision.",
    },
    {
      id: "namespace-quota-hit",
      label: "A ResourceQuota in the `reconciliation` namespace dropped recon-service's pod count to zero.",
      explanation:
        "A ResourceQuota can only block the *creation* of new pods once a limit is hit - it has no mechanism to reduce an existing Deployment's `spec.replicas` or terminate pods that already exist. The Deployment's own replica count and event both point at a direct, explicit scale-down instead.",
    },
    {
      id: "cluster-autoscaler-removed-nodes",
      label: "The cluster autoscaler removed all the nodes recon-service was running on.",
      explanation:
        "If nodes had been removed out from under running pods, those pods would show as rescheduled elsewhere or stuck `Pending`, not simply absent with `spec.replicas: 0` - the Deployment itself was told to want zero replicas, which is a different situation entirely from losing the nodes to run existing replicas on.",
    },
  ],
  correctOptionId: "manually-scaled-to-zero-and-forgotten",
  resolution: `\`spec.replicas: 0\`, backed by the Deployment's own event - "Scaled down
replica set recon-service-7d8e9f0g1 to 0 from 3" - makes clear this was
a deliberate scale-down, not any kind of crash or eviction (there's
nothing resembling a CrashLoopBackOff, OOM kill, or scheduling failure
anywhere). \`recon-service-oncall-notes\` fills in the human context: an
engineer paused recon-service 40 minutes ago to rule it out while
debugging a duplicate-processing issue elsewhere, fully intending to
scale it back up right after - then got pulled into a separate incident
and the follow-up simply never happened.

The fix is immediate and simple:

\`\`\`bash
kubectl scale deployment/recon-service --replicas=3 -n reconciliation
\`\`\`

followed by confirming it catches up on the backlog of missed hourly
reconciliation runs once it's back up. The real gap here isn't
technical - it's process: a manual, temporary \`kubectl scale\` to 0 on a
continuously-required service is inherently risky without something to
guarantee the follow-up happens, whether that's a calendar reminder, a
paired second engineer, or (better) pausing via a mechanism with a
built-in expiry rather than an open-ended manual scale-down that depends
entirely on someone remembering.`,
};
