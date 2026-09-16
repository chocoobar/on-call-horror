import type { Scenario } from "../types";

export const theCloseThatHidTheRealError: Scenario = {
  id: "the-close-that-hid-the-real-error",
  title: "The Close That Hid the Real Error",
  subtitle: "a failed bulk email send reports a bland connection-pool error, with zero trace of why the send actually failed",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "exceptions", "resource-management"],
  briefing: `"campaign-mailer" sends marketing emails through a pooled SMTP
connection, manually checked out and returned (not managed by
try-with-resources, since the pool predates that pattern in this
codebase). When a send genuinely fails - bad recipient address, content
policy rejection - the error surfaced to the marketing team is always
the same unhelpful "failed to return connection to pool" message,
never the actual reason the send failed.`,
  constraints: [
    "The SMTP server's own rejection reason for a failed send is confirmed to be sent back correctly as part of the original send failure, before any connection cleanup happens.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "campaign-mailer", namespace: "marketing", labels: { app: "campaign-mailer" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "campaign-mailer-9l0m1n2o3-p4q5r", namespace: "marketing", labels: { app: "campaign-mailer" } },
        status: { phase: "Running", containerStatuses: [{ name: "campaign-mailer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "campaign-mailer": [
            "2026-09-15T14:05:02.114Z ERROR c.e.marketing.CampaignMailer - java.lang.IllegalStateException: failed to return connection to pool",
            "    at app//com.example.marketing.CampaignMailer.send(CampaignMailer.java:14)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "campaign-mailer-notes", namespace: "marketing" },
        spec: {
          data: {
            "CampaignMailer.java.excerpt":
              "public void send(Email email) {\n    SmtpConnection conn = pool.checkout();\n    try {\n        conn.send(email);   // throws SmtpRejectedException with the real,\n            // useful reason for rejection\n    } finally {\n        try {\n            pool.checkin(conn);   // can ALSO throw, if conn is left in a\n                                   // bad state after a failed send\n        } catch (Exception e) {\n            throw new IllegalStateException(\"failed to return connection to pool\", e);\n            // this throw REPLACES whatever exception was already\n            // propagating out of the try block, if any\n        }\n    }\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap campaign-mailer-notes -n marketing -o yaml` - `send`'s `finally` block has its own nested `try`/`catch` that throws a brand-new exception. What happens to whatever exception the outer `try` block was already propagating, if `pool.checkin(conn)` also throws?",
    "Unlike try-with-resources (which attaches a close-time exception as *suppressed*, preserving the original), a manually-written `finally` block that catches and re-throws its own new exception completely replaces whatever exception was already in flight - there's no automatic preservation here at all.",
    "Does the new `IllegalStateException` thrown from inside `finally`'s own `catch` block reference the original `SmtpRejectedException` anywhere - as a cause, or otherwise?",
  ],
  options: [
    {
      id: "finally-block-exception-replaces-original-uncaught",
      label:
        "`send`'s `finally` block wraps `pool.checkin(conn)` in its own `try`/`catch`, and when checkin fails (as it does after a failed send leaves the connection in a bad state), it throws a brand-new `IllegalStateException` with no reference back to whatever exception was already propagating from the `try` block - since this replacement happens inside `finally`, the original, genuinely useful `SmtpRejectedException` (with the real rejection reason) is completely discarded and never appears anywhere, leaving only the generic pool-related message.",
      explanation:
        "The logged exception is `IllegalStateException: failed to return connection to pool`, with no mention of any SMTP rejection reason at all - even though the constraint confirms a real, useful rejection reason genuinely was produced by `conn.send(email)` before this. `CampaignMailer.java.excerpt` shows exactly why it's gone: the `finally` block's nested `try`/`catch` throws a brand-new `IllegalStateException` when `pool.checkin(conn)` fails, with no reference to whatever exception the outer `try` block was already in the middle of propagating (such as `SmtpRejectedException` from the failed send). Unlike try-with-resources, which automatically attaches a close-time exception as *suppressed* on the original exception, this hand-written `finally` block simply throws its own new exception, silently and completely discarding whatever was propagating before it - exactly matching the symptom of the real send-failure reason never appearing anywhere.",
    },
    {
      id: "pool-checkin-method-itself-buggy",
      label: "`pool.checkin(conn)`'s own logic for returning a connection has a bug unrelated to send failures.",
      explanation:
        "The constraint confirms the SMTP server's rejection reason is correctly produced during the original failed send, before any cleanup - the issue isn't whether `checkin` itself is buggy, it's that whatever exception `checkin` throws during cleanup after a failed send completely replaces and discards that original, useful rejection reason.",
    },
    {
      id: "smtp-server-returning-generic-errors",
      label: "The SMTP server itself is only returning generic, unhelpful rejection messages.",
      explanation:
        "The constraint explicitly confirms the SMTP server's rejection reason is correctly sent back as part of the original send failure - the server-side response is genuinely useful; the code handling it afterward is what discards it before it ever reaches a log or the marketing team.",
    },
    {
      id: "connection-pool-exhausted-under-load",
      label: "The connection pool is being exhausted under heavy send volume, causing checkin to fail.",
      explanation:
        "The stack trace shows the failure occurring during a specific, individual email send's own cleanup path, tied directly to that send's outcome - not a pool-wide exhaustion symptom, which would typically manifest as checkout (acquiring a connection) failing under load, not checkin (returning one) failing after a specific failed send.",
    },
  ],
  correctOptionId: "finally-block-exception-replaces-original-uncaught",
  resolution: `The exception reaching the marketing team, \`IllegalStateException: failed
to return connection to pool\`, contains no trace of any SMTP rejection
reason - despite the constraint confirming a real, useful rejection
reason genuinely was produced by the original failed send.
\`CampaignMailer.java.excerpt\` shows exactly how it disappears:
\`send\`'s \`finally\` block wraps \`pool.checkin(conn)\` in its own nested
\`try\`/\`catch\`, and when \`checkin\` fails - which it does here, because
the connection was left in a bad state by the earlier failed send -
that \`catch\` block throws a brand-new \`IllegalStateException\`, with no
reference back to whatever exception the outer \`try\` block was already
propagating. This is meaningfully different from try-with-resources,
which automatically attaches a close-time exception to the original one
as a *suppressed* exception, preserving both. Here, the hand-written
\`finally\` block's own exception simply replaces whatever was already in
flight - Java doesn't do anything automatic to preserve the original in
a manually-written \`finally\` block; whether it's preserved depends
entirely on whether the code explicitly does so.

The fix is explicitly preserving the original exception as the cause (or
suppressed exception) when a cleanup failure needs to be reported
alongside it:

\`\`\`java
public void send(Email email) throws SmtpRejectedException {
    SmtpConnection conn = pool.checkout();
    try {
        conn.send(email);
    } finally {
        try {
            pool.checkin(conn);
        } catch (Exception cleanupError) {
            // log the cleanup failure separately, but let the ORIGINAL
            // exception (if any) continue propagating unmodified
            log.warn("failed to return connection to pool", cleanupError);
        }
    }
}
\`\`\`

If both exceptions genuinely need to reach the caller, catching the
original explicitly and calling \`addSuppressed(cleanupError)\` on it
before re-throwing preserves both. The general rule: a \`finally\` block
that throws its own new exception during cleanup silently discards
whatever exception was already propagating from the \`try\` block, unless
the code explicitly preserves it as a cause or suppressed exception -
this is exactly the pitfall try-with-resources exists to avoid
automatically, but a hand-written \`finally\` block gets none of that
protection for free.`,
};
