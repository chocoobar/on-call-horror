import type { Scenario } from "../types";

export const theTopologySpreadIllusion: Scenario = {
  id: "the-topology-spread-illusion",
  title: "The Topology Spread Illusion",
  subtitle: "an AZ outage took out 5 of 6 replicas of a service that was \"spread across zones\"",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "topology-spread", "availability"],
  briefing: `us-east-1c had a brief but real outage this morning. "orders-api" is
supposed to be spread evenly across three zones specifically to survive
exactly this kind of event - its topologySpreadConstraints have been in
place for months and pass every review. Instead, 5 of its 6 replicas went
down with the zone, leaving exactly 1 pod serving all traffic.`,
  constraints: [
    "topologySpreadConstraints validation never rejected this Deployment - it applies cleanly and the spread looks correct on paper.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "orders-api", namespace: "orders", labels: { app: "orders-api" } },
        spec: {
          replicas: 6,
          template: {
            spec: {
              topologySpreadConstraints: [
                { maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "ScheduleAnyway", labelSelector: { matchLabels: { app: "orders-api" } } },
              ],
              containers: [{ name: "orders-api", image: "registry.internal/orders-api:7.2.0" }],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 6, availableReplicas: 1 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "orders-api-zone-distribution-notes", namespace: "orders" },
        spec: {
          data: {
            "notes.md":
              "Before this morning's outage, orders-api's 6 replicas were distributed\n5 in us-east-1c and 1 in us-east-1a - not the even 2/2/2 split the\ntopologySpreadConstraint was intended to produce. The constraint uses\n`whenUnsatisfiable: ScheduleAnyway`, a soft/best-effort setting: when the\nscheduler can't achieve the target skew (for example because us-east-1c\nhad much more free node capacity than the other two zones at the time\nmost of these replicas were originally scheduled), it schedules the pod\nanyway rather than leaving it Pending, silently drifting away from the\nintended even spread over time as pods were replaced.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n orders -o wide` (or check a recent zone-distribution snapshot) - was the actual spread across zones really even before the outage?",
    "`kubectl get deployment orders-api -n orders -o yaml` - check `whenUnsatisfiable` on the topologySpreadConstraint. What does `ScheduleAnyway` actually guarantee versus `DoNotSchedule`?",
    "A topologySpreadConstraint with `ScheduleAnyway` is a preference the scheduler tries to honor, not a hard requirement it enforces - what happens when honoring it isn't possible at pod-creation time?",
  ],
  options: [
    {
      id: "schedule-anyway-allowed-drift-to-one-zone",
      label:
        "orders-api's topologySpreadConstraint uses `whenUnsatisfiable: ScheduleAnyway`, a soft best-effort setting - when zone capacity wasn't even at various points as replicas were created and replaced over time, the scheduler placed pods anyway rather than leaving them Pending to enforce the spread, and the distribution drifted to 5-in-1c/1-in-1a well before this morning, so when 1c went down, it took nearly the entire service with it despite the constraint technically still being 'in place.'",
      explanation:
        "`orders-api-zone-distribution-notes` confirms the actual pre-outage distribution was 5/0/1 across the three zones, nowhere close to the even 2/2/2 spread the constraint was meant to produce. `whenUnsatisfiable: ScheduleAnyway` is explicitly a preference, not an enforcement: when perfectly even placement isn't achievable at scheduling time, the scheduler places the pod wherever it can rather than blocking it - which is exactly how the distribution could drift lopsided over months of pod churn while the constraint itself remained syntactically present and unchanged, passing every review that only checked for its existence rather than its actual effect.",
    },
    {
      id: "az-outage-too-severe-nothing-would-help",
      label: "A full AZ outage is severe enough that no topology spread configuration could have prevented this.",
      explanation:
        "A truly even 2/2/2 spread across three zones would have limited the blast radius of a single zone's outage to exactly 2 of 6 replicas, not 5 of 6 - the actual, drifted 5/0/1 distribution is what made this outage so much worse than the constraint was designed to prevent, not an inherent limitation of topology spreading itself.",
    },
    {
      id: "nodeaffinity-overriding-spread",
      label: "A conflicting nodeAffinity rule was forcing pods into us-east-1c specifically.",
      explanation:
        "There's no nodeAffinity or nodeSelector configured on this Deployment at all - the only zone-related configuration present is the topologySpreadConstraint itself, and `orders-api-zone-distribution-notes` attributes the drift specifically to `ScheduleAnyway`'s best-effort behavior under uneven zone capacity, not to a competing affinity rule.",
    },
    {
      id: "hpa-scaled-up-only-in-1c",
      label: "An HPA scale-up event added all the new replicas specifically into us-east-1c.",
      explanation:
        "There's no HPA involved with this Deployment - `spec.replicas: 6` is a static value, and the drift toward one zone happened gradually as ordinary pod churn (rollouts, restarts) hit an unevenly-capacitated cluster over months, per the zone-distribution notes, not from a single scale-up event.",
    },
  ],
  correctOptionId: "schedule-anyway-allowed-drift-to-one-zone",
  resolution: `\`orders-api-zone-distribution-notes\` shows the real pre-outage
distribution: 5 replicas in us-east-1c, 1 in us-east-1a, 0 in the third
zone - nothing close to the even spread the constraint was written to
produce. The mechanism is right there in the Deployment's own spec:
\`whenUnsatisfiable: ScheduleAnyway\`. That setting makes the constraint a
soft preference, not an enforced rule - when the scheduler can't achieve
the target skew (here, because one zone had more free node capacity at
various points as pods were created and replaced over 8 months), it
schedules the pod anyway rather than leaving it Pending to protect the
spread. The constraint stayed syntactically present and kept passing
every review that checked for its existence, while the actual live
distribution quietly drifted into exactly the single-zone concentration
it was meant to prevent.

The fix is switching to a hard requirement, at least for a workload
where zone resilience genuinely matters:

\`\`\`yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector: { matchLabels: { app: orders-api } }
\`\`\`

\`DoNotSchedule\` refuses to place a pod anywhere that would violate the
max skew, forcing genuinely even distribution at the cost of a pod
occasionally staying Pending if a zone is temporarily out of capacity -
a real tradeoff, but the right one for a service whose whole reason for
spreading exists to survive a zone failure. It's also worth adding a
periodic check (or alert) on actual live zone distribution for
availability-critical services, since a spread constraint's presence in
a manifest doesn't guarantee its effect held over time.`,
};
