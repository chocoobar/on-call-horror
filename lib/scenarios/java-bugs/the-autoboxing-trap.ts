import type { Scenario } from "../types";

export const theAutoboxingTrap: Scenario = {
  id: "the-autoboxing-trap",
  title: "The Autoboxing Trap",
  subtitle: "the loyalty discount works for most customers, but never for anyone with a large account balance",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "autoboxing", "production-bug"],
  briefing: `Customer support has a growing pile of tickets: the loyalty discount
"never applies" for high-balance accounts, even though those customers
clearly qualify by every rule the business describes. It works
perfectly for smaller accounts. QA never caught this - their test
accounts all use small, round test balances.`,
  constraints: [
    "The discount eligibility rule itself is confirmed correct and simple: balance above a fixed threshold qualifies. The bug is in how that comparison is actually implemented in code.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "loyalty-service", namespace: "loyalty", labels: { app: "loyalty-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "loyalty-service-7d8e9f0g1-h2i3j", namespace: "loyalty", labels: { app: "loyalty-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "loyalty-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "loyalty-service": [
            "2026-09-15T10:00:01.114Z DEBUG c.e.loyalty.DiscountEngine - checking eligibility: accountBalance=Integer(120), threshold=Integer(100)",
            "2026-09-15T10:00:01.116Z INFO  c.e.loyalty.DiscountEngine - discount applied for account acc-001",
            "2026-09-15T10:00:05.204Z DEBUG c.e.loyalty.DiscountEngine - checking eligibility: accountBalance=Integer(50000), threshold=Integer(100)",
            "2026-09-15T10:00:05.206Z INFO  c.e.loyalty.DiscountEngine - discount NOT applied for account acc-002",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "loyalty-engine-notes", namespace: "loyalty" },
        spec: {
          data: {
            "DiscountEngine.java.excerpt":
              "public boolean isEligible(Integer accountBalance, Integer threshold) {\n    // both parameters are boxed Integer, populated from a\n    // Map<String, Integer> loaded via a config/database lookup earlier\n    // in the request\n    if (accountBalance >= threshold) {\n        return true;\n    }\n    return false;\n}\n\n// elsewhere in the same class, the actual bug:\nprivate boolean qualifiesForLoyaltyTier(Integer balance) {\n    Integer tierCutoff = 10000;\n    return balance == tierCutoff;   // reference comparison on boxed Integers\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap loyalty-engine-notes -n loyalty -o yaml` - there are two different comparisons happening in this class. Read both carefully - one uses `>=`, the other uses `==`.",
    "Java caches and reuses `Integer` objects for values from -128 to 127 (the 'Integer cache') - `==` on two `Integer` references inside that range can accidentally 'work' by coincidence, while `==` outside that range compares object identity, not numeric value.",
    "QA's test accounts using small, round balances (well within -128 to 127) would make a broken `==` comparison on boxed `Integer`s pass by pure accident during testing, while any real customer with a balance outside that narrow range would fail the same comparison every time.",
  ],
  options: [
    {
      id: "integer-equals-reference-comparison",
      label:
        "`qualifiesForLoyaltyTier` compares two boxed `Integer` values with `==`, which compares object reference identity, not numeric value - for small values within Java's cached Integer range (-128 to 127) this accidentally 'works' by coincidence, which is exactly why QA's small test balances never caught it, but for any real balance outside that range, `==` compares two genuinely different `Integer` objects and is always false, no matter how well the actual numbers match.",
      explanation:
        "`DiscountEngine.java.excerpt` shows `balance == tierCutoff` comparing two boxed `Integer` objects with `==` - a reference comparison, not a value comparison, for object types. Java caches `Integer` objects for values -128 through 127 and reuses the same cached instance for repeated autoboxing of any value in that range, which makes `==` accidentally return correct results purely by coincidence when both operands happen to fall in that narrow window - exactly matching small, round QA test balances. Any real customer balance outside that tiny range (which is every meaningful account balance in a loyalty program) autoboxes to a brand-new, distinct `Integer` object each time, so `==` compares two different objects and is always `false`, regardless of whether the actual numeric values genuinely match.",
    },
    {
      id: "threshold-value-wrong",
      label: "The discount eligibility threshold value itself is configured incorrectly.",
      explanation:
        "The eligibility rule shown in `isEligible` (`accountBalance >= threshold`) is a normal numeric comparison via unboxing and works correctly for any value - the actual reported failure traces to a completely separate method (`qualifiesForLoyaltyTier`) using a broken comparison operator, not to a misconfigured threshold value.",
    },
    {
      id: "database-storing-wrong-balance",
      label: "The database is storing incorrect account balance values for high-balance customers.",
      explanation:
        "There's no indication the stored balance values themselves are wrong - the debug log shows the correct real balance (`50000`) being read and compared; the bug is entirely in how that correctly-read value is compared against the tier cutoff in code, not in what value was stored or retrieved.",
    },
    {
      id: "concurrent-modification-of-balance",
      label: "The account balance is being concurrently modified by another process during the eligibility check.",
      explanation:
        "There's no evidence of concurrent modification here - the failure is completely deterministic and reproducible for any given balance outside the small cached-Integer range, every single time, which is inconsistent with a timing-dependent concurrency issue and consistent with a straightforward, always-wrong comparison operator.",
    },
  ],
  correctOptionId: "integer-equals-reference-comparison",
  resolution: `\`DiscountEngine.java.excerpt\` shows the actual bug isn't in the method the
logs are actively tracing (\`isEligible\`, which correctly uses \`>=\` and
unboxes to a primitive numeric comparison) - it's in a separate method,
\`qualifiesForLoyaltyTier\`, comparing two boxed \`Integer\` objects with
\`==\`. For object types, \`==\` compares reference identity: are these two
variables pointing at the literal same object in memory? Java's autoboxing
specification requires the JVM to cache and reuse \`Integer\` instances for
values from -128 to 127 (a common, well-known optimization) - which means
\`==\` on two \`Integer\`s in that narrow range often does return \`true\`,
purely because both happen to point at the same cached object, not
because the code is doing anything correct. Outside that range, every
autoboxing operation produces a brand-new, distinct \`Integer\` object, so
\`==\` compares two different objects and is always \`false\`, regardless of
whether the numbers inside them are actually equal.

QA's test accounts, using small round balances, almost certainly landed
inside that -128 to 127 cache range by coincidence, making the broken
comparison appear to work correctly throughout testing. Any real
customer's loyalty-tier balance - realistically always well above 127 -
hits the same comparison and always fails it, silently, with no
exception thrown anywhere to reveal the mistake.

The fix is comparing the actual numeric values, either by unboxing
explicitly or using \`.equals()\`:

\`\`\`java
private boolean qualifiesForLoyaltyTier(Integer balance) {
    int tierCutoff = 10000;
    return balance != null && balance == tierCutoff;   // int on the right
                                                          // forces unboxing
}
\`\`\`

The general rule: never compare boxed wrapper types (\`Integer\`, \`Long\`,
\`Double\`, and similar) with \`==\` unless reference identity is
specifically and intentionally what's being tested - use \`.equals()\`, or
unbox to a primitive first, for anything that's supposed to compare
actual values.`,
};
