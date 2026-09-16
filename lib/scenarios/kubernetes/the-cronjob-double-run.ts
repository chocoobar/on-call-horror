import type { Scenario } from "../types";

export const theCronjobDoubleRun: Scenario = {
  id: "the-cronjob-double-run",
  title: "The CronJob Double Run",
  subtitle: "the nightly ledger-close job corrupted its own output, and the timestamps don't make sense",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "cronjob", "concurrency"],
  briefing: `The nightly "ledger-close" batch job, which reads and rewrites a shared
summary file, produced garbled, half-overwritten output this morning.
The job is supposed to take about 20 minutes and run once a night. Two
Job objects exist for last night with overlapping run windows.`,
  constraints: [
    "Both Job runs individually completed successfully with exit code 0 - neither one crashed or errored on its own.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "ledger-close", namespace: "finance", labels: { app: "ledger-close" } },
        spec: { schedule: "0 1 * * *", concurrencyPolicy: "Allow", jobTemplate: { spec: { template: { spec: { restartPolicy: "Never" } } } } },
        status: { lastScheduleTime: "2026-09-15T01:00:00Z" },
        age: "2y",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "ledger-close-29130060", namespace: "finance", labels: { app: "ledger-close" } },
        status: { succeeded: 1, startTime: "2026-09-15T01:00:03Z", completionTime: "2026-09-15T01:24:10Z" },
        age: "9h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "ledger-close-manual-rerun", namespace: "finance", labels: { app: "ledger-close" } },
        status: { succeeded: 1, startTime: "2026-09-15T01:11:00Z", completionTime: "2026-09-15T01:33:40Z" },
        age: "9h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ledger-close-overlap-notes", namespace: "finance" },
        spec: {
          data: {
            "notes.md":
              "`ledger-close-manual-rerun` was triggered manually at 01:11 last night\nby an on-call engineer who saw the scheduled 01:00 run's pod briefly\nshow a transient `Pending` state in a monitoring dashboard and assumed\nit had failed to start - it had not; it started normally seconds after\nthe schedule fired and was already running by 01:11. `concurrencyPolicy:\nAllow` (the CronJob default) places no restriction on how many\nconcurrent runs can exist, whether triggered by the schedule or\nmanually, and ledger-close's own script has no locking or idempotency\nprotection against two instances reading and rewriting the same shared\nsummary file at once - the two runs' overlapping read-modify-write\nwindows (01:00-01:24 and 01:11-01:33) directly caused the corrupted\noutput.\n",
          },
        },
        age: "9h",
      },
    ],
  },
  hints: [
    "`kubectl get jobs -n finance` - there are two Job objects for what should be a once-a-night run. Compare their `startTime`/`completionTime` windows.",
    "`kubectl get cronjob ledger-close -n finance -o yaml` - check `spec.concurrencyPolicy`. What does `Allow` (the default) actually permit?",
    "`kubectl get configmap ledger-close-overlap-notes -n finance -o yaml` - where did the second Job actually come from?",
  ],
  options: [
    {
      id: "manual-rerun-overlapped-with-scheduled-run",
      label:
        "An on-call engineer manually triggered a second run at 01:11, mistakenly believing the scheduled 01:00 run had failed to start based on a transient `Pending` state - it had actually started normally - and with `concurrencyPolicy: Allow` (the CronJob default) placing no restriction on concurrent runs, both jobs executed at once with overlapping windows (01:00-01:24 and 01:11-01:33), both reading and rewriting the same shared summary file with no locking between them, which corrupted the output even though each run individually completed successfully.",
      explanation:
        "`ledger-close-overlap-notes` explains the full chain: a manual rerun triggered on a false assumption, permitted to run concurrently because `concurrencyPolicy: Allow` doesn't prevent it, overlapping with the still-running scheduled job for about 13 minutes (01:11 to 01:24). Both Jobs' own status shows `succeeded: 1` - individually correct, but concurrently unsafe given the shared file both were writing to with no coordination between them, which is exactly the kind of corruption two uncoordinated writers produce.",
    },
    {
      id: "cronjob-schedule-fired-twice",
      label: "The CronJob's own schedule accidentally fired twice for the same scheduled time.",
      explanation:
        "Only one Job (`ledger-close-29130060`) carries the CronJob's generated naming pattern and matches `status.lastScheduleTime: 01:00:00` exactly - the second Job (`ledger-close-manual-rerun`) has a distinctly different, manually-chosen name and was started 11 minutes later, both signs of a manual trigger rather than a double-fired schedule.",
    },
    {
      id: "ledger-close-script-bug",
      label: "There's a bug in ledger-close's own script that corrupts output under normal single-run conditions.",
      explanation:
        "Both individual Job runs completed successfully with no errors, and the corruption specifically requires two processes writing to the same file concurrently to explain the garbled, half-overwritten result described - a single-run bug wouldn't produce output that looks like two different writers stepped on each other mid-write.",
    },
    {
      id: "startingdeadline-caused-retry",
      label: "A missed `startingDeadlineSeconds` caused the CronJob controller to retry the run automatically.",
      explanation:
        "The CronJob has no `startingDeadlineSeconds` set (unbounded, so a missed-deadline retry mechanism doesn't apply here), and `ledger-close-overlap-notes` directly attributes the second Job to a manual trigger by an on-call engineer, not any automatic CronJob controller behavior.",
    },
  ],
  correctOptionId: "manual-rerun-overlapped-with-scheduled-run",
  resolution: `\`ledger-close-overlap-notes\` traces the full sequence: the scheduled job
started normally at 01:00:03, but an on-call engineer saw a transient
\`Pending\` state in a dashboard around that time and assumed it had
failed, manually triggering a second run at 01:11 without realizing the
first was already underway. \`concurrencyPolicy: Allow\` - the CronJob
default - places no restriction on how many instances can run at once,
whether scheduled or manually triggered, so both proceeded
simultaneously with an overlapping window from 01:11 to 01:24. Neither
Job's own script has any locking or idempotency protection against two
processes reading and rewriting the same shared summary file at the same
time, which is exactly what produced the garbled, half-overwritten
result - both runs individually "succeeded" because neither one crashed,
they just stepped on each other's writes.

Two complementary fixes. First, change the CronJob's concurrency policy
to prevent this specific failure mode from ever happening again via the
schedule (though it doesn't stop a determined manual trigger):

\`\`\`yaml
spec:
  concurrencyPolicy: Forbid
\`\`\`

\`Forbid\` skips a new scheduled run entirely if the previous one is still
active, rather than letting them overlap. Second, and more fundamentally,
ledger-close's own script should not be safely re-runnable in parallel
with itself at all - adding a simple lock (a lease, a lock file with a
PID/timestamp check, or a transactional write instead of in-place
read-modify-write) would make even an accidental manual overlap safe
rather than corrupting. Finally, worth clarifying for on-call: a
transient \`Pending\` state on a fresh pod is often completely normal for
the first several seconds and isn't itself evidence of failure - a
\`kubectl describe\`/\`get events\` check before assuming a job failed and
manually retriggering it would have avoided this entirely.`,
};
