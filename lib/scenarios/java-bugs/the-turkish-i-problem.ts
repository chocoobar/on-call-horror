import type { Scenario } from "../types";

export const theTurkishIProblem: Scenario = {
  id: "the-turkish-i-problem",
  title: "The Turkish-I Problem",
  subtitle: "promo code redemption fails for a small but consistent slice of customers, all in one specific region",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "locale", "strings"],
  briefing: `"promo-redeemer" normalizes promo codes to uppercase before checking
them against the valid code list, so customers can type codes in any
casing. Since expanding to a new region, some customers there report a
code like "iphone15" being rejected as invalid, even though the exact
same code (typed identically) works fine for everyone else.`,
  constraints: [
    "The valid promo code list is confirmed correct and identical for every region - there's no region-specific code list involved here at all.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "promo-redeemer", namespace: "promotions", labels: { app: "promo-redeemer" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "promo-redeemer-4l5m6n7o8-p9q0r", namespace: "promotions", labels: { app: "promo-redeemer" } },
        status: { phase: "Running", containerStatuses: [{ name: "promo-redeemer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "promo-redeemer": [
            "2026-09-15T11:00:04.114Z DEBUG c.e.promotions.CodeValidator - input=\"iphone15\" normalized=\"İPHONE15\" locale=tr-TR",
            "2026-09-15T11:00:04.116Z INFO  c.e.promotions.CodeValidator - code \"İPHONE15\" not found in valid code set (expected \"IPHONE15\")",
          ],
        },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "promo-redeemer-notes", namespace: "promotions" },
        spec: {
          data: {
            "CodeValidator.java.excerpt":
              "public boolean isValid(String rawCode) {\n    // uses the server thread's default Locale, which reflects the\n    // request's Accept-Language / region setting on this deployment\n    String normalized = rawCode.toUpperCase();\n    return validCodes.contains(normalized);   // validCodes was built with\n                                                // Locale.ROOT / English casing rules\n}\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl logs promo-redeemer-4l5m6n7o8-p9q0r -n promotions` - `\"iphone15\"` uppercased to `\"İPHONE15\"`, with a dotted capital İ where a plain `I` was expected. That's not a typo in the log - it's a real, different Unicode character.",
    "`kubectl get configmap promo-redeemer-notes -n promotions -o yaml` - `String.toUpperCase()` with no arguments uses the JVM/thread's *default* `Locale`. Does every locale uppercase the letter 'i' the same way?",
    "Turkish (and Azerbaijani) has two distinct pairs of 'i' letters - dotted and dotless - and uppercasing 'i' under a Turkish locale produces a dotted capital İ (U+0130), not the plain ASCII 'I' (U+0049) that every valid code was built against.",
  ],
  options: [
    {
      id: "locale-sensitive-touppercase-turkish-i",
      label:
        "`rawCode.toUpperCase()` is called with no explicit `Locale`, so it uses whatever locale the running thread's default happens to be - under a Turkish (`tr-TR`) locale, uppercasing the letter 'i' produces the Turkish dotted capital İ (a different Unicode character from plain ASCII 'I'), so `\"iphone15\"` normalizes to `\"İPHONE15\"` instead of `\"IPHONE15\"`, which never matches the valid code set that was built using ordinary ASCII casing rules.",
      explanation:
        "The debug log shows the exact mechanism: `input=\"iphone15\"` normalizes to `\"İPHONE15\"` under `locale=tr-TR`, with a dotted capital İ where `\"IPHONE15\"` (with a plain ASCII I) was expected. `CodeValidator.java.excerpt` calls `.toUpperCase()` with no explicit locale argument, meaning it silently uses the request/thread's default locale rather than a fixed, locale-independent casing rule - and Turkish is one of a small number of locales where uppercasing 'i' does not produce plain ASCII 'I'. The valid code set, built without any locale-specific casing in mind, only ever contains the ASCII form, so any Turkish-locale request normalizing a code containing 'i' fails to match, regardless of how correctly the customer typed it.",
    },
    {
      id: "promo-code-list-not-synced-for-new-region",
      label: "The valid promo code list wasn't properly synced to the new region's deployment.",
      explanation:
        "The valid code list is confirmed identical and correctly present across every region - the log shows the *normalized input string itself* doesn't match, due to how it was uppercased, not that the expected code is missing from the list.",
    },
    {
      id: "keyboard-input-encoding-issue",
      label: "Customers in the new region are typing the code using a keyboard layout that inserts different Unicode characters.",
      explanation:
        "The debug log's `input` field shows the exact same ASCII string, `\"iphone15\"`, was received correctly - the divergence only appears after the application's own `.toUpperCase()` call runs on it, not in what was typed or received.",
    },
    {
      id: "database-collation-mismatch-for-new-region",
      label: "The database's string collation settings don't match for the new region's customer records.",
      explanation:
        "The mismatch is happening entirely in application memory, in a `Set.contains()` check against an in-memory `validCodes` set - no database comparison or collation setting is involved in this specific check at all.",
    },
  ],
  correctOptionId: "locale-sensitive-touppercase-turkish-i",
  resolution: `The debug log makes the mechanism visible directly: \`"iphone15"\`
normalizes to \`"İPHONE15"\` - a dotted capital İ, not the plain ASCII 'I'
every valid code was built with - under \`locale=tr-TR\`.
\`CodeValidator.java.excerpt\` calls \`rawCode.toUpperCase()\` with no
explicit \`Locale\` argument, which means it silently defers to the
running thread's default locale, typically derived from the request's
language/region context on a deployment serving multiple regions.
Turkish casing rules are a well-known, documented exception to "normal"
ASCII-style uppercasing: the lowercase dotless 'i' uppercases to a
*dotted* capital İ (Unicode U+0130), a genuinely different character
from plain ASCII 'I' (U+0049). \`validCodes\`, built without any awareness
of regional casing rules, only contains the ASCII form - so any request
processed under a Turkish locale normalizes its input to a string that
can never match, no matter how correctly the customer typed the code.

The fix is using a locale-independent uppercasing rule explicitly,
rather than relying on whatever the default happens to be:

\`\`\`java
public boolean isValid(String rawCode) {
    String normalized = rawCode.toUpperCase(Locale.ROOT);   // locale-independent
    return validCodes.contains(normalized);
}
\`\`\`

The general rule: \`String.toUpperCase()\` / \`.toLowerCase()\` called with no
argument are locale-sensitive and can produce different results on
different deployments or under different request contexts - always pass
an explicit \`Locale\` (typically \`Locale.ROOT\` for machine-facing
comparisons like codes, keys, or identifiers) unless locale-sensitive
casing is specifically, deliberately what's wanted.`,
};
