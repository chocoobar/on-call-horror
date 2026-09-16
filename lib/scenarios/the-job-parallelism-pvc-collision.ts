import type { Scenario } from "./types";

export const theJobParallelismPvcCollision: Scenario = {
  id: "the-job-parallelism-pvc-collision",
  title: "The Job Parallelism PVC Collision",
  subtitle: "a batch resize Job set to run 4-wide only ever gets one pod running at a time",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "jobs", "storage"],
  briefing: `A "thumbnail-batch" Job was configured with \`parallelism: 4\` to process a
large backlog faster by running four workers at once. It's taking exactly
as long as it would with one worker - checking pod status shows only ever
one pod Running at a time, with the others stuck Pending, cycling through
as each one finishes.`,
  constraints: [
    "The cluster has more than enough free node capacity to run all 4 pods simultaneously - this isn't a scheduling capacity issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "thumbnail-batch", namespace: "media", labels: { app: "thumbnail-batch" } },
        spec: { parallelism: 4, completions: 200 },
        status: { active: 1, succeeded: 47 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "thumbnail-batch-x9y8z7", namespace: "media", labels: { app: "thumbnail-batch" } },
        spec: { volumes: [{ name: "workspace", persistentVolumeClaim: { claimName: "thumbnail-batch-workspace" } }] },
        status: { phase: "Running" },
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "thumbnail-batch-a1b2c3", namespace: "media", labels: { app: "thumbnail-batch" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedAttachVolume", age: "2m", message: "Multi-Attach error for volume \"pvc-thumb-work\": Volume is already used by pod(s) thumbnail-batch-x9y8z7" },
        ],
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "thumbnail-batch-workspace", namespace: "media" },
        spec: { storageClassName: "ebs-gp3", accessModes: ["ReadWriteOnce"] },
        status: { phase: "Bound" },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "thumbnail-batch-design-notes", namespace: "media" },
        spec: {
          data: {
            "notes.md":
              "All 4 worker pods spawned by this Job share a single PVC,\n`thumbnail-batch-workspace`, mounted as a common scratch workspace - a\nleftover from when this Job ran with `parallelism: 1`. That PVC's\nStorageClass (`ebs-gp3`) only supports `ReadWriteOnce`, meaning it can\nbe mounted by pods on (in practice, for most block-storage CSI drivers)\nonly one node at a time - every worker pod beyond the first one to grab\nit gets stuck waiting for the volume to free up, which only happens\nonce the current pod using it completes and terminates, single-filing\nall 4 'parallel' workers through the same volume one at a time.\n",
          },
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n media -l app=thumbnail-batch` - only one is ever actually Running, no matter how many should be per `parallelism: 4`.",
    "`kubectl describe pod thumbnail-batch-a1b2c3 -n media` - the event names a specific, well-known volume-attachment error, distinct from a scheduling/capacity failure.",
    "All 4 worker pods reference the exact same PVC - what access mode does that PVC actually support, and what does that mean for more than one pod using it at once?",
  ],
  options: [
    {
      id: "shared-rwo-pvc-serializes-parallel-workers",
      label:
        "All 4 worker pods share a single `ReadWriteOnce` PVC as scratch workspace, a leftover from when this Job ran with `parallelism: 1` - a ReadWriteOnce volume can only be attached to one pod (in practice, one node) at a time, so despite the Job correctly trying to run 4 pods in parallel, only one can ever actually acquire the shared volume at once, and every other worker sits Pending with a Multi-Attach error until the current pod finishes and releases it, fully serializing what was meant to be parallel work.",
      explanation:
        "The Pending pod's own event names the exact mechanism: \"Multi-Attach error... Volume is already used by pod(s) thumbnail-batch-x9y8z7.\" `thumbnail-batch-design-notes` explains the origin - this PVC was designed for single-worker use and never revisited when parallelism was bumped to 4, and `ReadWriteOnce` access mode structurally can't support more than one pod using it at a time, which explains exactly why increasing `parallelism` had zero effect on actual throughput: the pods are all real and correctly created, they're just queued behind each other on the one shared volume.",
    },
    {
      id: "job-parallelism-not-actually-set",
      label: "The Job's `parallelism` field isn't actually set to 4, despite appearing to be.",
      explanation:
        "`spec.parallelism: 4` is confirmed on the Job object, and the Job controller is correctly attempting to create up to 4 pods at once (both pods shown exist and were created) - the field is set correctly and is doing its job; the bottleneck happens afterward, at volume attachment.",
    },
    {
      id: "insufficient-node-capacity-for-4-pods",
      label: "The cluster doesn't have enough node capacity to run 4 pods of this Job simultaneously.",
      explanation:
        "The scenario confirms ample free node capacity, and the Pending pod's own event is specifically a volume Multi-Attach error, not a `FailedScheduling` event about insufficient CPU/memory - this is a storage access-mode constraint, not a capacity shortfall.",
    },
    {
      id: "job-completions-misconfigured",
      label: "The Job's `completions: 200` setting is somehow limiting how many pods can run concurrently.",
      explanation:
        "`completions` governs the total number of successful pod completions the Job needs before it's considered done, not how many can run *concurrently* - that's `parallelism`'s job, and it's set correctly. The concurrency bottleneck is the shared ReadWriteOnce volume, unrelated to the completions target.",
    },
  ],
  correctOptionId: "shared-rwo-pvc-serializes-parallel-workers",
  resolution: `The Pending pod's own event names the exact blocker: "Multi-Attach
error... Volume is already used by pod(s) thumbnail-batch-x9y8z7."
\`thumbnail-batch-design-notes\` explains how this PVC ended up being a
bottleneck: it was set up as shared scratch workspace back when the Job
ran with \`parallelism: 1\`, and nobody revisited it when parallelism was
bumped to 4. Its StorageClass, \`ebs-gp3\`, only supports \`ReadWriteOnce\` -
one pod (practically, one node) at a time - so no matter how many worker
pods the Job controller correctly tries to create in parallel, only one
can ever actually hold the volume; every other worker queues behind it,
fully serializing throughput despite \`parallelism: 4\` working exactly as
configured at the Job-controller level.

The fix depends on what the shared workspace is actually used for. If
each worker genuinely needs its own private scratch space rather than a
shared one, giving each pod its own PVC (or, simpler, an ephemeral
per-pod \`emptyDir\` if the data doesn't need to survive pod restarts)
removes the shared-volume bottleneck entirely:

\`\`\`yaml
spec:
  template:
    spec:
      volumes:
        - name: workspace
          emptyDir: {}   # was: persistentVolumeClaim (shared, RWO)
\`\`\`

If the workers genuinely need to coordinate through shared storage (not
just scratch space), the alternative is a storage class/backend that
supports \`ReadWriteMany\` (like an NFS-backed or EFS-style class), which
allows true concurrent multi-pod access to the same volume. Either way,
this is a good reminder to revisit a workload's storage design any time
its concurrency model changes - a volume access mode chosen for
\`parallelism: 1\` doesn't automatically become safe for \`parallelism: 4\`
just because the Job spec says so.`,
};
