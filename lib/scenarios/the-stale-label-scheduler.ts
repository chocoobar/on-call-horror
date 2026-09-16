import type { Scenario } from "./types";

export const theStaleLabelScheduler: Scenario = {
  id: "the-stale-label-scheduler",
  title: "The Stale-Label Scheduler",
  subtitle: "low-latency-router keeps landing on the one node it was specifically built to avoid",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "scheduling", "custom-scheduler"],
  briefing: `"low-latency-router" uses a custom scheduler that's supposed to place it
only on nodes labeled \`network-tier: premium\`, avoiding a specific
older, higher-latency node. For the last two deploys, every single
replica has landed on exactly that node anyway - the one the custom
scheduler was built specifically to steer away from.`,
  constraints: [
    "The custom scheduler's pod itself is healthy and actively processing scheduling requests - it isn't down or crash-looping.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "low-latency-router", namespace: "edge", labels: { app: "low-latency-router" } },
        spec: {
          replicas: 3,
          template: { spec: { schedulerName: "latency-aware-scheduler", containers: [{ name: "low-latency-router", image: "registry.internal/low-latency-router:6.0.0" }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "10d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "low-latency-router-8w9x0y1z2-a3b4c", namespace: "edge", labels: { app: "low-latency-router" } },
        spec: { schedulerName: "latency-aware-scheduler", nodeName: "worker-legacy-04" },
        status: { phase: "Running", containerStatuses: [{ name: "low-latency-router", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "worker-legacy-04", labels: { "kubernetes.io/hostname": "worker-legacy-04", "network-tier": "premium" } },
        status: { conditions: [{ type: "Ready", status: "True" }] },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "network-tier-relabel-notes", namespace: "edge" },
        spec: {
          data: {
            "notes.md":
              "`worker-legacy-04` was manually relabeled `network-tier: standard`\nabout 3 weeks ago during a network topology audit that reclassified it\nas the older, higher-latency node it actually is. However, a\nseparate automated node-bootstrap reconciliation job runs nightly and\nresets any node's labels back to a static inventory file if they drift\nfrom what's recorded there - and that inventory file was never updated\nto reflect the relabel, so every night since, the node has been quietly\nreset back to `network-tier: premium`, undoing the manual fix before\nmost deploys even happen.\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get node worker-legacy-04 --show-labels` - what does its `network-tier` label actually say right now?",
    "The custom scheduler is doing exactly what it's told - it's filtering on `network-tier: premium` correctly. The question is whether that label is trustworthy.",
    "`kubectl get configmap network-tier-relabel-notes -n edge -o yaml` - was this node's label ever manually changed, and is anything else touching it since?",
  ],
  options: [
    {
      id: "nightly-reconciliation-reverting-manual-relabel",
      label:
        "worker-legacy-04 was manually relabeled `network-tier: standard` three weeks ago to correctly exclude it, but a separate nightly node-bootstrap reconciliation job resets node labels to match a static inventory file that was never updated - so every night it silently reverts the node back to `network-tier: premium`, making the custom scheduler's `network-tier: premium` filter (working exactly as designed) keep matching a node that was deliberately meant to be excluded.",
      explanation:
        "`network-tier-relabel-notes` explains precisely what's happening: the manual relabel was real and correct, but it never touched the underlying inventory file the nightly reconciliation job treats as the source of truth, so the job keeps quietly reverting it. The custom scheduler isn't misbehaving at all - it's correctly filtering on `network-tier: premium`, it's just being fed a label that gets reset to the wrong value every night before most deploys happen, which is why the fix (the manual relabel) kept appearing to not work.",
    },
    {
      id: "custom-scheduler-ignoring-node-labels",
      label: "latency-aware-scheduler has a bug that ignores node label filters entirely.",
      explanation:
        "The scheduler is correctly matching against whatever the node's *current* `network-tier` label says - the node genuinely does carry `network-tier: premium` at the moment scheduling happens, due to the nightly reconciliation reverting it. The scheduler's filtering logic isn't at fault; the label it's reading is the actual problem.",
    },
    {
      id: "deployment-missing-schedulername",
      label: "The Deployment's pod template is missing the `schedulerName` field, so it falls back to the default scheduler.",
      explanation:
        "The Deployment's template does specify `schedulerName: latency-aware-scheduler`, and the pod that landed on worker-legacy-04 shows the same `schedulerName` set - the custom scheduler is confirmed to be the one making this placement decision, based on a label that's being silently reverted, not a fallback to a different scheduler.",
    },
    {
      id: "node-affinity-conflicting-with-scheduler",
      label: "A separate nodeAffinity rule on the Deployment is overriding the custom scheduler's placement logic.",
      explanation:
        "There's no `nodeAffinity` or `nodeSelector` configured on this Deployment at all - placement is being driven entirely by the custom scheduler's own filtering against node labels, and `network-tier-relabel-notes` directly explains why that filter keeps matching the wrong node: the label itself is being reset, not overridden by a competing rule.",
    },
  ],
  correctOptionId: "nightly-reconciliation-reverting-manual-relabel",
  resolution: `\`network-tier-relabel-notes\` uncovers a fight between two well-intentioned
but uncoordinated systems. Three weeks ago, someone correctly relabeled
\`worker-legacy-04\` to \`network-tier: standard\` after a topology audit
identified it as the higher-latency node it actually is. But a separate,
automated nightly node-bootstrap reconciliation job treats a static
inventory file as the source of truth for node labels and resets
anything that's drifted from it - and that inventory file was never
updated to match the relabel. So every night, the manual fix gets
quietly undone before most deploys even happen, and \`latency-aware-scheduler\`,
which is working exactly as designed, keeps correctly matching a node
that's supposed to be excluded because the label it's reading says
otherwise by the time scheduling actually occurs.

The real fix is updating the source of truth, not just the label:

\`\`\`yaml
# node-inventory.yaml (or whatever the reconciliation job reads)
worker-legacy-04:
  labels:
    network-tier: standard
\`\`\`

so the nightly job stops fighting the manual change - a label edit made
directly with \`kubectl label\` against a node under active automated
reconciliation is only ever a temporary override, not a durable fix,
exactly like an in-place \`kubectl edit\` against anything a controller
actively reconciles. It's worth auditing whether any other nodes have
drifted from this same inventory file in ways nobody's noticed yet,
since the reconciliation job silently reverting "unauthorized" changes
is precisely the kind of thing that erases a fix without leaving any
obvious trace behind.`,
};
