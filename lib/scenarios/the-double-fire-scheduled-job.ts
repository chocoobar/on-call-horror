import type { Scenario } from "./types";

export const theDoubleFireScheduledJob: Scenario = {
  id: "the-double-fire-scheduled-job",
  title: "The Double-Fire Scheduled Job",
  subtitle: "nightly-reconciler is emailing every finance stakeholder the same report twice",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "scheduling", "spring-boot"],
  briefing: `"nightly-reconciler" sends a single end-of-day reconciliation report by
email at 11:00pm. For the last three nights, finance has received the
exact same report *twice*, a few seconds apart, with identical numbers.
Nobody added a second job, and there's only one pod running.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "nightly-reconciler", namespace: "finance", labels: { app: "nightly-reconciler" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "nightly-reconciler", image: "registry.internal/nightly-reconciler:1.3.0" }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "nightly-reconciler-8i7j6k5l4-m3n2o", namespace: "finance", labels: { app: "nightly-reconciler" } },
        status: { phase: "Running", containerStatuses: [{ name: "nightly-reconciler", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "nightly-reconciler": [
            "2026-09-14T23:00:00.001Z INFO  c.e.finance.ReconciliationJob - [cron trigger] running end-of-day reconciliation",
            "2026-09-14T23:00:00.004Z INFO  c.e.finance.ReconciliationJob - [fixedDelay trigger] running end-of-day reconciliation",
            "2026-09-14T23:00:04.220Z INFO  c.e.finance.ReconciliationJob - report emailed to finance-team@example.com (run A)",
            "2026-09-14T23:00:04.310Z INFO  c.e.finance.ReconciliationJob - report emailed to finance-team@example.com (run B)",
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nightly-reconciler-notes", namespace: "finance" },
        spec: {
          data: {
            "ReconciliationJob.java.excerpt":
              "@Scheduled(cron = \"0 0 23 * * *\")\npublic void runOnCron() {\n    reconcile();\n}\n\n@Scheduled(fixedDelay = 86400000, initialDelayString = \"#{T(java.time.Duration).between(T(java.time.LocalDateTime).now(), T(java.time.LocalDateTime).now().withHour(23).withMinute(0)).toMillis()}\")\npublic void runOnFixedDelay() {\n    reconcile(); // added later by a different engineer, unaware\n                 // the cron-based method already covers this\n}\n",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl logs nightly-reconciler-8i7j6k5l4-m3n2o -n finance` - there are two distinct trigger log lines a few milliseconds apart, from two different methods.",
    "`kubectl get configmap nightly-reconciler-notes -n finance -o yaml` - `@Scheduled` can be attached to more than one method, and Spring Boot will happily run all of them on their own independent schedules.",
    "One method uses `cron = \"0 0 23 * * *\"`. The other uses `fixedDelay` with an `initialDelayString` computed to land at the same time. Are these actually the same schedule, or two schedules that happen to coincide?",
  ],
  options: [
    {
      id: "two-separate-scheduled-methods-both-fire",
      label:
        "Two separate `@Scheduled` methods - `runOnCron()` (cron-based) and `runOnFixedDelay()` (fixedDelay-based, added later by someone unaware the cron job already existed) - are both configured to run the same `reconcile()` logic around 11pm, and Spring's scheduler runs every `@Scheduled` method independently, so both fire and both send the report.",
      explanation:
        "The logs show two distinct trigger lines, `[cron trigger]` and `[fixedDelay trigger]`, four milliseconds apart, each followed by its own \"report emailed\" line. `nightly-reconciler-notes` shows the actual code: two entirely separate `@Scheduled` methods, both ultimately calling `reconcile()`, one clearly added after the other by someone who didn't realize the cron-based job already covered the same window. Spring's scheduler treats every `@Scheduled`-annotated method as its own independent trigger - there's no built-in deduplication across methods that happen to fire around the same time.",
    },
    {
      id: "email-provider-retry-duplicate-send",
      label: "The email provider is retrying and sending duplicate copies of a single successful send.",
      explanation:
        "The logs show two full, independent job executions - `[cron trigger]` and `[fixedDelay trigger]` - each running its own reconciliation and logging its own \"report emailed\" line; this is two real application-level invocations, not one send being duplicated downstream by the mail provider.",
    },
    {
      id: "pod-restarted-mid-job",
      label: "The pod is silently restarting mid-job and re-running the reconciliation on recovery.",
      explanation:
        "`restartCount` is `0` and there's no gap or restart-related event between the two runs - they happen four milliseconds apart within the same continuously running process, which rules out a crash-and-retry explanation.",
    },
    {
      id: "cron-expression-fires-twice",
      label: "The cron expression `0 0 23 * * *` itself is malformed and matches 11pm twice.",
      explanation:
        "`0 0 23 * * *` is a valid, unambiguous cron expression that fires exactly once at 23:00 daily - the second execution in the logs is explicitly a different trigger (`[fixedDelay trigger]`) from a completely separate scheduled method, not a double-match of the same cron rule.",
    },
  ],
  correctOptionId: "two-separate-scheduled-methods-both-fire",
  resolution: `The logs show two independent trigger lines four milliseconds apart -
\`[cron trigger]\` and \`[fixedDelay trigger]\` - each followed by its own
\"report emailed\" line. \`nightly-reconciler-notes\` shows the source: two
separate \`@Scheduled\` methods, \`runOnCron()\` (a cron expression firing at
23:00 daily) and \`runOnFixedDelay()\` (a 24-hour \`fixedDelay\` with an
\`initialDelayString\` computed to also land around 23:00), both ultimately
calling the same \`reconcile()\` logic. The comment in the code excerpt
gives away how this happened: the second method was added later by
someone who didn't realize the first one already covered the same job.
Spring's \`@Scheduled\` support runs every annotated method on its own
independent trigger - there's no automatic deduplication just because two
methods happen to land at the same wall-clock time.

The fix is removing the duplicate scheduled method entirely, leaving one
clear source of truth for when reconciliation runs:

\`\`\`java
@Scheduled(cron = "0 0 23 * * *")
public void runReconciliation() {
    reconcile();
}
// runOnFixedDelay() removed - it duplicated this job
\`\`\`

Whenever a codebase has more than one \`@Scheduled\` method that could
plausibly do the same thing, it's worth a quick grep for other
\`@Scheduled\` annotations calling the same service method before assuming
a duplicate send is a downstream or infrastructure issue - Spring will
run every one of them, on its own schedule, without complaint.`,
};
