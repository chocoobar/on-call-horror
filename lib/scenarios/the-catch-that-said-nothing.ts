import type { Scenario } from "./types";

export const theCatchThatSaidNothing: Scenario = {
  id: "the-catch-that-said-nothing",
  title: "The Catch That Said Nothing",
  subtitle: "a slow but steady trickle of warehouse transfer records never make it into the nightly reconciliation report",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "exceptions", "logging"],
  briefing: `Warehouse reconciliation totals have been quietly off by a small amount
every night for weeks - never enough to trigger an alert threshold, but
enough that an internal audit finally caught it. Nobody can find any
error anywhere in the logs from the reconciliation job.`,
  constraints: [
    "The transfer records themselves are confirmed correct and complete in the source system - every missing record genuinely exists and is readable before reconciliation runs.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "warehouse-reconciliation", namespace: "warehouse", labels: { app: "warehouse-reconciliation" } },
        spec: { schedule: "30 2 * * *" },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "warehouse-reconciliation-28901477-t2u3v", namespace: "warehouse", labels: { app: "warehouse-reconciliation" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "warehouse-reconciliation", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "warehouse-reconciliation": [
            "2026-09-15T02:30:01.114Z INFO  c.e.warehouse.Reconciler - starting nightly reconciliation, 1842 transfer records to process",
            "2026-09-15T02:30:04.902Z INFO  c.e.warehouse.Reconciler - reconciliation complete, 1839 records applied",
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "warehouse-reconciler-notes", namespace: "warehouse" },
        spec: {
          data: {
            "Reconciler.java.excerpt":
              "public void reconcile(List<TransferRecord> records) {\n    for (TransferRecord record : records) {\n        try {\n            apply(record);\n        } catch (StaleInventoryException e) {\n            // known, occasionally-expected condition - intentionally not fatal\n        }\n    }\n}\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl logs warehouse-reconciliation-28901477-t2u3v -n warehouse` - 1842 records went in, only 1839 were applied, and there's no error logged anywhere explaining the difference.",
    "`kubectl get configmap warehouse-reconciler-notes -n warehouse -o yaml` - what happens inside the `catch` block when `apply(record)` throws `StaleInventoryException`?",
    "An empty `catch` block silently discards the exception entirely - the record that caused it is simply never retried, never logged, and never counted anywhere, as if it never existed.",
  ],
  options: [
    {
      id: "empty-catch-block-swallows-exception-silently",
      label:
        "`reconcile`'s `catch (StaleInventoryException e)` block is empty - any record that triggers a `StaleInventoryException` during `apply()` is silently skipped with no logging, no retry, and no count of how many records this happened to anywhere, so a small, steady number of records vanish from the reconciliation total every night without leaving any trace of why.",
      explanation:
        "The job's own summary log shows `1842` records going in but only `1839` applied - a silent gap of `3`, with zero corresponding error output anywhere. `Reconciler.java.excerpt` shows exactly why: the `catch (StaleInventoryException e)` block is empty, deliberately treating the condition as 'not fatal' but also never logging it, counting it, or retrying the affected record - the exception, and the record that triggered it, are simply discarded with no trace left behind at all.",
    },
    {
      id: "database-connection-pool-exhausted",
      label: "The database connection pool is being exhausted partway through the job, silently dropping later records.",
      explanation:
        "The job logs a clean, successful completion (`reconciliation complete`) with no connection errors, timeouts, or partial-failure indicators anywhere - and the missing-record count is small and consistent across runs, not the kind of cliff-edge pattern a resource exhaustion issue partway through a batch would typically produce.",
    },
    {
      id: "transfer-records-deduplicated-incorrectly",
      label: "A deduplication step is incorrectly treating distinct records as duplicates and dropping them.",
      explanation:
        "There's no deduplication logic shown anywhere in the reconciliation path, and the records are independently confirmed correct and non-duplicate in the source system - the gap between records-in and records-applied is fully explained by the empty catch block silently discarding whatever triggers it.",
    },
    {
      id: "cronjob-timing-out-before-completion",
      label: "The CronJob is timing out and being killed before processing every record.",
      explanation:
        "The job logs a normal, successful completion message and terminates with exit code 0 - there's no indication of a timeout or forced termination; every record was iterated over, some just triggered a silently-discarded exception along the way.",
    },
  ],
  correctOptionId: "empty-catch-block-swallows-exception-silently",
  resolution: `The job's own summary logs the discrepancy plainly: \`1842\` records to
process, only \`1839\` applied - a silent gap of exactly \`3\`, with no
corresponding error, warning, or any other trace anywhere in the logs.
\`Reconciler.java.excerpt\` shows why nothing was logged: the
\`catch (StaleInventoryException e)\` block is completely empty. Catching a
checked exception and discarding it with no logging, no metric, and no
retry means that exception - and the record that triggered it - simply
disappears from the system's observable behavior entirely, as if it had
never been attempted. The job still reports "complete" because, from the
loop's perspective, nothing ever actually failed; the exception was
caught exactly as written, and writing nothing in a \`catch\` block is
still valid, compiling, "handled" code.

The fix is making the discarded condition observable, even if it's
genuinely not meant to be fatal:

\`\`\`java
public void reconcile(List<TransferRecord> records) {
    int skipped = 0;
    for (TransferRecord record : records) {
        try {
            apply(record);
        } catch (StaleInventoryException e) {
            skipped++;
            log.warn("skipped record {} - stale inventory: {}", record.id(), e.getMessage());
        }
    }
    log.info("reconciliation complete, {} skipped due to stale inventory", skipped);
}
\`\`\`

The general rule: an empty \`catch\` block is one of the most dangerous
patterns in Java precisely because it compiles cleanly and looks
intentional - at minimum, log what was caught and why, and track how
often it happens, even for exceptions that are genuinely expected and
non-fatal. Silence is indistinguishable from "this never happens" until
an audit proves otherwise.`,
};
