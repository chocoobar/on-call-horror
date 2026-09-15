import type { Scenario } from "./types";

export const theMissedCronWindow: Scenario = {
  id: "the-missed-cron-window",
  title: "The Missed Cron Window",
  subtitle: "the hourly inventory-sync just didn't run at 14:00, no trace of it anywhere",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "cronjob", "scheduling"],
  briefing: `"inventory-sync" runs every hour to reconcile warehouse stock counts with
the storefront. It ran fine at 13:00 and 15:00 today, but there's no Job
and no pod anywhere for 14:00 - not failed, not pending, simply absent, as
if that hour never happened.`,
  constraints: [
    "The CronJob controller itself was healthy and running the entire time - this isn't a control-plane outage.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "inventory-sync", namespace: "warehouse", labels: { app: "inventory-sync" } },
        spec: { schedule: "0 * * * *", startingDeadlineSeconds: 30, concurrencyPolicy: "Forbid", jobTemplate: { spec: { template: { spec: { restartPolicy: "Never" } } } } },
        status: { lastScheduleTime: "2026-09-15T15:00:00Z" },
        age: "1y",
        events: [
          { type: "Warning", reason: "MissSchedule", age: "1h", message: "Missed scheduled time 2026-09-15 14:00:00 +0000 UTC. Starting job may have been delayed past startingDeadlineSeconds." },
        ],
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "inventory-sync-29129400", namespace: "warehouse", labels: { app: "inventory-sync" } },
        status: { succeeded: 1 },
        age: "3h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "inventory-sync-29129460", namespace: "warehouse", labels: { app: "inventory-sync" } },
        status: { succeeded: 1 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "control-plane-incident-notes", namespace: "warehouse" },
        spec: {
          data: {
            "notes.md":
              "The kube-controller-manager leader pod restarted at 13:59:40 today\nduring an unrelated cluster upgrade step and took about 90 seconds to\nhand off leadership and resume normal reconciliation. Nothing else in\nthe cluster was affected - it was back to normal well before 14:01.\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl get jobs -n warehouse` - there's a Job for 13:00 and 15:00, but a clear gap at 14:00.",
    "`kubectl describe cronjob inventory-sync -n warehouse` - check its own Events for anything mentioning a missed schedule.",
    "`spec.startingDeadlineSeconds: 30` is a strict window - if the controller can't start the Job within 30 seconds of its scheduled time, it skips that run entirely rather than starting it late.",
  ],
  options: [
    {
      id: "controller-restart-exceeded-deadline",
      label:
        "kube-controller-manager restarted at 13:59:40 and took ~90 seconds to resume reconciling, which blew straight through inventory-sync's `startingDeadlineSeconds: 30` for the 14:00 run - since the controller couldn't create the Job within 30 seconds of its scheduled time, it treated the run as missed and skipped it entirely rather than starting it late, which is exactly what the CronJob's own `MissSchedule` event says happened.",
      explanation:
        "The CronJob's own event is explicit: \"Missed scheduled time 2026-09-15 14:00:00... may have been delayed past startingDeadlineSeconds.\" `control-plane-incident-notes` gives the exact timing - a controller-manager restart at 13:59:40 lasting about 90 seconds, which covers the entire 30-second window `startingDeadlineSeconds` allowed for starting the 14:00 run. A tight `startingDeadlineSeconds` is exactly what turns a brief, otherwise-harmless control plane hiccup into a fully skipped run instead of a slightly-late one.",
    },
    {
      id: "concurrency-policy-blocked-it",
      label: "concurrencyPolicy: Forbid blocked the 14:00 run because the 13:00 run was still in progress.",
      explanation:
        "The 13:00 Job (`inventory-sync-29129400`) shows `succeeded: 1` and is 3 hours old, meaning it completed well before 14:00 - there was no overlapping run for `Forbid` to block, and `Forbid` blocking a run produces a different, more common outcome than a `MissSchedule` event with this specific wording about the starting deadline.",
    },
    {
      id: "someone-deleted-the-job",
      label: "Someone manually deleted the 14:00 Job after it ran.",
      explanation:
        "There's no evidence of manual deletion anywhere (no relevant audit trail or event referencing it), and the CronJob's own `MissSchedule` event already explains the gap directly - the Job for 14:00 was never created at all, not created and then removed.",
    },
    {
      id: "cronjob-schedule-typo",
      label: "The CronJob's schedule expression has a typo that skips certain hours.",
      explanation:
        "`spec.schedule: \"0 * * * *\"` is a standard, correct every-hour expression, and it clearly worked for 13:00 and 15:00 - a typo in the schedule itself would produce a consistent pattern of skipped runs, not one isolated gap coinciding exactly with a documented control plane restart.",
    },
  ],
  correctOptionId: "controller-restart-exceeded-deadline",
  resolution: `The CronJob's own event says it outright: "Missed scheduled time
2026-09-15 14:00:00... may have been delayed past
startingDeadlineSeconds." \`control-plane-incident-notes\` supplies the
timing that explains it - kube-controller-manager restarted at 13:59:40
during an unrelated upgrade step and took about 90 seconds to resume
normal reconciliation. \`inventory-sync\`'s \`startingDeadlineSeconds\` is set
to just 30 seconds, meaning the controller has only a 30-second window
after the scheduled time to actually create the Job before it gives up on
that run entirely - a much stricter window than the 90-second control
plane blip that landed right on top of it. The 13:00 and 15:00 runs were
both unaffected because the controller was healthy at those times; 14:00
was simply unlucky enough to need the controller during the exact window
it was recovering.

There's no live fix available from this read-only console for the missed
run itself - it can be run manually if the data gap matters:

\`\`\`bash
kubectl create job --from=cronjob/inventory-sync inventory-sync-manual-1400 -n warehouse
\`\`\`

The more durable fix is loosening \`startingDeadlineSeconds\` to something
that tolerates brief, expected control plane hiccups (a restart during a
routine upgrade step isn't unusual) without silently dropping a run:

\`\`\`yaml
spec:
  startingDeadlineSeconds: 180
\`\`\`

A CronJob missing its deadline doesn't fail loudly - no failed Job, no
pod, nothing to alert on by default beyond the CronJob's own low-visibility
event - so for anything where a silently skipped run actually matters,
that event is worth watching for directly.`,
};
