import type { Scenario } from "../types";

export const thePodsThatWouldntCleanUp: Scenario = {
  id: "the-pods-that-wouldnt-clean-up",
  title: "The Pods That Wouldn't Clean Up",
  subtitle: "the etl-batch namespace has 400 Completed/Error pods and climbing",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "jobs", "cleanup"],
  briefing: `A cluster capacity alert fired for the "etl-batch" namespace - not on
CPU or memory, on pod count. \`kubectl get pods\` there returns hundreds of
entries, almost all in \`Completed\` or \`Error\` state from a Job that runs
every few minutes. Nothing is actually broken, but the sheer number of
dead pod objects is starting to slow down \`kubectl\` operations in the
namespace.`,
  constraints: [
    "Each individual Job run itself succeeds or fails normally and quickly - this isn't about jobs hanging or retrying excessively.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "etl-batch", namespace: "etl-batch", labels: { app: "etl-batch" } },
        spec: { schedule: "*/5 * * * *", jobTemplate: { spec: { template: { spec: { restartPolicy: "Never" } } } } },
        status: { lastScheduleTime: "2026-09-15T11:55:00Z" },
        age: "60d",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "etl-batch-29129395", namespace: "etl-batch", labels: { app: "etl-batch" } },
        status: { succeeded: 1 },
        age: "5m",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "etl-batch-29129390", namespace: "etl-batch", labels: { app: "etl-batch" } },
        status: { succeeded: 1 },
        age: "10m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "etl-batch-capacity-notes", namespace: "etl-batch" },
        spec: {
          data: {
            "notes.md":
              "CronJob has run every 5 minutes for 60 days = roughly 17,000 Job runs,\neach leaving behind exactly one completed pod (`restartPolicy: Never`\nmeans a finished pod is never reused or removed by the Job controller\nitself). Neither the CronJob nor its jobTemplate sets `ttlSecondsAfterFinished`,\nand the CronJob's `successfulJobsHistoryLimit`/`failedJobsHistoryLimit`\nare both left at their defaults (3/1) - those only limit how many old\n*Job objects* are kept, not the pods those Jobs already created, which\nlinger indefinitely once their owning Job is itself garbage collected\nout of the history limit only up to a point, leaving a large backlog\naccumulated before anyone noticed.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n etl-batch | wc -l` - and check how many of those are actually `Completed`/`Error` versus genuinely running.",
    "With `restartPolicy: Never`, a Job's pod isn't deleted when it finishes - it's kept around as a record, by default, forever.",
    "`kubectl get cronjob etl-batch -n etl-batch -o yaml` - is there a `ttlSecondsAfterFinished` set anywhere in the jobTemplate?",
  ],
  options: [
    {
      id: "no-ttl-after-finished",
      label:
        "etl-batch's CronJob has run every 5 minutes for 60 days with `restartPolicy: Never` and no `ttlSecondsAfterFinished` set anywhere in its jobTemplate - each completed pod is simply kept forever by default rather than cleaned up, and at roughly 17,000 runs over 60 days, that's accumulated into hundreds of dead pod objects sitting in the namespace indefinitely.",
      explanation:
        "`etl-batch-capacity-notes` lays out the math directly: a 5-minute schedule over 60 days times `restartPolicy: Never` (which never reuses or auto-deletes a finished pod) with no `ttlSecondsAfterFinished` configured anywhere means nothing has ever cleaned these pods up automatically. `successfulJobsHistoryLimit`/`failedJobsHistoryLimit` only bound how many old *Job objects* are retained, which is a separate, smaller cleanup than the pods those Jobs create - explaining why the pod count is so much larger than what CronJob history limits alone would suggest.",
    },
    {
      id: "cronjob-firing-too-often",
      label: "The CronJob's schedule is misconfigured to fire far more often than intended.",
      explanation:
        "`*/5 * * * *` is a standard, deliberately-configured 5-minute schedule, not a runaway misconfiguration - the pod accumulation isn't from excessive firing frequency, it's from nothing ever removing the pods that a completely normal firing rate has produced over 60 days.",
    },
    {
      id: "jobs-stuck-retrying",
      label: "Each Job run is retrying repeatedly before eventually succeeding, multiplying pod count.",
      explanation:
        "Both shown Job objects report `succeeded: 1` cleanly with no failure/retry history, and the scenario confirms each run succeeds or fails normally and quickly - the pod count problem is about pods never being removed after they finish, not about excessive retries per run.",
    },
    {
      id: "namespace-quota-misconfigured",
      label: "A misconfigured ResourceQuota is preventing old pods from being garbage collected.",
      explanation:
        "ResourceQuotas constrain what can be *created*, they have no mechanism that prevents existing, already-completed pod objects from being deleted - nothing here is trying to delete these pods and being blocked; nothing is trying to delete them at all, by default.",
    },
  ],
  correctOptionId: "no-ttl-after-finished",
  resolution: `\`etl-batch-capacity-notes\` does the math: a 5-minute schedule over 60 days
is roughly 17,000 Job runs, and with \`restartPolicy: Never\`, each one's
pod sits around as a permanent record unless something explicitly cleans
it up. Nothing does - there's no \`ttlSecondsAfterFinished\` set in the
jobTemplate. The CronJob's own \`successfulJobsHistoryLimit\` and
\`failedJobsHistoryLimit\` (defaults of 3 and 1) only bound how many old
*Job* objects are kept - a much smaller, separate cleanup from the pods
those Jobs create, which is why the pod count vastly outpaced what
anyone watching just Job history would have expected.

The fix is setting a TTL so finished Job pods (and the Job object itself)
are automatically garbage collected some time after completion:

\`\`\`yaml
spec:
  jobTemplate:
    spec:
      ttlSecondsAfterFinished: 3600   # clean up 1h after a run finishes
      template:
        spec:
          restartPolicy: Never
\`\`\`

For the existing backlog, a one-time cleanup of already-completed pods
is also needed (the TTL controller only acts on Jobs created after it's
configured, not retroactively on old ones):

\`\`\`bash
kubectl delete pods -n etl-batch --field-selector=status.phase=Succeeded
kubectl delete pods -n etl-batch --field-selector=status.phase=Failed
\`\`\`

\`ttlSecondsAfterFinished\` (the TTL-after-finished controller) exists
specifically for high-frequency Jobs like this one - without it, any
CronJob running often enough will eventually accumulate exactly this
kind of silent, slow-motion object sprawl.`,
};
