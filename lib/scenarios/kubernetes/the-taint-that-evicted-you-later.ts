import type { Scenario } from "../types";

export const theTaintThatEvictedYouLater: Scenario = {
  id: "the-taint-that-evicted-you-later",
  title: "The Taint That Evicted You Later",
  subtitle: "batch-runner pods get killed exactly five minutes into every job, without fail",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "taints", "eviction"],
  briefing: `"batch-runner" jobs typically take 15-20 minutes to finish. For the last
two days, every single run gets killed at almost exactly the five-minute
mark, mid-processing, with no application error - just gone. The pods
schedule fine and run normally right up until that point.`,
  constraints: [
    "The node the pod lands on stays Ready and healthy the entire time - it isn't failing or being drained.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "batch-runner-7j8k9l0m1", namespace: "batch", labels: { app: "batch-runner" } },
        status: { phase: "Running", containerStatuses: [{ name: "batch-runner", ready: true, restartCount: 0, state: { running: {} } }] },
        spec: {
          tolerations: [{ key: "spot-instance", operator: "Exists", effect: "NoExecute", tolerationSeconds: 300 }],
        },
        events: [
          { type: "Normal", reason: "TaintManagerEviction", age: "10s", message: "Marked for deletion Taint spot-instance=true:NoExecute" },
        ],
        logs: { "batch-runner": ["2026-09-15T09:05:00.010Z INFO  batch.Worker - processing item 4021 of 18000..."] },
        age: "5m",
      },
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "spot-worker-22", labels: { "kubernetes.io/hostname": "spot-worker-22" } },
        spec: { taints: [{ key: "spot-instance", value: "true", effect: "NoExecute" }] },
        status: { conditions: [{ type: "Ready", status: "True" }] },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "spot-pool-rollout-notes", namespace: "batch" },
        spec: {
          data: {
            "notes.md":
              "Two days ago, a new spot-instance node pool was added and tainted with\n`spot-instance=true:NoExecute` from the moment nodes join - the taint is\napplied immediately at node creation, not only when a spot reclaim\nnotice actually arrives. batch-runner's pod spec tolerates this taint\nwith `tolerationSeconds: 300`, a value copied from an unrelated\nshort-lived web service's manifest during the same rollout - meaning any\npod landing on one of these nodes is automatically evicted exactly 300\nseconds (5 minutes) after the taint is first observed as present,\nregardless of whether a real spot reclaim is happening or not.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get pod batch-runner-7j8k9l0m1 -n batch -o yaml` - check `spec.tolerations` for a `NoExecute` toleration with a `tolerationSeconds` value.",
    "`kubectl describe node <node the pod is on>` - check for a `NoExecute` taint. Is it applied all the time, or only during a real event?",
    "`tolerationSeconds` on a `NoExecute` toleration is a countdown: once the tainted condition is observed, the pod is evicted after that many seconds, no matter what it's doing.",
  ],
  options: [
    {
      id: "tolerationseconds-300-on-permanent-taint",
      label:
        "spot-worker-22 (and the rest of the new spot-instance node pool) carries a `spot-instance=true:NoExecute` taint permanently, from the moment each node joins - not just during an actual spot reclaim - and batch-runner's pod tolerates it with `tolerationSeconds: 300`, a value copied from an unrelated short-lived service, so every batch-runner pod that lands on one of these nodes is automatically evicted exactly 5 minutes later regardless of whether any real reclaim is happening, which is far too short for a 15-20 minute job.",
      explanation:
        "The pod's own event - \"Marked for deletion Taint spot-instance=true:NoExecute\" - fires at the 5-minute mark, matching `tolerationSeconds: 300` exactly. `spot-pool-rollout-notes` explains why this is happening to every run: the taint is present on these nodes at all times, not only during a genuine reclaim event, so the 300-second toleration countdown starts the instant the pod is scheduled there and runs out well before a normal 15-20 minute job can finish - regardless of the node itself staying perfectly healthy throughout, which matches the scenario's own observation.",
    },
    {
      id: "livenessprobe-killing-pod",
      label: "A misconfigured liveness probe is killing the pod at the 5-minute mark.",
      explanation:
        "The pod's own event explicitly attributes the termination to a taint-based eviction (`TaintManagerEviction`), not a failed liveness probe - there's no `Unhealthy` event or probe-related reason anywhere in the pod's status, which rules out a probe as the mechanism here.",
    },
    {
      id: "job-activedeadlineseconds-too-short",
      label: "The Job's `activeDeadlineSeconds` is set to 300, cutting it off early.",
      explanation:
        "The termination event is specifically a taint-driven eviction naming the `spot-instance` taint, not a Job-level deadline expiration (which would show a different reason, like `DeadlineExceeded`, on the Job itself) - the mechanism here is node-side eviction via `NoExecute` and `tolerationSeconds`, not a Job spec setting.",
    },
    {
      id: "real-spot-reclaim-happening",
      label: "This node pool is genuinely being reclaimed by the cloud provider every 5 minutes.",
      explanation:
        "The node itself stays `Ready: True` throughout, per the scenario's own constraint - a real spot reclaim would take the node away entirely, not leave it healthy and present while just evicting one pod off it. `spot-pool-rollout-notes` confirms the taint is applied unconditionally at node creation, independent of any actual reclaim event.",
    },
  ],
  correctOptionId: "tolerationseconds-300-on-permanent-taint",
  resolution: `The pod's own event names the exact mechanism: "Marked for deletion Taint
spot-instance=true:NoExecute," firing right at the 5-minute mark - which
lines up exactly with its \`tolerationSeconds: 300\`. \`spot-pool-rollout-notes\`
explains why every single run hits this: the new spot-instance node pool
applies its \`NoExecute\` taint permanently from the moment a node joins,
not only when a real spot-reclaim notice arrives, and batch-runner's
toleration of \`300\` seconds was copied from an unrelated short-lived
service's manifest rather than chosen for this workload. The result is a
countdown that starts the instant the pod lands on one of these nodes and
expires long before a normal 15-20 minute batch job can finish -
regardless of the node's actual health, which is exactly why nothing
about the node itself looks wrong.

Two real fixes, and the right one depends on intent. If batch-runner
should tolerate living on spot nodes long enough to actually finish its
work (accepting the real risk of a genuine reclaim mid-run), the
toleration needs a duration that matches the job's real runtime:

\`\`\`yaml
tolerations:
  - key: spot-instance
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 1800   # comfortably covers a 15-20 min job
\`\`\`

If batch-runner shouldn't run on spot instances at all given how
disruptive an interruption mid-job would be, the more robust fix is not
tolerating the taint whatsoever, so the scheduler simply never places it
there in the first place - forcing it onto the regular, non-spot node
pool instead. Either way, \`tolerationSeconds\` values should never be
copied wholesale between workloads with very different runtime
characteristics - what's a safe grace period for a short-lived web
request is nowhere near enough for a long batch job.`,
};
