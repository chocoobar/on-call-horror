import type { Scenario } from "./types";

export const theFormatterEveryoneShared: Scenario = {
  id: "the-formatter-everyone-shared",
  title: "The Formatter Everyone Shared",
  subtitle: "a handful of invoices get printed with a delivery date that's off by months, always under heavy concurrent load",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "simpledateformat", "concurrency"],
  briefing: `"invoice-printer" formats each invoice's delivery date using a shared,
pre-built `SimpleDateFormat` instance kept as a static field for
efficiency. During the morning batch-print rush, when many invoices
print concurrently, a small number come out with a wildly incorrect
delivery date - a completely different month or year than the order
actually has.`,
  constraints: [
    "Each invoice's underlying `Date` object, before formatting, is confirmed correct and unique per invoice - the corruption happens during the formatting step itself.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-printer", namespace: "billing", labels: { app: "invoice-printer" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-printer-7j8k9l0m1-n2o3p", namespace: "billing", labels: { app: "invoice-printer" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoice-printer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoice-printer": [
            "2026-09-15T08:00:02.114Z DEBUG c.e.billing.InvoicePrinter - [pool-2-thread-3] formatting delivery date for inv-7701 (actual date: 2026-09-20)",
            "2026-09-15T08:00:02.114Z DEBUG c.e.billing.InvoicePrinter - [pool-2-thread-7] formatting delivery date for inv-7714 (actual date: 2026-11-03)",
            "2026-09-15T08:00:02.118Z WARN  c.e.billing.PrintAudit - inv-7701 printed with delivery date 2026-11-03 (expected 2026-09-20)",
          ],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-printer-notes", namespace: "billing" },
        spec: {
          data: {
            "InvoicePrinter.java.excerpt":
              "public class InvoicePrinter {\n    // shared across every concurrent print thread, kept static for\n    // efficiency - SimpleDateFormat is expensive to construct repeatedly\n    private static final SimpleDateFormat DATE_FORMAT = new SimpleDateFormat(\"yyyy-MM-dd\");\n\n    public String formatDeliveryDate(Date date) {\n        return DATE_FORMAT.format(date);   // SimpleDateFormat is NOT thread-safe -\n            // it mutates internal Calendar state during formatting\n    }\n}\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl logs invoice-printer-7j8k9l0m1-n2o3p -n billing` - two different threads format two different invoices' dates at essentially the same millisecond, and one invoice ends up printed with the other's date.",
    "`kubectl get configmap invoice-printer-notes -n billing -o yaml` - `DATE_FORMAT` is a `static` `SimpleDateFormat`, shared across every thread. Is `SimpleDateFormat` documented as thread-safe?",
    "`SimpleDateFormat` internally mutates a shared `Calendar` object as part of formatting a date - calling `.format(...)` from two threads at the same time on the same instance can interleave their internal state mutations, corrupting the result for one or both calls.",
  ],
  options: [
    {
      id: "simpledateformat-not-threadsafe-shared-static-field",
      label:
        "`DATE_FORMAT` is a `static SimpleDateFormat`, shared by every concurrent print thread for efficiency - but `SimpleDateFormat` is explicitly documented as not thread-safe, because formatting a date mutates the instance's internal `Calendar` state as a side effect; when two threads call `.format(...)` on the same shared instance at the same time, their internal state mutations can interleave, corrupting the computed date for one (or both) of the concurrent calls, exactly matching one invoice being printed with a completely unrelated invoice's date.",
      explanation:
        "The logs show two different threads formatting two different invoices' dates within the same millisecond, and the audit log confirms `inv-7701` was printed with `inv-7714`'s date instead of its own. `InvoicePrinter.java.excerpt` confirms `DATE_FORMAT` is a `static` field, shared by every thread in the print pool, and `SimpleDateFormat` is a long-documented example of a non-thread-safe JDK class - its `format()` method mutates an internal `Calendar` instance as part of computing the result. Two threads calling `format()` concurrently on the same shared `SimpleDateFormat` instance can interleave their mutations of that internal state, so one thread's computation can be corrupted mid-flight by another thread's concurrent call - producing exactly the kind of wrong, unrelated date reported here, and only under real concurrent load (the morning batch-print rush), never during isolated single-invoice testing.",
    },
    {
      id: "database-returning-wrong-delivery-date",
      label: "The database is occasionally returning the wrong delivery date for some invoices.",
      explanation:
        "The constraint confirms each invoice's underlying `Date` object is correct and unique before formatting - the corruption happens specifically during the shared formatting step, not in what date value is fetched from the database.",
    },
    {
      id: "print-audit-comparing-against-wrong-invoice",
      label: "`PrintAudit`'s own comparison logic is checking the wrong invoice's expected date.",
      explanation:
        "The debug log independently confirms, from `InvoicePrinter`'s own per-thread logging, that `inv-7701`'s actual date is `2026-09-20` - the audit tool's reported mismatch against the wrong printed value is corroborated directly by the printer's own logs, not merely a bug in the auditor's own comparison.",
    },
    {
      id: "thread-pool-reusing-stale-date-objects",
      label: "The thread pool is reusing stale, cached `Date` objects across different invoice print jobs.",
      explanation:
        "Each invoice's `Date` object is confirmed correct and freshly supplied per invoice - the shared, mutable state causing the corruption is the `SimpleDateFormat` instance used to format those dates, not the `Date` objects being formatted themselves.",
    },
  ],
  correctOptionId: "simpledateformat-not-threadsafe-shared-static-field",
  resolution: `The logs show two threads formatting two different invoices' dates
within the same millisecond, and the audit log confirms the result: one
invoice printed with an entirely different invoice's delivery date.
\`InvoicePrinter.java.excerpt\` shows \`DATE_FORMAT\`, a \`SimpleDateFormat\`,
declared as a \`static\` field specifically to avoid the cost of
constructing a new formatter per call - a reasonable-looking
optimization that overlooks a well-known JDK gotcha: \`SimpleDateFormat\`
is explicitly documented as *not* thread-safe. Formatting a date isn't a
pure, side-effect-free operation for this class - internally, it mutates
a shared \`Calendar\` instance as scratch space while computing the
result. When multiple threads call \`.format(...)\` on the very same
shared instance concurrently, as happens constantly under real
production load (the morning batch-print rush, in this case), their
internal state mutations can interleave unpredictably, corrupting the
in-progress calculation for one or both concurrent calls - producing
exactly this kind of wrong, unrelated-invoice date, non-deterministically
and only under real concurrency, which is why isolated testing of a
single invoice at a time never caught it.

The fix is either not sharing the formatter across threads, or migrating
to \`java.time\`'s thread-safe formatting classes:

\`\`\`java
// simplest, most modern fix: java.time's DateTimeFormatter IS thread-safe
private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

public String formatDeliveryDate(LocalDate date) {
    return DATE_FORMAT.format(date);   // safe to share across threads
}
\`\`\`

If migrating away from \`Date\`/\`SimpleDateFormat\` isn't immediately
feasible, a \`ThreadLocal<SimpleDateFormat>\` (one instance per thread,
never shared) is the standard stopgap. The general rule:
\`SimpleDateFormat\` (and legacy \`Calendar\`) must never be shared across
threads without external synchronization - \`java.time\`'s
\`DateTimeFormatter\`, \`LocalDate\`, and related classes are immutable and
genuinely thread-safe, and are the preferred choice for any new code
regardless of concurrency concerns.`,
};
