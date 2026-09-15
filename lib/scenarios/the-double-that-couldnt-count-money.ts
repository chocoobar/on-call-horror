import type { Scenario } from "./types";

export const theDoubleThatCouldntCountMoney: Scenario = {
  id: "the-double-that-couldnt-count-money",
  title: "The Double That Couldn't Count Money",
  subtitle: "invoice totals are off by a fraction of a cent, and the accounting system refuses to reconcile them",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "floating-point", "money"],
  briefing: `The nightly accounting reconciliation job has started flagging a small
but growing number of invoices where the application-computed total
doesn't exactly match the sum of the same line items computed
independently by the accounting system - the difference is always a
tiny fraction of a cent, but it's enough to fail a strict equality check.`,
  constraints: [
    "Every individual line item amount is confirmed correct and identical between both systems - the discrepancy only appears in the final summed total.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-totals", namespace: "billing", labels: { app: "invoice-totals" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-totals-0r1s2t3u4-v5w6x", namespace: "billing", labels: { app: "invoice-totals" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoice-totals", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoice-totals": [
            "2026-09-15T02:15:03.114Z DEBUG c.e.billing.TotalCalculator - summing line items: [10.10, 10.20, 10.30]",
            "2026-09-15T02:15:03.116Z WARN  c.e.billing.ReconciliationCheck - invoice inv-6603 total mismatch: computed=30.599999999999998, expected=30.60",
          ],
        },
        age: "3y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-totals-notes", namespace: "billing" },
        spec: {
          data: {
            "TotalCalculator.java.excerpt":
              "public double sumLineItems(List<Double> amounts) {\n    double total = 0.0;\n    for (double amount : amounts) {\n        total += amount;\n    }\n    return total;\n}\n",
          },
        },
        age: "3y",
      },
    ],
  },
  hints: [
    "`kubectl logs invoice-totals-0r1s2t3u4-v5w6x -n billing` - `computed=30.599999999999998` for line items that should sum to exactly `30.60`. Where does that trailing noise come from?",
    "`kubectl get configmap invoice-totals-notes -n billing -o yaml` - line item amounts are stored and summed as `double`. Can every decimal value like `10.10` be represented exactly in binary floating point?",
    "`double` (and `float`) use base-2 floating point, which can only represent a subset of decimal fractions exactly - most 'round' decimal money values, like `10.10`, are actually stored as the *closest possible* binary approximation, and summing several such approximations compounds the tiny error.",
  ],
  options: [
    {
      id: "double-binary-floating-point-imprecision-for-money",
      label:
        "`sumLineItems` stores and adds monetary amounts as `double`, which uses base-2 (binary) floating point - most decimal fractions people use for money, like `10.10`, cannot be represented exactly in binary and are stored as the closest possible approximation instead, so summing several of these approximations accumulates a tiny rounding error, producing `30.599999999999998` instead of exactly `30.60`, a mismatch too small to notice by eye but large enough to fail a strict equality check against an independently, exactly computed total.",
      explanation:
        "The debug log confirms the exact inputs (`10.10`, `10.20`, `10.30`) sum to a value logged as `30.599999999999998`, not the exact `30.60` expected. `TotalCalculator.java.excerpt` declares both the running total and each line item amount as `double`. This is the textbook signature of binary floating-point imprecision: decimal fractions like `0.10` and `0.30` have no exact finite binary representation, so each one is stored as the nearest representable `double` value, and summing several of these near-but-not-exact values accumulates a visible rounding error - exactly the kind of tiny discrepancy a strict, exact equality check in a reconciliation system would (correctly) flag.",
    },
    {
      id: "reconciliation-system-using-different-rounding-rule",
      label: "The external accounting system uses a different rounding rule than the application does.",
      explanation:
        "The mismatch is visible directly in the application's own computed value (`30.599999999999998`) before any comparison against the external system happens at all - the imprecision originates entirely within `sumLineItems`'s own arithmetic, not from a rounding-rule difference between two systems.",
    },
    {
      id: "line-items-list-missing-an-entry",
      label: "The line items list passed to `sumLineItems` is occasionally missing an entry.",
      explanation:
        "The debug log shows all three expected line item amounts (`10.10`, `10.20`, `10.30`) present and correctly summed in intent - the discrepancy (a fraction of a cent) is far too small to be explained by a missing line item, and is exactly the magnitude typical of floating-point rounding error.",
    },
    {
      id: "currency-conversion-applied-twice",
      label: "A currency conversion step is being applied twice to some line items.",
      explanation:
        "There's no currency conversion happening anywhere in this code path - all three amounts are already in the same currency, and the tiny fractional discrepancy is characteristic of binary floating-point summation error, not of a conversion rate being applied an extra time.",
    },
  ],
  correctOptionId: "double-binary-floating-point-imprecision-for-money",
  resolution: `The debug log shows the exact computation: \`10.10 + 10.20 + 10.30\`
producing \`30.599999999999998\` instead of the exact \`30.60\` expected.
\`TotalCalculator.java.excerpt\` stores and sums every amount as \`double\` -
Java's IEEE 754 binary floating-point type. Binary floating point can
only exactly represent fractions whose denominator is a power of two;
decimal fractions like \`0.10\` and \`0.30\`, completely ordinary and "round"
to a human reading them, have no exact finite binary representation and
are stored as the closest possible approximation instead. Each of those
tiny approximation errors is individually invisible, but summing several
of them compounds the error into something large enough to fail a
strict equality check - which is exactly why a reconciliation system
comparing an exact expected value against this computed one flags a
mismatch, even though every individual line item is completely correct.

The fix is using \`BigDecimal\` for any value representing money, never
\`float\`/\`double\`:

\`\`\`java
public BigDecimal sumLineItems(List<BigDecimal> amounts) {
    BigDecimal total = BigDecimal.ZERO;
    for (BigDecimal amount : amounts) {
        total = total.add(amount);
    }
    return total;
}
\`\`\`

Constructing each \`BigDecimal\` from a \`String\` (\`new BigDecimal("10.10")\`,
not \`BigDecimal.valueOf(10.10)\` from an already-imprecise \`double\`
literal) avoids ever introducing the binary approximation error in the
first place. The general rule: \`float\` and \`double\` are fundamentally
unsuitable for representing money or any value requiring exact decimal
arithmetic - use \`BigDecimal\` (or a fixed-point integer representation,
like storing cents as a `long`) for anything financial, full stop.`,
};
