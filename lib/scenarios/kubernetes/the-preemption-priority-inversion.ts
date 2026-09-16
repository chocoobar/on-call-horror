import type { Scenario } from "../types";

export const thePreemptionPriorityInversion: Scenario = {
  id: "the-preemption-priority-inversion",
  title: "The Preemption Priority Inversion",
  subtitle: "a critical alerting pipeline just preempted itself, on a node it already owned",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "priorityclass", "preemption"],
  briefing: `"alert-pipeline" runs at the cluster's highest PriorityClass to
guarantee it's never preempted. A new replica of it, created by a routine
rolling update, was seen preempting an *older, already-running* replica
of the exact same Deployment to schedule itself - which makes no sense on
its face, since both should carry identical priority.`,
  constraints: [
    "There's only one PriorityClass in play here - alert-pipeline's Deployment doesn't mix priority classes across its own replicas by any explicit configuration.",
  ],
  world: {
    resources: [
      {
        apiVersion: "scheduling.k8s.io/v1",
        kind: "PriorityClass",
        metadata: { name: "cluster-critical" },
        spec: { value: 2000000000, globalDefault: false, preemptionPolicy: "PreemptLowerPriority" },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "alert-pipeline", namespace: "observability", labels: { app: "alert-pipeline" } },
        spec: { replicas: 3, template: { spec: { priorityClassName: "cluster-critical", containers: [{ name: "alert-pipeline", image: "registry.internal/alert-pipeline:9.0.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "alert-pipeline-1x2y3z4a5-b6c7d", namespace: "observability", labels: { app: "alert-pipeline" } },
        status: { phase: "Failed", reason: "Preempted", message: "Preempted by a pod triggering preemption and requiring more resources" },
        events: [
          { type: "Normal", reason: "Preempted", age: "3m", message: "Preempted by alert-pipeline-9e0f1g2h3-i4j5k on node worker-19" },
        ],
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "priorityclass-tiebreak-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "When two pods share the exact same numeric PriorityClass value, the\nscheduler's preemption logic doesn't treat them as equally protected -\ngiven a choice of which pod(s) to evict to fit a new, equal-priority pod\nthat otherwise can't be scheduled, it's still willing to preempt an\nexisting pod of the *same* priority if no lower-priority victim is\navailable on any candidate node and the new pod is otherwise\nunschedulable. Today's rolling update created a replacement pod\n(`alert-pipeline-9e0f1g2h3-i4j5k`) that, due to a resource-request bump\nshipped in the same rollout, needed more room than any node had free -\nexcept for room that could be freed by evicting the oldest, lowest\nresource-request pod of the same Deployment (and therefore the same\npriority) sitting right there. With no genuinely lower-priority pod\navailable anywhere as an alternative victim, the scheduler preempted a\nsame-priority sibling instead, rather than leaving the new pod\nunschedulable.\n",
          },
        },
        age: "3m",
      },
    ],
  },
  hints: [
    "`kubectl get pod alert-pipeline-1x2y3z4a5-b6c7d -n observability -o yaml` - the preempting pod's name looks like it's from the same Deployment. Check its own resource requests against the old pod's.",
    "Same-priority preemption sounds like it shouldn't be possible - is it actually forbidden by Kubernetes, or just something that normally doesn't come up?",
    "`kubectl get configmap priorityclass-tiebreak-notes -n observability -o yaml` - did anything about this rollout change how much room a new replica needs?",
  ],
  options: [
    {
      id: "same-priority-preemption-due-to-resource-bump",
      label:
        "Today's rolling update shipped a resource-request bump for alert-pipeline's replicas, and the new replica needed more room than any node had genuinely free - with no lower-priority pod available anywhere as an alternative victim, the scheduler fell back to preempting an existing same-priority sibling from the same Deployment rather than leaving the new pod unschedulable, which is technically legal preemption behavior (same-priority preemption is allowed when no lower-priority victim exists) but produces the confusing appearance of alert-pipeline preempting itself.",
      explanation:
        "The preempted pod's own event names the preemptor as `alert-pipeline-9e0f1g2h3-i4j5k` - a pod from the identical Deployment and PriorityClass. `priorityclass-tiebreak-notes` explains the mechanism directly: Kubernetes' preemption logic doesn't fully protect same-priority pods from each other, only lower-priority ones get preferentially evicted first, and when no such lower-priority victim exists, an equal-priority pod becomes a valid target rather than leaving a legitimately-needed pod unschedulable. The resource-request bump in today's rollout is what made the new pod's larger footprint the actual trigger for needing to evict something at all.",
    },
    {
      id: "two-different-priorityclasses-confused",
      label: "The two pods actually carry two different, similarly-valued PriorityClasses that got confused for being identical.",
      explanation:
        "The scenario explicitly confirms there's only one PriorityClass in play, `cluster-critical`, with no mixing across alert-pipeline's own replicas - both pods use the identical PriorityClass by the same Deployment's single, unchanged pod template, ruling out a priority-value mismatch as the explanation.",
    },
    {
      id: "node-failure-caused-reschedule",
      label: "The node hosting the old pod failed, and the new pod simply took its place afterward.",
      explanation:
        "The old pod's own status is explicit: `reason: Preempted`, with an event directly naming the new pod as the preemptor - this is an active, deliberate scheduler-driven eviction to make room, not a passive reschedule following a node failure, which would show a different reason entirely (like a node NotReady condition).",
    },
    {
      id: "pdb-misconfiguration-caused-eviction",
      label: "A misconfigured PodDisruptionBudget allowed the old pod to be evicted incorrectly.",
      explanation:
        "PodDisruptionBudgets govern *voluntary* disruptions like drains and evictions initiated through the eviction API - preemption is a distinct scheduler mechanism that explicitly bypasses PDB protection entirely by design, since it exists specifically to guarantee a higher (or, in this edge case, equal) priority pod can get the resources it needs.",
    },
  ],
  correctOptionId: "same-priority-preemption-due-to-resource-bump",
  resolution: `The preempted pod's own event is unambiguous: preempted specifically by
\`alert-pipeline-9e0f1g2h3-i4j5k\`, a pod from the exact same Deployment
and therefore the exact same PriorityClass. \`priorityclass-tiebreak-notes\`
explains why Kubernetes allowed what looks like a contradiction: same-priority
preemption isn't actually forbidden, it's just rare in practice,
because the scheduler only reaches for it when no lower-priority victim
is available anywhere and the alternative is leaving a pod that needs to
schedule unschedulable entirely. Today's rolling update shipped a
resource-request increase alongside its usual image bump, so the new
replica genuinely needed more room than any node had free - and with
every other pod on candidate nodes being either equal or higher priority
(alert-pipeline runs at the cluster's highest tier, so there was
essentially nothing lower to preempt instead), the scheduler fell back
to evicting a same-priority sibling rather than blocking the rollout.

This isn't really a bug to "fix" so much as a signal that the cluster's
headroom for this workload's *new* resource footprint wasn't actually
available - the resource-request bump effectively required capacity that
didn't exist, and same-priority preemption was Kubernetes' way of
finding room anyway, at the cost of briefly reducing available replicas
during the rollout. The real fix is ensuring the cluster has genuine
spare capacity sized for the *new* per-replica footprint before shipping
a resource-request increase for a Deployment at the highest priority
tier:

\`\`\`yaml
resources:
  requests: { cpu: "2", memory: 4Gi }   # confirm real headroom exists
                                          # for this * replicas, cluster-wide,
                                          # before rolling out an increase
\`\`\`

More broadly, it's worth pairing any resource-request change for a
cluster-critical-priority workload with an explicit capacity check ahead
of the rollout - at the highest priority tier, there's no lower-priority
"cushion" left for the scheduler to lean on, so an under-provisioned
cluster will resolve the shortfall by preempting the workload's own
siblings instead, which is a confusing and disruptive way to discover a
capacity gap.`,
};
