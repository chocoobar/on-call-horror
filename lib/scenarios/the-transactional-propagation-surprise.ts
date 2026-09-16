import type { Scenario } from "./types";

export const theTransactionalPropagationSurprise: Scenario = {
  id: "the-transactional-propagation-surprise",
  title: "The @Transactional Propagation Surprise",
  subtitle: "refund-processor leaves a refund marked complete even when the ledger entry that was supposed to accompany it never got written",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "transactions", "spring-boot"],
  briefing: `Finance flagged a handful of refunds this week where the customer-facing
refund record shows "completed," but the corresponding ledger entry that
should always accompany it is simply missing. Both writes happen inside
the same service call, and the team was confident everything ran inside
one transaction - so a partial write like this shouldn't be possible.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "refund-processor", namespace: "payments", labels: { app: "refund-processor" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "refund-processor", image: "registry.internal/refund-processor:3.2.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "refund-processor-4p5q6r7s8-t9u0v", namespace: "payments", labels: { app: "refund-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "refund-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "refund-processor": [
            "2026-09-15T09:20:01.114Z INFO  c.e.payments.RefundService - processing refund ref-77120 for order ORD-55210",
            "2026-09-15T09:20:01.220Z INFO  c.e.payments.RefundService - marking refund ref-77120 completed",
            "2026-09-15T09:20:01.330Z ERROR c.e.payments.LedgerService - failed to write ledger entry for ref-77120: DataIntegrityViolationException: duplicate key",
            "2026-09-15T09:20:01.332Z WARN  c.e.payments.RefundService - ledger write failed but refund already committed, continuing",
          ],
        },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "refund-processor-notes", namespace: "payments" },
        spec: {
          data: {
            "RefundService.java.excerpt":
              "@Transactional\npublic void processRefund(String refundId) {\n    refundRepository.markCompleted(refundId); // writes and commits\n                                                 // eagerly due to\n                                                 // REQUIRES_NEW below\n    try {\n        ledgerService.recordEntry(refundId); // REQUIRES_NEW - runs in\n                                               // its OWN separate\n                                               // transaction, committed\n                                               // or rolled back\n                                               // independently\n    } catch (DataIntegrityViolationException e) {\n        log.warn(\"ledger write failed but refund already committed, continuing\");\n        // swallowed - outer transaction proceeds to commit regardless\n    }\n}\n\n@Service\npublic class LedgerService {\n    @Transactional(propagation = Propagation.REQUIRES_NEW)\n    public void recordEntry(String refundId) { ... }\n}\n",
          },
        },
        age: "7d",
      },
    ],
  },
  hints: [
    "`kubectl logs refund-processor-4p5q6r7s8-t9u0v -n payments` - the ledger write fails, and the very next line says the refund was 'already committed.' If both writes were in one transaction, how could one already be committed while the other is still failing?",
    "`kubectl get configmap refund-processor-notes -n payments -o yaml` - look at `LedgerService.recordEntry`'s propagation setting. What does `REQUIRES_NEW` do to a call made from inside an already-open transaction?",
    "`REQUIRES_NEW` suspends the caller's transaction and starts a brand new, independent one - a failure in that new transaction has no automatic effect on the original transaction it was called from.",
  ],
  options: [
    {
      id: "requires-new-isolates-ledger-failure-from-refund-commit",
      label:
        "`LedgerService.recordEntry` is annotated `@Transactional(propagation = Propagation.REQUIRES_NEW)`, which suspends the caller's transaction and runs the ledger write in a completely independent one; `RefundService.processRefund`'s own outer transaction has already effectively committed the refund status by the time the ledger write runs, and because the ledger's `DataIntegrityViolationException` is caught and swallowed locally, its failure never propagates back to mark the outer transaction for rollback - leaving a refund marked complete with no corresponding ledger entry at all.",
      explanation:
        "The log shows the ledger write failing with a real, uncaught-at-the-database-level exception, immediately followed by the application's own log line confirming the refund was 'already committed' and processing 'continuing' regardless. `refund-processor-notes` shows why that's possible despite both writes being inside the same `@Transactional` method: `recordEntry` uses `REQUIRES_NEW`, which suspends the outer transaction and commits (or fails) the ledger write entirely independently of it - and because the resulting exception is caught and logged rather than rethrown, the outer transaction sees no failure at all and proceeds to commit the refund normally.",
    },
    {
      id: "database-replication-lag-caused-missing-entry",
      label: "Read-replica replication lag is why the ledger entry appears missing when checked.",
      explanation:
        "The application's own log shows a real, immediate write failure (`DataIntegrityViolationException: duplicate key`) at the moment of the attempt, not a delayed-visibility read issue - the ledger entry genuinely was never written, not merely not-yet-visible due to replication lag.",
    },
    {
      id: "refundservice-missing-transactional-annotation",
      label: "`processRefund` itself is missing the `@Transactional` annotation entirely.",
      explanation:
        "`refund-processor-notes` shows `processRefund` is annotated `@Transactional` - the outer method transaction exists; the issue is specifically that the *inner* call runs in its own separate `REQUIRES_NEW` transaction whose failure is caught and never propagated back to affect the outer one.",
    },
    {
      id: "duplicate-key-means-ledger-entry-already-existed",
      label: "The duplicate key error means the ledger entry actually already existed and this is a false alarm.",
      explanation:
        "A duplicate key on a ledger entry write failing doesn't confirm the *correct* entry already existed and everything is fine - the application's own subsequent behavior (continuing and marking the refund completed regardless of the outcome) is the same either way, and finance's audit found genuinely missing entries, not duplicates of correct ones.",
    },
  ],
  correctOptionId: "requires-new-isolates-ledger-failure-from-refund-commit",
  resolution: `The log lays out the sequence plainly: the ledger write fails with a real
database-level exception (\`DataIntegrityViolationException: duplicate
key\`), and the very next line is the application itself acknowledging
that the refund was "already committed" and processing is "continuing"
anyway. If both writes genuinely shared one atomic transaction, that
sequence wouldn't be possible - one half failing should have rolled back
the other.

\`refund-processor-notes\` shows why it happened: \`LedgerService.recordEntry\`
is annotated \`@Transactional(propagation = Propagation.REQUIRES_NEW)\`.
That propagation setting doesn't join the caller's existing transaction -
it suspends it and opens a brand new, entirely independent one for the
ledger write, which commits or rolls back on its own regardless of what
happens in the outer transaction. Worse, \`processRefund\` wraps that call
in a try/catch that swallows the resulting \`DataIntegrityViolationException\`
and just logs a warning - so even the one mechanism that *could* have
still caught this (letting the exception propagate to force the outer
transaction to roll back) never gets the chance to fire. The outer
transaction sees no error at all and commits the refund as completed.

The fix is deciding deliberately whether the ledger write should really
be independent of the refund status, and if not, removing \`REQUIRES_NEW\`
and letting a failure actually roll back the whole operation:

\`\`\`java
@Transactional
public void processRefund(String refundId) {
    refundRepository.markCompleted(refundId);
    ledgerService.recordEntry(refundId); // no REQUIRES_NEW - same
                                           // transaction; a failure here
                                           // rolls back the refund
                                           // status too, and the
                                           // exception is no longer
                                           // caught and discarded
}
\`\`\`

\`REQUIRES_NEW\` is the right tool when a piece of work genuinely needs to
survive the outer transaction rolling back (an audit log entry, for
instance) - but for two writes meant to succeed or fail together, it's
exactly the setting that breaks that guarantee, especially when combined
with an exception handler that swallows the independent transaction's
failure instead of propagating it.`,
};
