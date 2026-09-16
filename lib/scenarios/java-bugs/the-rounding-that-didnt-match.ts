import type { Scenario } from "../types";

export const theRoundingThatDidntMatch: Scenario = {
  id: "the-rounding-that-didnt-match",
  title: "The Rounding That Didn't Match",
  subtitle: "the printed receipt total and the amount actually charged to the card differ by a single cent, seemingly at random",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "bigdecimal", "rounding"],
  briefing: `Point-of-sale receipts occasionally show a total one cent different from
what the card network reports was actually charged. It's rare, small,
and easy to dismiss - until a customer disputes the charge and a
finance audit confirms it's a real, reproducible discrepancy tied to
specific tax rate and quantity combinations.`,
  constraints: [
    "Both the receipt total and the actual charge amount are computed from the exact same underlying line items and tax rate - there's no separate, independently-entered value anywhere in this flow.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pos-checkout", namespace: "retail", labels: { app: "pos-checkout" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pos-checkout-4q5r6s7t8-u9v0w", namespace: "retail", labels: { app: "pos-checkout" } },
        status: { phase: "Running", containerStatuses: [{ name: "pos-checkout", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pos-checkout": [
            "2026-09-15T15:44:02.114Z DEBUG c.e.retail.ReceiptPrinter - printed total: 14.85 (rounding=HALF_UP)",
            "2026-09-15T15:44:02.204Z DEBUG c.e.retail.ChargeProcessor - charged amount: 14.84 (rounding=HALF_EVEN, default)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pos-checkout-notes", namespace: "retail" },
        spec: {
          data: {
            "ReceiptPrinter.java.excerpt":
              "public BigDecimal computeTotal(BigDecimal subtotal, BigDecimal taxRate) {\n    BigDecimal tax = subtotal.multiply(taxRate).setScale(2, RoundingMode.HALF_UP);\n    return subtotal.add(tax);\n}\n",
            "ChargeProcessor.java.excerpt":
              "public BigDecimal computeChargeAmount(BigDecimal subtotal, BigDecimal taxRate) {\n    BigDecimal tax = subtotal.multiply(taxRate).setScale(2, RoundingMode.HALF_EVEN);\n        // HALF_EVEN ('banker's rounding') is BigDecimal's default when\n        // no RoundingMode is specified via certain call paths, and was\n        // used here deliberately by a different engineer for different\n        // reasons, without realizing the receipt side uses HALF_UP\n    return subtotal.add(tax);\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs pos-checkout-4q5r6s7t8-u9v0w -n retail` - both values are computed from the same subtotal and tax rate, but with two different `RoundingMode`s logged explicitly.",
    "`kubectl get configmap pos-checkout-notes -n retail -o yaml` - `ReceiptPrinter` and `ChargeProcessor` both round the computed tax to 2 decimal places, but with different `RoundingMode` values. Do `HALF_UP` and `HALF_EVEN` always agree?",
    "`HALF_UP` and `HALF_EVEN` only disagree on values exactly at the halfway point (like `...X5` rounding to 2 places) - which is exactly why this discrepancy is rare and seems to depend on the specific tax rate and quantity combination, rather than happening on every single transaction.",
  ],
  options: [
    {
      id: "two-different-rounding-modes-same-calculation",
      label:
        "`ReceiptPrinter.computeTotal` rounds the computed tax using `RoundingMode.HALF_UP`, while `ChargeProcessor.computeChargeAmount` independently rounds the exact same computation using `RoundingMode.HALF_EVEN` - the two rounding modes only disagree when the value being rounded lands exactly on a rounding boundary (a `...5` in the digit being dropped), which is why the discrepancy is rare and tied to specific tax rate/quantity combinations rather than happening on every transaction, but whenever it does occur, the printed receipt and the actual card charge differ by exactly one cent.",
      explanation:
        "The debug log shows both values explicitly logged with their `RoundingMode`: the receipt uses `HALF_UP`, producing `14.85`, while the charge uses `HALF_EVEN`, producing `14.84` - a one-cent difference from the exact same subtotal and tax rate. `ReceiptPrinter.java.excerpt` and `ChargeProcessor.java.excerpt` confirm this isn't a coincidence: two different engineers used two different `RoundingMode` values for the same tax calculation, in two different classes that are supposed to represent the same total. `HALF_UP` and `HALF_EVEN` ('banker's rounding') only produce different results when the value being rounded is exactly at the halfway point of the digit being dropped - which explains precisely why this only shows up for specific tax rate/quantity combinations that happen to land exactly on that boundary, rather than being a constant, obvious, always-reproducing discrepancy.",
    },
    {
      id: "credit-card-network-fee-not-accounted-for",
      label: "The credit card network is deducting an undisclosed processing fee from the charged amount.",
      explanation:
        "The debug log shows both values computed entirely within the application's own code, from the exact same subtotal and tax rate, before either ever reaches a card network - the one-cent difference is fully explained by two different in-application rounding modes, with no external fee deduction involved.",
    },
    {
      id: "tax-rate-configuration-drifting-between-services",
      label: "The tax rate configuration used by `ReceiptPrinter` and `ChargeProcessor` has drifted out of sync.",
      explanation:
        "The constraint confirms both totals are computed from the exact same underlying tax rate value - there's no separate, independently-configured tax rate for either component; the divergence is introduced purely by the rounding step applied afterward, not by differing input rates.",
    },
    {
      id: "floating-point-precision-in-tax-calculation",
      label: "Floating-point imprecision in the tax calculation is causing the discrepancy.",
      explanation:
        "Both calculations use `BigDecimal` throughout, which is specifically designed to avoid binary floating-point imprecision - the discrepancy is fully and precisely explained by two deliberately different `RoundingMode` values applied to the same exact `BigDecimal` computation, not by any floating-point rounding error.",
    },
  ],
  correctOptionId: "two-different-rounding-modes-same-calculation",
  resolution: `The debug log shows both values with their rounding mode explicitly
logged: the receipt computes \`14.85\` using \`HALF_UP\`, while the actual
charge computes \`14.84\` using \`HALF_EVEN\` - from the exact same subtotal
and tax rate. \`ReceiptPrinter.java.excerpt\` and
\`ChargeProcessor.java.excerpt\` confirm this is a genuine inconsistency:
two different classes, meant to represent the same underlying total,
independently round the same tax calculation using two different
\`RoundingMode\` values, apparently chosen by two different engineers at
two different times without either realizing the other used something
different. \`HALF_UP\` (round away from zero on an exact half) and
\`HALF_EVEN\` (round to the nearest even digit on an exact half, "banker's
rounding," often preferred for reducing cumulative rounding bias across
many transactions) only actually disagree when the value being rounded
lands exactly on the halfway point of the digit being dropped - which is
precisely why this discrepancy is rare, and only surfaces for specific
tax rate and quantity combinations that happen to produce an exact
\`...5\` at the rounding boundary, rather than showing up on every single
transaction.

The fix is using one single, shared rounding mode (and ideally one
single, shared calculation method) for any value that needs to match
across the receipt and the actual charge:

\`\`\`java
public static BigDecimal computeTaxInclusiveTotal(BigDecimal subtotal, BigDecimal taxRate) {
    BigDecimal tax = subtotal.multiply(taxRate).setScale(2, RoundingMode.HALF_UP);
    return subtotal.add(tax);
}
// both ReceiptPrinter and ChargeProcessor call this same shared method,
// eliminating the possibility of divergence entirely
\`\`\`

The general rule: any monetary value that needs to match exactly across
two independently-implemented code paths (a receipt and an actual
charge, for example) should be computed by one single shared function,
not reimplemented twice - even functionally-equivalent-looking \`BigDecimal\`
arithmetic can diverge by a cent whenever two different \`RoundingMode\`
values are used for the same nominally-identical calculation.`,
};
