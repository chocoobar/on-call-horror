import type { Scenario } from "./types";

export const thePriorityEvictionSurprise: Scenario = {
  id: "the-priority-eviction-surprise",
  title: "The Priority Eviction Surprise",
  subtitle: "metrics-collector got evicted to make room for a batch job nobody flagged as urgent",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "priorityclass", "scheduling"],
  briefing: `A new one-off data-migration Job was submitted to a full node pool this
morning. It scheduled immediately. Thirty seconds later, "metrics-collector"
- a long-running, business-important pod that had been happily running on
that same node for weeks - was gone, terminated, with a Preempted-style
event nobody expected to see on it.`,
  constraints: [
    "The node pool genuinely had no free capacity at the time - this isn't a case where preemption happened unnecessarily due to available room elsewhere.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "metrics-collector-7a8b9c0-d1e2f", namespace: "observability", labels: { app: "metrics-collector" } },
        status: { phase: "Failed", reason: "Preempted", message: "Preempted by a pod triggering preemption and requiring more resources" },
        events: [
          { type: "Normal", reason: "Preempted", age: "20m", message: "Preempted by data-migration-x7k2p on node worker-14" },
        ],
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "data-migration-x7k2p", namespace: "data-eng", labels: { app: "data-migration" } },
        spec: { priorityClassName: "urgent-batch", nodeName: "worker-14" },
        status: { phase: "Running" },
        age: "20m",
      },
      {
        apiVersion: "scheduling.k8s.io/v1",
        kind: "PriorityClass",
        metadata: { name: "urgent-batch" },
        spec: { value: 1000000, globalDefault: false, description: "For time-sensitive one-off batch jobs" },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "priorityclass-catalog-notes", namespace: "data-eng" },
        spec: {
          data: {
            "notes.md":
              "`urgent-batch` PriorityClass (value 1,000,000) was created 2 months\nago for genuinely time-critical one-off jobs, intended to be requested\nsparingly with team-lead sign-off. metrics-collector (and most\nlong-running platform services) have no priorityClassName set at all,\nwhich defaults to priority 0 - the lowest possible. Any pod using\n`urgent-batch` will always outrank an unset-priority pod for scheduling\nand preemption purposes, regardless of how important that unset-priority\npod actually is to the business.\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "`kubectl get pod metrics-collector-7a8b9c0-d1e2f -n observability -o yaml` - check its `status.reason` and the `Preempted` event for who triggered it.",
    "`kubectl get pod data-migration-x7k2p -n data-eng -o yaml` - what `priorityClassName` does it use, and what's that PriorityClass's numeric `value`?",
    "What priority does a pod get when it doesn't specify `priorityClassName` at all?",
  ],
  options: [
    {
      id: "unset-priority-outranked-by-urgent-batch",
      label:
        "data-migration-x7k2p was submitted with `priorityClassName: urgent-batch` (value 1,000,000), while metrics-collector has no priorityClassName set at all, which defaults to priority 0 - on a full node, the scheduler preempted the lowest-priority pod it could find to make room for the higher-priority one, and metrics-collector lost purely on priority value, with no consideration of how business-critical it actually is.",
      explanation:
        "metrics-collector's own status shows `reason: Preempted`, and the event names `data-migration-x7k2p` as the preemptor. That pod uses `priorityClassName: urgent-batch`, worth 1,000,000 - astronomically higher than the default priority (0) that any pod without an explicit `priorityClassName` receives, metrics-collector included. `priorityclass-catalog-notes` confirms this is exactly how `urgent-batch` is meant to behave: it will always outrank an unset-priority pod, regardless of the unset-priority pod's real-world importance, because Kubernetes' preemption logic only knows about the numeric value, not business context.",
    },
    {
      id: "metrics-collector-crashed",
      label: "metrics-collector crashed on its own around the same time, coincidentally.",
      explanation:
        "`status.reason: Preempted` and the matching event naming `data-migration-x7k2p` as the trigger are unambiguous - this was a scheduler-initiated preemption, not a coincidental self-inflicted crash. There's no crash log or restart count involved at all; the pod was terminated by the scheduler to free resources.",
    },
    {
      id: "node-worker-14-failed",
      label: "worker-14 itself failed or was drained, taking metrics-collector down with it.",
      explanation:
        "data-migration-x7k2p is confirmed `Running` on `worker-14` right now - the node is healthy and actively hosting a pod. If the node had failed or been drained, the new pod couldn't have landed there either; this is a single-pod preemption, not a node-wide event.",
    },
    {
      id: "resourcequota-evicted-collector",
      label: "A ResourceQuota change evicted metrics-collector to make room within a namespace budget.",
      explanation:
        "ResourceQuotas cap what can be newly created within a namespace - they don't reach into a different namespace (metrics-collector is in `observability`, the migration job in `data-eng`) and forcibly remove an already-running pod. The actual mechanism here, per the pod's own status and event, is scheduler preemption based on PriorityClass, not quota enforcement.",
    },
  ],
  correctOptionId: "unset-priority-outranked-by-urgent-batch",
  resolution: `metrics-collector's own status says it plainly: \`reason: Preempted\`, with
an event naming \`data-migration-x7k2p\` as the pod that triggered it.
That pod carries \`priorityClassName: urgent-batch\`, worth 1,000,000 -
compared to the default priority of 0 that any pod without an explicit
\`priorityClassName\` gets, which includes metrics-collector.
\`priorityclass-catalog-notes\` confirms this is working exactly as the
PriorityClass was designed: on a full node, the scheduler evicts
whatever lower-priority pod it needs to in order to fit a higher-priority
one, using only the numeric priority value - it has no idea that
metrics-collector happens to be business-critical, because nothing ever
told it that.

The fix has two parts. Immediately, metrics-collector needs to be
rescheduled (it should already be Pending somewhere, or can be manually
recreated) - and to stop this from recurring, business-critical
long-running services need an explicit priority that reflects their
actual importance, rather than silently defaulting to the lowest
possible value:

\`\`\`yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: { name: platform-critical }
value: 100000
globalDefault: false
description: For always-on platform services that should not be preempted casually
\`\`\`

\`\`\`yaml
spec:
  template:
    spec:
      priorityClassName: platform-critical
\`\`\`

More broadly, this is a sign the cluster's PriorityClass catalog needs a
sane default for un-labeled workloads - leaving critical services at the
implicit priority-0 floor means *any* pod with a PriorityClass at all can
bump them, intentionally or not.`,
};
