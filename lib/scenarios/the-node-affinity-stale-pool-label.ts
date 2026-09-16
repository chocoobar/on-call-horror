import type { Scenario } from "./types";

export const theNodeAffinityStalePoolLabel: Scenario = {
  id: "the-node-affinity-stale-pool-label",
  title: "The Node Affinity Stale Pool Label",
  subtitle: "compliance-archiver has been unable to schedule a single pod since last week's node pool rename",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "affinity", "nodes"],
  briefing: `"compliance-archiver" is required (by a security policy) to only run on a
specific hardened node pool, enforced via a required \`nodeAffinity\` rule
referencing that pool's name. Since the infrastructure team renamed the
node pool last week as part of an unrelated cost-tracking initiative,
compliance-archiver's pods have been stuck Pending - and because it only
runs a few times a day, nobody noticed until today's run silently failed
to happen at all.`,
  constraints: [
    "The hardened node pool itself still exists, is healthy, and has capacity - only its name changed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "compliance-archiver", namespace: "compliance", labels: { app: "compliance-archiver" } },
        spec: {
          schedule: "0 */6 * * *",
          jobTemplate: {
            spec: {
              template: {
                spec: {
                  affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: "node-pool", operator: "In", values: ["hardened-compliance"] }] }] } } },
                  containers: [{ name: "compliance-archiver", image: "registry.internal/compliance-archiver:1.4.0" }],
                },
              },
            },
          },
        },
        status: { lastScheduleTime: "2026-09-15T06:00:00Z" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "compliance-archiver-29129370-x8y9z", namespace: "compliance", labels: { app: "compliance-archiver" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "3h", message: "0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector." },
        ],
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nodepool-rename-notes", namespace: "compliance" },
        spec: {
          data: {
            "notes.md":
              "Last week, the hardened compliance node pool was renamed from\n`hardened-compliance` to `compliance-hardened-v2` as part of an\ninfra-wide effort to standardize node pool naming for cost-allocation\ntagging - the nodes themselves were relabeled to match, in place,\nwithout being replaced or drained. compliance-archiver's CronJob\n(defined in a separate repo the infra team doesn't own or review\nchanges to) still hard-codes the old pool name, `hardened-compliance`,\nin its required nodeAffinity rule, which now matches zero nodes.\n",
          },
        },
        age: "6d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod compliance-archiver-29129370-x8y9z -n compliance` - a node-affinity mismatch, not a resource shortage.",
    "`kubectl get nodes -l node-pool=hardened-compliance` versus checking what label value the hardened nodes actually carry today.",
    "`kubectl get configmap nodepool-rename-notes -n compliance -o yaml` - did the node pool this CronJob depends on change recently, even just its name?",
  ],
  options: [
    {
      id: "required-nodeaffinity-references-renamed-pool",
      label:
        "compliance-archiver's required nodeAffinity rule hard-codes the old node pool label value `hardened-compliance`, but the pool was renamed to `compliance-hardened-v2` (relabeled in place) last week as part of an unrelated cost-tracking naming standardization - the CronJob's manifest, owned separately from the infra team that did the rename, was never updated to match, so its required affinity now matches zero nodes even though the underlying hardened pool itself is completely healthy and available.",
      explanation:
        "The `FailedScheduling` event's wording - \"didn't match Pod's node affinity/selector\" - points specifically at an affinity mismatch, not a capacity problem. `nodepool-rename-notes` explains exactly what changed and why compliance-archiver's own manifest didn't keep up: the rename was an infra-team-led standardization that relabeled nodes in place, in a system compliance-archiver's own repo/team doesn't own or get reviewed against, so the hardcoded old pool name in its required nodeAffinity simply stopped matching anything the moment the label changed.",
    },
    {
      id: "hardened-pool-decommissioned",
      label: "The hardened compliance node pool was decommissioned entirely.",
      explanation:
        "`nodepool-rename-notes` confirms the pool itself still exists, healthy and with capacity - it was renamed in place, not removed. compliance-archiver's own constraint also states the target pool still exists and is available; only the label value referencing it changed.",
    },
    {
      id: "cronjob-schedule-broken",
      label: "The CronJob's schedule expression itself stopped firing correctly.",
      explanation:
        "`status.lastScheduleTime` shows the CronJob firing right on schedule (6-hour intervals), and a Job/Pod object genuinely exists for the most recent run - the CronJob triggered correctly; the resulting pod simply can't be scheduled onto any node due to the affinity mismatch, which is a separate failure occurring after the trigger.",
    },
    {
      id: "security-policy-blocking-scheduling",
      label: "A separate admission-level security policy is now blocking compliance-archiver from being scheduled.",
      explanation:
        "There's no admission-webhook rejection or policy-denial event here - the failure is a standard scheduler-level `FailedScheduling` event citing a node affinity mismatch, the specific and well-defined mechanism for \"no node matches this pod's required placement rule,\" not an admission-time policy block.",
    },
  ],
  correctOptionId: "required-nodeaffinity-references-renamed-pool",
  resolution: `The scheduling event's wording - "didn't match Pod's node
affinity/selector" - is specific to an affinity mismatch, and the target
pool is confirmed healthy with capacity, ruling out a resource shortage.
\`nodepool-rename-notes\` explains the actual change: the hardened
compliance pool was renamed from \`hardened-compliance\` to
\`compliance-hardened-v2\` last week, relabeled in place by the infra team
as part of an unrelated cost-tracking naming initiative. compliance-archiver's
CronJob, owned and maintained in a separate repository the infra team
doesn't review changes against, still hard-codes the old pool name in
its required nodeAffinity rule - a rule that now matches exactly zero
nodes. Because this CronJob only runs a few times a day and nobody was
specifically watching for its Pending pods, the failure went unnoticed
until an entire scheduled run silently never happened at all - a
particularly risky outcome for anything compliance-related.

The fix is updating the nodeAffinity rule to the current pool label:

\`\`\`yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: node-pool
              operator: In
              values: ["compliance-hardened-v2"]
\`\`\`

Beyond the immediate fix, this is a strong argument for the infra team
treating a node pool rename as a breaking change requiring coordinated
communication (or better, a stable secondary label that doesn't change
across renames, like \`node-pool-role: hardened-compliance\`, which
workloads select on instead of a name tied to a naming convention that
might change again). It's also worth adding alerting on this CronJob's
own success/failure specifically, given how easily an infrequent,
compliance-critical job's silent scheduling failure can go unnoticed for
days.`,
};
