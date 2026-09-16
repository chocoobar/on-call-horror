import type { Scenario } from "../types";

export const theScaleMismatch: Scenario = {
  id: "the-scale-mismatch",
  title: "The Scale Mismatch",
  subtitle: "the duplicate-charge detector keeps letting genuinely identical charges through, side by side",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "bigdecimal", "equality"],
  briefing: `"charge-dedup" is supposed to catch and block a duplicate charge attempt
by keeping a \`HashSet\` of amounts already charged this session, comparing
new charge amounts against it. A customer was double-charged $19.90
because the dedup check let the second, identical charge straight
through.`,
  constraints: [
    "The two charge amounts in the double-charge incident are confirmed to be genuinely identical in value - $19.90 both times, from the same idempotent retry logic upstream.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "charge-dedup", namespace: "payments", labels: { app: "charge-dedup" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "charge-dedup-5m6n7o8p9-q0r1s", namespace: "payments", labels: { app: "charge-dedup" } },
        status: { phase: "Running", containerStatuses: [{ name: "charge-dedup", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "charge-dedup": [
            "2026-09-15T15:20:01.114Z DEBUG c.e.payments.ChargeDedup - recording seen amount=19.90 (scale=1)",
            "2026-09-15T15:20:04.208Z DEBUG c.e.payments.ChargeDedup - checking amount=19.900 (scale=2) against seen set",
            "2026-09-15T15:20:04.210Z INFO  c.e.payments.ChargeDedup - amount 19.900 not found in seen set, allowing charge",
          ],
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "charge-dedup-notes", namespace: "payments" },
        spec: {
          data: {
            "ChargeDedup.java.excerpt":
              "private final Set<BigDecimal> seenAmounts = new HashSet<>();\n\npublic boolean isDuplicate(BigDecimal amount) {\n    // HashSet relies on equals()/hashCode() for membership checks\n    return !seenAmounts.add(amount);\n}\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl logs charge-dedup-5m6n7o8p9-q0r1s -n payments` - both amounts are `19.90` in real value, but logged with different `scale`. Why would that matter for a `HashSet`?",
    "`kubectl get configmap charge-dedup-notes -n payments -o yaml` - `HashSet` membership relies on `equals()` (and a matching `hashCode()`). What does `BigDecimal.equals()` actually compare?",
    "`BigDecimal.equals()` is documented to consider two values unequal if they have different *scale*, even when they represent the exact same numeric value - `19.90` and `19.900` are numerically equal via `compareTo()`, but not `.equals()`.",
  ],
  options: [
    {
      id: "bigdecimal-equals-scale-sensitive-hashset",
      label:
        "`seenAmounts` is a `HashSet<BigDecimal>`, and `BigDecimal.equals()` (which `HashSet` relies on for membership checks) considers two values unequal whenever their scale differs, even if they're numerically identical via `compareTo()` - `19.90` (scale 1) and `19.900` (scale 2), while representing the exact same dollar amount, are treated as two distinct entries, so the second charge's differently-scaled `BigDecimal` never matches the first one already recorded in the set.",
      explanation:
        "The debug log shows the first charge recorded with `scale=1` (`19.90`) and the second, duplicate charge arriving with `scale=2` (`19.900`) - numerically the same $19.90, but represented with different internal scale. `ChargeDedup.java.excerpt` relies on `HashSet<BigDecimal>`'s default `equals()`/`hashCode()` behavior, and `BigDecimal.equals()` is explicitly documented to compare both numeric value *and* scale - two `BigDecimal`s that are numerically equal via `compareTo()` can still be `!equals()` if their scale differs, which is exactly what let this genuinely duplicate charge through undetected.",
    },
    {
      id: "hashset-not-thread-safe-for-concurrent-charges",
      label: "`HashSet` isn't thread-safe, and concurrent charge attempts are racing on `seenAmounts`.",
      explanation:
        "The two charge attempts are logged four seconds apart, not concurrently, and the mismatch is explained entirely by the `BigDecimal` scale difference visible in the logs themselves - no race condition is needed to explain this specific, fully deterministic failure.",
    },
    {
      id: "upstream-retry-logic-sending-wrong-amount",
      label: "The upstream idempotent retry logic is sending a slightly different amount on retry.",
      explanation:
        "Both amounts are confirmed to be the exact same $19.90 in real monetary value - the difference is purely in how many decimal digits of scale each `BigDecimal` instance happens to carry, not in the actual charge amount being requested.",
    },
    {
      id: "seenamounts-set-being-cleared-between-charges",
      label: "`seenAmounts` is being cleared or reset between the two charge attempts.",
      explanation:
        "The log shows the first amount was genuinely recorded into `seenAmounts` and the set is never cleared anywhere in this flow - the lookup for the second charge simply doesn't match the entry that's still correctly sitting in the set, due to the scale mismatch.",
    },
  ],
  correctOptionId: "bigdecimal-equals-scale-sensitive-hashset",
  resolution: `The debug log shows both charges are $19.90 in real value, but with
different internal scale: \`19.90\` (scale 1) recorded first, then
\`19.900\` (scale 2) checked four seconds later. \`ChargeDedup.java.excerpt\`
uses a plain \`HashSet<BigDecimal>\`, which relies on \`BigDecimal\`'s own
\`equals()\`/\`hashCode()\` for membership checks. \`BigDecimal.equals()\` is
explicitly documented to compare both numeric value *and* scale - unlike
\`compareTo()\`, which correctly treats \`19.90\` and \`19.900\` as equal
because they represent the same number, \`.equals()\` (and therefore
\`hashCode()\`, and therefore \`HashSet\` membership) treats them as
different objects entirely, since they differ in how many digits of
scale they carry. The second, genuinely duplicate charge's \`BigDecimal\`
never matches the first one already sitting in \`seenAmounts\`, so the
dedup check lets it straight through.

The fix is normalizing scale before using \`BigDecimal\` as a dedup/set
key, or comparing with \`compareTo()\` instead of relying on \`HashSet\`
membership directly:

\`\`\`java
public boolean isDuplicate(BigDecimal amount) {
    BigDecimal normalized = amount.stripTrailingZeros().setScale(2, RoundingMode.UNNECESSARY);
    return !seenAmounts.add(normalized);
}
\`\`\`

The general rule: never use \`BigDecimal\` as a \`HashSet\`/\`HashMap\` key (or
compare it with \`.equals()\`) unless its scale is guaranteed consistent -
\`BigDecimal.equals()\` is scale-sensitive by design, while \`compareTo()\`
(and the natural ordering it defines) is not; picking the wrong one for
the job is a well-known, easy-to-miss \`BigDecimal\` trap.`,
};
