import type { Scenario } from "./types";

export const theStreamThatNeverRan: Scenario = {
  id: "the-stream-that-never-ran",
  title: "The Stream That Never Ran",
  subtitle: "flagged fraud-review cases are supposedly being logged for the audit team, but the audit log has been empty for two weeks",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "streams", "laziness"],
  briefing: `"fraud-flagging-service" is supposed to build a \`Stream\` of suspicious
transactions, log each one for the audit team as a side effect while
filtering, and separately count how many were flagged. The count metric
has looked correct in dashboards this whole time - but the audit team's
log has received zero entries in two weeks, despite the count showing
dozens of flagged transactions daily.`,
  constraints: [
    "The condition that determines whether a transaction is suspicious is confirmed correct - the count metric derived from it is accurate.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fraud-flagging-service", namespace: "fraud", labels: { app: "fraud-flagging-service" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "fraud-flagging-service-1d2e3f4g5-h6i7j", namespace: "fraud", labels: { app: "fraud-flagging-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "fraud-flagging-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "fraud-flagging-service": [
            "2026-09-15T13:00:02.114Z DEBUG c.e.fraud.FraudFlagger - evaluating batch of 340 transactions",
            "2026-09-15T13:00:02.204Z INFO  c.e.fraud.FraudFlagger - flagged count this batch: 12",
          ],
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fraud-flagger-notes", namespace: "fraud" },
        spec: {
          data: {
            "FraudFlagger.java.excerpt":
              "public long flagSuspicious(List<Transaction> transactions) {\n    Stream<Transaction> suspicious = transactions.stream()\n        .filter(Transaction::isSuspicious)\n        .peek(t -> auditLog.record(t));   // intended to log every flagged txn\n\n    long count = transactions.stream()\n        .filter(Transaction::isSuspicious)\n        .count();   // separate stream, built independently for the count\n\n    return count;\n    // `suspicious` is built but never given a terminal operation of its\n    // own anywhere in this method\n}\n",
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap fraud-flagger-notes -n fraud -o yaml` - `suspicious` is built with `.filter(...).peek(...)`, but is it ever actually consumed by a terminal operation, like `.count()`, `.forEach()`, or `.collect()`?",
    "Java `Stream` operations are lazy - intermediate operations like `.filter()` and `.peek()` don't execute anything at all until a terminal operation triggers the whole pipeline to run.",
    "The `count` variable is computed from a completely separate stream, built independently. Does building `suspicious` (with its `.peek()` side effect) have any effect at all if that particular stream pipeline is never triggered by a terminal operation?",
  ],
  options: [
    {
      id: "stream-never-triggered-peek-never-runs",
      label:
        "`suspicious` is built as a lazy `Stream` pipeline ending in `.peek(...)` (an intermediate operation, not a terminal one), but it's never given any terminal operation anywhere - `count` is computed from an entirely separate, independently-built stream instead - so because Java streams execute nothing at all until a terminal operation triggers the pipeline, `suspicious`'s `.filter()` and `.peek()` (including its `auditLog.record(t)` side effect) never run even once, while the count still comes out correct because it's driven by its own, fully-triggered stream.",
      explanation:
        "The metrics dashboard correctly shows flagged counts, and the debug log confirms `flagged count this batch: 12` - a real, accurate number - while the audit log has zero entries. `FraudFlagger.java.excerpt` shows why both can be true at once: `suspicious` is built with `.filter(...).peek(...)`, both intermediate operations, and is never followed by any terminal operation (`.count()`, `.forEach()`, `.collect()`, etc.) anywhere in the method - Java streams are lazy, and an intermediate-operations-only pipeline with no terminal operation simply never executes at all, meaning `.peek()`'s `auditLog.record(t)` call never runs. `count`, meanwhile, is computed from a completely separate stream pipeline that does end in a real terminal operation (`.count()`), so it executes correctly and independently, producing an accurate number with zero connection to whether `suspicious` ever ran.",
    },
    {
      id: "auditlog-record-method-broken",
      label: "`auditLog.record(t)` itself has a bug preventing entries from being persisted.",
      explanation:
        "`.peek(t -> auditLog.record(t))` is never actually invoked at all, since the stream it belongs to has no terminal operation and never executes - there's no evidence `auditLog.record` is even being called, let alone called and failing internally.",
    },
    {
      id: "peek-intentionally-a-no-op-for-performance",
      label: "`.peek()` is a JIT-optimizable no-op the JVM is eliminating for performance under load.",
      explanation:
        "`.peek()`'s absence of effect here isn't a JIT optimization eliminating a genuinely-executing operation - the entire stream pipeline it belongs to never runs at all, at any optimization level, because it's never given a terminal operation to trigger execution in the first place.",
    },
    {
      id: "audit-log-storage-backend-down",
      label: "The audit log's storage backend has been silently failing writes for two weeks.",
      explanation:
        "If `auditLog.record(t)` were being called and failing, that would typically produce some error, retry, or dead-letter signal - the actual issue is upstream of any storage call: the code path that would call it never executes at all, due to the stream's missing terminal operation.",
    },
  ],
  correctOptionId: "stream-never-triggered-peek-never-runs",
  resolution: `The count metric being accurate while the audit log stays completely
empty is the key clue: two different code paths, one working, one
silently not. \`FraudFlagger.java.excerpt\` shows exactly why. Java
\`Stream\` pipelines are lazily evaluated - every intermediate operation
(\`.filter()\`, \`.map()\`, \`.peek()\`, and similar) merely *describes* a step
in the pipeline; none of them actually execute anything until a
*terminal* operation (\`.count()\`, \`.collect()\`, \`.forEach()\`, and similar)
is called, which is what actually triggers the whole chain to run,
element by element. \`suspicious\` is built with \`.filter(...).peek(...)\` -
both intermediate operations - and the method returns without ever
calling any terminal operation on it at all. That entire pipeline, side
effect included, simply never runs. \`count\`, by contrast, is computed
from a second, completely independent stream pipeline that correctly
ends in \`.count()\`, a genuine terminal operation - so it executes fully
and produces an accurate result, with zero relationship to whether
\`suspicious\` (and its audit-logging side effect) ever ran at all.

The fix is giving the audit-logging pipeline its own terminal operation
so it actually executes - and ideally deriving the count from the same
pass instead of duplicating the filter logic in two separate streams:

\`\`\`java
public long flagSuspicious(List<Transaction> transactions) {
    List<Transaction> suspicious = transactions.stream()
        .filter(Transaction::isSuspicious)
        .toList();   // terminal operation - the pipeline actually runs now

    suspicious.forEach(auditLog::record);   // logs every flagged transaction
    return suspicious.size();   // single source of truth for the count too
}
\`\`\`

The general rule: a \`Stream\` pipeline that ends only in intermediate
operations does nothing at all, no matter how meaningful those
operations look - \`.peek()\` in particular is easy to mistake for "this
runs as I build the pipeline," when it, like every intermediate
operation, only ever runs as a byproduct of some later terminal
operation actually pulling elements through the whole chain.`,
};
