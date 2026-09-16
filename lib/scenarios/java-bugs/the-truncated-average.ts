import type { Scenario } from "../types";

export const theTruncatedAverage: Scenario = {
  id: "the-truncated-average",
  title: "The Truncated Average",
  subtitle: "products with a genuinely great rating keep displaying a suspiciously round, lower average",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 10,
  tags: ["java25", "integer-division", "product-catalog"],
  briefing: `Several sellers have complained that their product's displayed star
rating is lower than it should be - a product with three 5-star reviews
and one 4-star review is showing "4 stars", not "4.75 stars". The raw
review scores stored in the database are confirmed correct.`,
  constraints: [
    "Every individual review's stored star value is confirmed correct and unchanged in the database - the bug is entirely in how the displayed average is computed from them.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "rating-service", namespace: "catalog", labels: { app: "rating-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "rating-service-5c6d7e8f9-g0h1i", namespace: "catalog", labels: { app: "rating-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "rating-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "rating-service": [
            "2026-09-15T09:14:02.114Z DEBUG c.e.catalog.RatingCalculator - product prod-7712 scores=[5, 5, 5, 4] sum=19 count=4",
            "2026-09-15T09:14:02.116Z INFO  c.e.catalog.RatingCalculator - product prod-7712 average=4",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rating-calculator-notes", namespace: "catalog" },
        spec: {
          data: {
            "RatingCalculator.java.excerpt":
              "public double averageRating(List<Integer> scores) {\n    int sum = 0;\n    for (int score : scores) {\n        sum += score;\n    }\n    int count = scores.size();\n    double average = sum / count;   // int / int, computed before the\n                                     // result is ever treated as a double\n    return average;\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs rating-service-5c6d7e8f9-g0h1i -n catalog` - `sum=19` and `count=4` should average to `4.75`, not `4`. Where does the fractional part disappear?",
    "`kubectl get configmap rating-calculator-notes -n catalog -o yaml` - what are the declared types of `sum` and `count` in the division on the line computing `average`?",
    "Java performs integer division when both operands of `/` are `int` - the result is truncated toward zero *before* it's ever assigned to a `double` variable.",
  ],
  options: [
    {
      id: "integer-division-before-double-assignment",
      label:
        "`sum / count` divides two `int` values, and Java always performs integer division (truncating any fractional part) when both operands are integer types - the truncated whole-number result is only converted to `double` afterward, when it's assigned to the `average` variable, by which point the fractional part (`.75`) is already gone forever.",
      explanation:
        "The log shows `sum=19`, `count=4`, which should average to `4.75`, but `RatingCalculator.java.excerpt` computes `sum / count` where both are declared `int` - Java's `/` operator performs integer division whenever both operands are integer types, discarding any remainder, producing `4`. That truncated `int` result is then widened to `double` for the `average` variable, but the fractional information is already lost by that point - widening a value after truncation can't recover what was truncated away.",
    },
    {
      id: "reviews-not-all-counted",
      label: "Not all of a product's reviews are being included in the calculation.",
      explanation:
        "The debug log shows all four scores (`[5, 5, 5, 4]`) present in `scores` and correctly summed to `19` - every review is being counted; the problem is purely arithmetic, in how the correct sum and count are divided.",
    },
    {
      id: "rating-rounding-down-intentionally",
      label: "The display layer intentionally rounds ratings down to the nearest whole star.",
      explanation:
        "There's no rounding logic anywhere in `averageRating` at all - rounding implies deliberately discarding a known fractional value in a controlled way; this is losing the fractional value entirely and silently, as an unintended side effect of integer arithmetic.",
    },
    {
      id: "database-storing-integer-scores-only",
      label: "The database schema only supports storing whole-number star ratings, losing precision on write.",
      explanation:
        "The individual review scores themselves are whole numbers by design (1 to 5 stars) and are confirmed correctly stored - the precision that's lost here is in the *computed average* of several whole-number scores, not in how any single review's score is stored.",
    },
  ],
  correctOptionId: "integer-division-before-double-assignment",
  resolution: `The debug log gives the exact inputs: \`sum=19\`, \`count=4\`, which should
average to \`4.75\`. \`RatingCalculator.java.excerpt\` shows \`average\` is
computed as \`sum / count\`, where both \`sum\` and \`count\` are declared
\`int\`. In Java, the \`/\` operator performs integer division whenever both
operands are integer types - it computes \`19 / 4 = 4\`, truncating (not
rounding) the fractional remainder entirely, and only afterward is that
already-truncated \`4\` widened to a \`double\` for the \`average\` variable.
Widening happens *after* the division, not before it, so declaring
\`average\` as \`double\` does nothing to prevent the truncation - the damage
is done the instant \`sum / count\` is evaluated.

The fix is forcing floating-point division by making at least one operand
a \`double\` before the division happens:

\`\`\`java
public double averageRating(List<Integer> scores) {
    int sum = 0;
    for (int score : scores) {
        sum += score;
    }
    int count = scores.size();
    return count == 0 ? 0.0 : (double) sum / count;   // cast before dividing
}
\`\`\`

The general rule: Java's \`/\` operator's behavior depends entirely on the
*operand types at the point of division*, not on what type the result is
eventually assigned to - dividing two \`int\`s always truncates, regardless
of what you do with the result afterward. Cast at least one operand to a
floating-point type before dividing whenever a fractional result matters.`,
};
