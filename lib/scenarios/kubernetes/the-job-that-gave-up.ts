import type { Scenario } from "../types";

export const theJobThatGaveUp: Scenario = {
  id: "the-job-that-gave-up",
  title: "The Job That Gave Up",
  subtitle: "the nightly ledger-reconcile Job never produced last night's output file",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "jobs", "batch"],
  briefing: `The finance team's daily reconciliation report wasn't in its usual place
this morning. The "ledger-reconcile" Job that generates it ran at 2 AM as
scheduled by its CronJob - or at least, something happened at 2 AM. There
are no alerts about it, and nothing currently shows as failing.`,
  constraints: [
    "The CronJob itself triggered on schedule, on time - the problem is entirely about what happened to the Job it created.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "ledger-reconcile", namespace: "finance", labels: { app: "ledger-reconcile" } },
        spec: { schedule: "0 2 * * *", jobTemplate: { spec: { backoffLimit: 3, template: { spec: { restartPolicy: "Never" } } } } },
        status: { lastScheduleTime: "2026-09-15T02:00:00Z" },
        age: "1y",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "ledger-reconcile-29123480", namespace: "finance", labels: { app: "ledger-reconcile" } },
        spec: { backoffLimit: 3 },
        status: { failed: 4, succeeded: 0, conditions: [{ type: "Failed", status: "True", reason: "BackoffLimitExceeded", message: "Job has reached the specified backoff limit" }] },
        age: "7h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ledger-reconcile-29123480-9zabc", namespace: "finance", labels: { app: "ledger-reconcile" } },
        status: { phase: "Failed", containerStatuses: [{ name: "ledger-reconcile", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "ledger-reconcile": [
            "2026-09-15T02:00:04.220Z INFO  reconcile.Loader - connecting to ledger-db-replica.finance.svc:5432",
            "2026-09-15T02:00:34.551Z FATAL reconcile.Loader - connection to ledger-db-replica timed out after 30s",
          ],
        },
        age: "7h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ledger-db-maintenance-notes", namespace: "finance" },
        spec: {
          data: {
            "notes.md":
              "ledger-db-replica had a scheduled maintenance window last night from\n01:45 to 02:20 for a routine patch version upgrade, during which the\nreplica was unreachable. This was announced in #finance-eng three days\nago and considered low-risk since no interactive traffic hits the\nreplica at that hour.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get jobs -n finance` - the CronJob triggered fine; check what happened to the Job object it created.",
    "`kubectl describe job ledger-reconcile-29123480 -n finance` - a `BackoffLimitExceeded` condition means every attempt failed, not that it never ran.",
    "`kubectl logs ledger-reconcile-29123480-9zabc -n finance` - why did each attempt actually fail? Was it the reconciliation logic itself, or something it depends on?",
  ],
  options: [
    {
      id: "backoff-exhausted-during-db-maintenance",
      label:
        "Every one of the Job's 4 attempts (the initial try plus backoffLimit: 3 retries) failed to connect to ledger-db-replica because they landed inside its scheduled 01:45-02:20 maintenance window - once the backoff limit was exhausted, the Job gave up permanently and marked itself Failed, and because restartPolicy is Never with no alert wired to Job failures, nobody was notified.",
      explanation:
        "The Job's own status shows `failed: 4` and a `BackoffLimitExceeded` condition - it did retry, four times total, and every attempt failed the same way. The pod's log shows a connection timeout to `ledger-db-replica` at 02:00:34, squarely inside the maintenance window `ledger-db-maintenance-notes` documents (01:45-02:20). The Job's retries were simply unlucky enough to be entirely contained within that 35-minute window, so no attempt had a chance to succeed, and a Job reaching `BackoffLimitExceeded` doesn't retry again on its own or raise any alert by default - it just sits there Failed.",
    },
    {
      id: "cronjob-never-triggered",
      label: "The CronJob's schedule never actually fired at 2 AM.",
      explanation:
        "`status.lastScheduleTime` is `2026-09-15T02:00:00Z`, exactly on schedule, and a Job object with 4 failed pod attempts clearly exists - the CronJob did trigger correctly, the problem happened after that, inside the Job's own execution attempts.",
    },
    {
      id: "reconcile-logic-bug",
      label: "There's a bug in ledger-reconcile's reconciliation logic that's producing incorrect output.",
      explanation:
        "The pod's log shows it never got past establishing a database connection - it never reached any reconciliation logic at all. This is a connectivity failure during startup, not a logic bug in code that never ran.",
    },
    {
      id: "job-still-running",
      label: "The Job is still running and just hasn't finished yet.",
      explanation:
        "The Job's own `status.conditions` explicitly shows `type: Failed, status: True, reason: BackoffLimitExceeded` - it isn't in progress, it has definitively stopped and given up after exhausting its retry budget seven hours ago.",
    },
  ],
  correctOptionId: "backoff-exhausted-during-db-maintenance",
  resolution: `The Job's status is explicit: \`failed: 4\`, condition
\`BackoffLimitExceeded\`. It did retry - the initial attempt plus all 3
retries from \`backoffLimit: 3\` - but the pod logs show every attempt
timing out trying to reach \`ledger-db-replica\` at 02:00:34.
\`ledger-db-maintenance-notes\` explains why: the replica had a planned
maintenance window from 01:45 to 02:20, and the Job's entire retry
sequence (with Kubernetes' exponential backoff between attempts) happened
to fit entirely inside that 35-minute window, so not a single attempt had
a live database to connect to. Once \`backoffLimit\` is exhausted, a Job
with \`restartPolicy: Never\` just stops - it doesn't wait and try again
later, and by default nothing pages anyone when that happens.

There's no live fix from this read-only console, but the Job can simply
be re-run manually now that the database is back:

\`\`\`bash
kubectl create job --from=cronjob/ledger-reconcile ledger-reconcile-manual-rerun -n finance
\`\`\`

Longer term, two gaps are worth closing: alerting on Job \`Failed\`
conditions in this namespace (so a silent overnight failure doesn't wait
for someone to notice a missing report), and either scheduling
maintenance windows to avoid known batch job times, or giving
\`ledger-reconcile\` a longer \`activeDeadlineSeconds\`/backoff spread so a
short, known maintenance window doesn't consume its entire retry budget.`,
};
