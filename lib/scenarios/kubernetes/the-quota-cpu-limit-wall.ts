import type { Scenario } from "../types";

export const theQuotaCpuLimitWall: Scenario = {
  id: "the-quota-cpu-limit-wall",
  title: "The Quota CPU Limit Wall",
  subtitle: "scaling up video-transcoder for a launch event fails partway through, with no obvious reason why",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "resourcequota", "scaling"],
  briefing: `Ahead of a product launch, "video-transcoder" was scaled from 5 to 15
replicas to handle expected load. Only 9 replicas ever came up. The
remaining 6 aren't crashing, erroring, or showing as Pending with a
scheduling failure - they simply don't exist as Pod objects at all.`,
  constraints: [
    "There's ample free node capacity across the cluster for all 15 replicas - this isn't about running out of physical room.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "video-transcoder", namespace: "media", labels: { app: "video-transcoder" } },
        spec: {
          replicas: 15,
          template: { spec: { containers: [{ name: "video-transcoder", image: "registry.internal/video-transcoder:8.1.0", resources: { requests: { cpu: "2" }, limits: { cpu: "4" } } }] } },
        },
        status: { readyReplicas: 9, updatedReplicas: 9, availableReplicas: 9 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ResourceQuota",
        metadata: { name: "media-team-quota", namespace: "media" },
        spec: { hard: { "limits.cpu": "40" } },
        status: { used: { "limits.cpu": "40" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "media-quota-launch-notes", namespace: "media" },
        spec: {
          data: {
            "notes.md":
              "media-team-quota caps `limits.cpu` at 40 cores for the whole namespace.\nEach video-transcoder replica has a CPU *limit* of 4 cores (even though\nit only *requests* 2), so 40 cores of limit-quota only covers 10\nreplicas (40 / 4 = 10) - not the 15 that were requested, and not even\nbased on the more modest 2-core request. Other smaller services sharing\nthis namespace's quota already account for the difference between 10\nand the 9 that actually came up. The ReplicaSet's own Events (not the\nDeployment's) record each of the 6 rejected pod-creation attempts with a\nquota-specific error.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get replicaset -n media -l app=video-transcoder` and `kubectl describe` it - check its own Events, not just the Deployment's.",
    "`kubectl get resourcequota media-team-quota -n media -o yaml` - compare `status.used` against `spec.hard` closely. Which specific dimension is at its ceiling?",
    "A container's CPU *limit* can be set much higher than its *request* - which one does `limits.cpu` in a ResourceQuota actually track?",
  ],
  options: [
    {
      id: "limits-cpu-quota-exhausted-by-4core-limit",
      label:
        "media-team-quota caps `limits.cpu` at 40 cores namespace-wide, and each video-transcoder replica has a CPU limit of 4 cores (double its 2-core request) - so 40 cores of limit-quota only ever supported 10 replicas at most, and with other services in the namespace already consuming some of that budget, only 9 of the requested 15 replicas could actually be created before the quota's `limits.cpu` ceiling was hit, silently blocking pod creation for the rest with no scheduling-level symptom at all.",
      explanation:
        "`media-team-quota`'s own status shows `used.limits.cpu` already at its `hard` ceiling of 40. `media-quota-launch-notes` does the math: each replica's 4-core limit means the quota supports far fewer replicas than its 40-core number might suggest at a glance, especially once other namespace tenants' own usage is accounted for. This is a ResourceQuota rejection at Pod-creation time (visible on the ReplicaSet's own Events, not the Deployment's), which explains exactly why the missing 6 replicas never existed as Pod objects at all rather than showing up Pending with a scheduling failure - the objects were never created in the first place.",
    },
    {
      id: "insufficient-cluster-capacity",
      label: "The cluster doesn't have enough total CPU capacity across nodes for 15 replicas.",
      explanation:
        "The scenario confirms ample free node capacity cluster-wide, and more directly, missing replicas that never even exist as Pod objects (rather than existing and sitting Pending due to a scheduling failure) point at something blocking pod *creation* itself - which is exactly what a ResourceQuota rejection does, distinct from a node-capacity scheduling problem.",
    },
    {
      id: "hpa-capping-replicas",
      label: "A HorizontalPodAutoscaler's `maxReplicas` is capping the Deployment below 15.",
      explanation:
        "There's no HorizontalPodAutoscaler present on this Deployment at all - `spec.replicas: 15` was set directly, and the shortfall is explained by a ResourceQuota rejection at the CPU-limit dimension, a distinct and unrelated mechanism from HPA-imposed replica ceilings.",
    },
    {
      id: "image-pull-throttling",
      label: "The registry is throttling concurrent image pulls, slowing down how many replicas can start at once.",
      explanation:
        "Throttled image pulls would show as pods stuck `Pending` or `ImagePullBackOff` while still existing as real Pod objects, rather than the 6 missing replicas simply never being created at all - which is specifically what happens when ResourceQuota admission rejects the pod-creation request before a Pod object is even persisted.",
    },
  ],
  correctOptionId: "limits-cpu-quota-exhausted-by-4core-limit",
  resolution: `\`media-team-quota\`'s status shows \`used.limits.cpu\` sitting exactly at its
\`hard\` ceiling of 40. \`media-quota-launch-notes\` explains the math that
makes this so easy to miss at a glance: each video-transcoder replica
carries a CPU *limit* of 4 cores, double its 2-core request, so the
40-core quota budget - which tracks *limits*, not requests - only ever
supported 10 replicas at the absolute most, and other tenants sharing
this namespace's quota already accounted for the difference between that
theoretical 10 and the 9 that actually came up. This is a ResourceQuota
admission rejection happening at Pod-creation time, which is why the
missing 6 replicas never existed as Pod objects at all - no
\`Pending\`, no scheduling failure, just an absence, with the actual
rejection recorded only on the ReplicaSet's own Events rather than
anywhere more visible.

There's no live fix from this read-only console, but the real options
are: raise the namespace's \`limits.cpu\` quota to actually support the
launch's target replica count (coordinating with whoever owns quota
budgeting, since other tenants share it), or reduce video-transcoder's
per-replica CPU limit if 4 cores has more headroom than it actually
needs under real load:

\`\`\`yaml
spec:
  hard:
    limits.cpu: "70"   # covers 15 replicas at 4 cores, plus existing tenants
\`\`\`

For the future, it's worth sizing ResourceQuota \`limits.cpu\` values with
an explicit awareness of what a single replica's *limit* (not just its
request) actually costs against the budget - a quota number that looks
generous in isolation can turn out to only support a fraction of the
replicas a launch-time scale-up actually needs, and the failure mode (pods
simply never created) gives no obvious signal pointing back at quota
unless someone specifically checks the ReplicaSet's own events.`,
};
