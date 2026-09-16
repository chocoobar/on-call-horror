import type { Scenario } from "../types";

export const thePatternVariableThatLeaked: Scenario = {
  id: "the-pattern-variable-that-leaked",
  title: "The Pattern Variable That Leaked",
  subtitle: "the refund calculator throws a compile-adjacent runtime NPE only when the original payment used store credit",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "pattern-matching", "instanceof"],
  briefing: `"refund-calculator" was recently rewritten to use pattern-matching
\`instanceof\`, cleaning up a lot of old casting boilerplate. Since that
rewrite, refunds for orders originally paid with store credit throw a
NullPointerException, while card and cash-paid orders refund correctly.`,
  constraints: [
    "Every `Payment` subtype involved (`CardPayment`, `CashPayment`, `StoreCreditPayment`) is confirmed to construct correctly with all its fields populated - the bug is in how the refund logic branches on payment type.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "refund-calculator", namespace: "payments", labels: { app: "refund-calculator" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "refund-calculator-2j3k4l5m6-n7o8p", namespace: "payments", labels: { app: "refund-calculator" } },
        status: { phase: "Running", containerStatuses: [{ name: "refund-calculator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "refund-calculator": [
            "2026-09-15T14:12:09.114Z ERROR c.e.payments.RefundCalculator - java.lang.NullPointerException: Cannot invoke \"StoreCreditPayment.creditAccountId()\" because \"creditPayment\" is null",
            "    at app//com.example.payments.RefundCalculator.calculate(RefundCalculator.java:15)",
          ],
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "refund-calculator-notes", namespace: "payments" },
        spec: {
          data: {
            "RefundCalculator.java.excerpt":
              "public Refund calculate(Payment original) {\n    StoreCreditPayment creditPayment = null;\n    if (original instanceof StoreCreditPayment sc && sc.amount() > 0) {\n        creditPayment = sc;   // only assigned inside this branch's own scope\n    }\n    if (original instanceof CardPayment cp) {\n        return refundToCard(cp);\n    }\n    // intended fallback for store credit, but written incorrectly:\n    return refundToStoreCredit(creditPayment);\n}\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl logs refund-calculator-2j3k4l5m6-n7o8p -n payments` - `creditPayment` is null at the point it's used, even for an order that genuinely was paid with store credit.",
    "`kubectl get configmap refund-calculator-notes -n payments -o yaml` - `creditPayment` is only ever assigned inside the body of one specific `if`. What has to be true for that assignment to actually run?",
    "The pattern-matching condition also checks `sc.amount() > 0` - what happens to `creditPayment` if the original payment genuinely is a `StoreCreditPayment`, but its `amount()` isn't greater than zero (e.g., it's exactly the refund's own baseline case)?",
  ],
  options: [
    {
      id: "pattern-variable-assignment-gated-by-extra-condition",
      label:
        "`creditPayment` is only assigned inside the `if (original instanceof StoreCreditPayment sc && sc.amount() > 0)` branch's own body, so it stays `null` for any `StoreCreditPayment` whose `amount()` isn't strictly greater than zero - the code then falls through to `refundToStoreCredit(creditPayment)` at the end regardless, passing along a `null` reference for exactly that case, since the extra `&&` condition (not just the type check) gates whether the pattern variable is ever actually captured into that outer-scope local.",
      explanation:
        "The stack trace shows `creditPayment` is `null` at the point `refundToStoreCredit` calls a method on it. `RefundCalculator.java.excerpt` shows `creditPayment` is declared `null` up front and only reassigned inside the `if` block's body - which requires *both* `original instanceof StoreCreditPayment sc` *and* `sc.amount() > 0` to be true. Any store-credit-paid order whose original payment amount doesn't satisfy that second condition skips the assignment entirely, leaving `creditPayment` `null` when it's used later in `refundToStoreCredit(creditPayment)`, regardless of the payment's real type.",
    },
    {
      id: "storecreditpayment-constructor-not-setting-account-id",
      label: "`StoreCreditPayment`'s constructor isn't setting `creditAccountId` correctly for some orders.",
      explanation:
        "The exception is thrown because `creditPayment` itself - the entire object reference - is null, not because a valid `StoreCreditPayment` object's `creditAccountId` field specifically is null - every subtype's construction is confirmed correct here; the object simply never gets assigned to `creditPayment` in the first place for the failing case.",
    },
    {
      id: "refund-service-passed-wrong-payment-type",
      label: "The refund service is being called with the wrong `Payment` subtype for store-credit orders.",
      explanation:
        "The stack trace and code both confirm the correct type check (`instanceof StoreCreditPayment`) runs against `original` - the type itself isn't in question; it's an additional condition alongside the type check that determines whether the resulting pattern variable is actually captured for later use.",
    },
    {
      id: "refundtostorecredit-method-has-a-bug",
      label: "`refundToStoreCredit`'s own internal logic has a bug unrelated to what's passed into it.",
      explanation:
        "The exception message and stack trace point at the call site passing a null argument into `refundToStoreCredit`, not at anything happening inside that method's own body - the null is already null by the time it's handed over.",
    },
  ],
  correctOptionId: "pattern-variable-assignment-gated-by-extra-condition",
  resolution: `The stack trace pinpoints it precisely: \`creditPayment\` is \`null\` at the
line invoking a method on it. \`RefundCalculator.java.excerpt\` declares
\`StoreCreditPayment creditPayment = null;\` outside any conditional, and
only reassigns it inside the body of
\`if (original instanceof StoreCreditPayment sc && sc.amount() > 0)\`. That
condition requires *two* things to both be true: the type check, and
\`sc.amount() > 0\`. Any order originally paid with store credit whose
payment amount doesn't satisfy that second, unrelated condition (for
example, a zero-dollar promotional credit payment, or any value the
original author didn't anticipate when adding that extra check) skips
the assignment entirely - \`creditPayment\` stays \`null\`, and the code
falls through unconditionally to \`refundToStoreCredit(creditPayment)\` at
the end of the method regardless of whether the assignment actually ran.

The fix is separating the type check (which should always capture the
pattern variable for any \`StoreCreditPayment\`) from whatever additional
business condition was meant to guard something else entirely:

\`\`\`java
public Refund calculate(Payment original) {
    if (original instanceof CardPayment cp) {
        return refundToCard(cp);
    }
    if (original instanceof StoreCreditPayment sc) {
        return refundToStoreCredit(sc);   // captured unconditionally on type match
    }
    throw new IllegalArgumentException("unsupported payment type: " + original);
}
\`\`\`

The general rule: a pattern variable from \`instanceof\` combined with
\`&&\` is only definitely assigned within the scope where *the entire
combined condition* evaluated true - any extra condition chained onto the
type check with \`&&\` can silently prevent the pattern variable from ever
being populated for inputs that do match the type but fail that extra
check.`,
};
