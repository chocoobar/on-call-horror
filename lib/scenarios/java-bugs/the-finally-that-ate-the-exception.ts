import type { Scenario } from "../types";

export const theFinallyThatAteTheException: Scenario = {
  id: "the-finally-that-ate-the-exception",
  title: "The Finally That Ate the Exception",
  subtitle: "a handful of payments silently vanish - no charge, no error, no record they were ever attempted",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "exceptions", "control-flow"],
  briefing: `Finance flagged a small number of checkout sessions where the customer's
card was never actually charged, the order was never created, and -
strangest of all - no error was ever logged or surfaced anywhere. The
customer's browser just showed a generic "please try again" without
ever hitting a visible failure path.`,
  constraints: [
    "The payment gateway call itself is confirmed to sometimes throw a legitimate `PaymentDeclinedException` under normal conditions - that exception, and the code that's supposed to handle it, are the focus here.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-processor", namespace: "checkout", labels: { app: "checkout-processor" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-processor-8f9g0h1i2-j3k4l", namespace: "checkout", labels: { app: "checkout-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-processor": [
            "2026-09-15T16:01:04.114Z DEBUG c.e.checkout.PaymentFlow - submitting charge for session sess-9012",
            "2026-09-15T16:01:04.320Z INFO  c.e.checkout.PaymentFlow - checkout completed for session sess-9012 result=false",
          ],
        },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-processor-notes", namespace: "checkout" },
        spec: {
          data: {
            "PaymentFlow.java.excerpt":
              "public boolean processPayment(Session session) {\n    boolean success = false;\n    try {\n        gateway.charge(session);   // can throw PaymentDeclinedException\n        success = true;\n        return success;\n    } catch (PaymentDeclinedException e) {\n        log.warn(\"payment declined for {}\", session.id());\n        return false;\n    } finally {\n        return success;   // <-- unconditionally overrides both return paths above\n    }\n}\n",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl logs checkout-processor-8f9g0h1i2-j3k4l -n checkout` - there's no warning logged for a declined payment at all, not even in the affected sessions. Is the `catch` block actually running?",
    "`kubectl get configmap checkout-processor-notes -n checkout -o yaml` - what does the `finally` block do, and what happens when a `finally` block contains its own `return` statement?",
    "A `return` (or an uncaught `throw`) inside a `finally` block unconditionally discards whatever the `try` or `catch` block was already in the middle of returning - or throwing.",
  ],
  options: [
    {
      id: "return-in-finally-swallows-everything",
      label:
        "`processPayment`'s `finally` block unconditionally executes `return success;` - in Java, a `return` inside `finally` always overrides any return value (or in-flight exception) from the `try`/`catch` blocks, so this doesn't just override the successful-charge return value, it can also silently discard an actual thrown exception if one were to occur elsewhere, and here it masks the fact that `catch` ran at all, always returning whatever `success` was set to (`false`) rather than reflecting what really happened.",
      explanation:
        "`PaymentFlow.java.excerpt` shows a `finally` block containing `return success;`. In Java, a `return` statement inside `finally` always wins - it discards any return value already produced by `try` or `catch`, and would even silently swallow an exception in flight if one were thrown and not caught. Here, `success` starts `false` and is only ever set `true` immediately before `try`'s own `return success;` - but that return is itself immediately discarded by `finally`'s own `return success;`, which re-reads the *same* variable. Since nothing else in this path sets `success` differently, the method quietly returns `false` for every declined and successful attempt alike, and callers see a boring `false` result with no exception, no log correlation beyond a debug line, and no visible error at all - exactly matching the reported silent failures.",
    },
    {
      id: "gateway-charge-not-actually-called",
      label: "`gateway.charge(session)` isn't actually being invoked for these sessions.",
      explanation:
        "The debug log confirms `submitting charge for session sess-9012` is logged immediately before the gateway call - the charge attempt is genuinely being made; what happens to its outcome afterward is where the bug lives.",
    },
    {
      id: "payment-declined-exception-not-thrown",
      label: "`PaymentDeclinedException` isn't being thrown correctly by the gateway client library.",
      explanation:
        "Whether or not `PaymentDeclinedException` is thrown, the `finally` block's unconditional `return success;` would override the method's return value regardless - the real problem is downstream of whatever the gateway does, in how `processPayment` handles the result afterward.",
    },
    {
      id: "session-object-mutated-during-charge",
      label: "The `Session` object is being mutated by another thread during the charge attempt.",
      explanation:
        "The failure is completely deterministic here, driven purely by control flow through `try`/`catch`/`finally` - there's no evidence of, or need for, concurrent mutation of shared state to explain the observed always-false result.",
    },
  ],
  correctOptionId: "return-in-finally-swallows-everything",
  resolution: `\`PaymentFlow.java.excerpt\` has a \`finally\` block with its own
\`return success;\` statement. In Java, control flow through
\`try\`/\`catch\`/\`finally\` has one hard rule that's easy to forget: a
\`return\` (or a \`throw\`) inside \`finally\` unconditionally overrides
whatever the \`try\` or \`catch\` block was already doing - including an
in-progress return value, and even an exception already being thrown.
Here, both the \`try\` block's \`return success;\` (after a successful
charge) and the \`catch\` block's \`return false;\` (after a declined
payment) are silently discarded, and execution instead returns whatever
\`finally\`'s own \`return success;\` evaluates to. Since \`success\` is
initialized \`false\` and is the same variable both branches read, and
nothing in this control flow updates it meaningfully before \`finally\`
runs, the method effectively always returns \`false\` - with the
\`catch\` block's warning log the only visible trace that anything went
wrong at all, and even that never fires for calls where the gateway
actually threw, because the finally's return would discard that path's
behavior too in the general case.

The fix is simply never putting a \`return\` (or \`throw\`) inside a
\`finally\` block - reserve \`finally\` strictly for cleanup that must always
run, never for producing the method's result:

\`\`\`java
public boolean processPayment(Session session) {
    try {
        gateway.charge(session);
        return true;
    } catch (PaymentDeclinedException e) {
        log.warn("payment declined for {}", session.id());
        return false;
    }
    // no finally needed here at all - remove it, or use it only for
    // cleanup with no return/throw inside it
}
\`\`\`

The general rule: a \`return\` or \`throw\` inside \`finally\` always wins over
anything happening in \`try\` or \`catch\`, silently discarding return values
and even in-flight exceptions - treat that as a hard rule to never write,
not a stylistic preference.`,
};
