import type { Scenario } from "./types";

export const theNullThatBrokeThePattern: Scenario = {
  id: "the-null-that-broke-the-pattern",
  title: "The Null That Broke the Pattern",
  subtitle: "the discount-code router crashes exactly when a customer's cart has no discount code applied at all",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "pattern-matching", "switch"],
  briefing: `A recent cleanup rewrote the discount-code routing logic to use a modern
pattern-matching \`switch\` over the code's type. Carts with any kind of
discount code route correctly. Carts with no discount code at all -
previously the most common, unremarkable case - now throw an exception
and fail checkout entirely.`,
  constraints: [
    "The absence of a discount code is confirmed to be represented as a literal `null` value on the cart object, by long-standing design - this isn't a data migration or missing-field issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "discount-router", namespace: "checkout", labels: { app: "discount-router" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "discount-router-5h6i7j8k9-l0m1n", namespace: "checkout", labels: { app: "discount-router" } },
        status: { phase: "Running", containerStatuses: [{ name: "discount-router", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "discount-router": [
            "2026-09-15T10:30:02.114Z ERROR c.e.checkout.DiscountRouter - java.lang.NullPointerException",
            "    at app//com.example.checkout.DiscountRouter.route(DiscountRouter.java:6)",
          ],
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "discount-router-notes", namespace: "checkout" },
        spec: {
          data: {
            "DiscountRouter.java.excerpt":
              "public String route(DiscountCode code) {\n    return switch (code) {\n        case PercentOff p -> applyPercent(p);\n        case FlatAmount f -> applyFlat(f);\n        case FreeShipping fs -> applyFreeShipping(fs);\n        default -> \"no discount applied\";\n        // no explicit 'case null' - a plain switch expression over a\n        // reference type throws NullPointerException on a null selector\n        // before ever reaching pattern matching against any case, INCLUDING default\n    };\n}\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap discount-router-notes -n checkout -o yaml` - `route` is called with `code = null` for carts with no discount. Does this `switch` expression have an explicit `case null` anywhere?",
    "A `switch` on a reference type throws `NullPointerException` immediately if the selector expression itself is `null` - unless the switch explicitly includes a `case null` branch to handle it, `default` alone does NOT catch a null selector.",
    "This is different from older, non-pattern-matching `switch` statements over reference types, which have always thrown on a null selector too - but it's an easy detail to forget when writing a *new* pattern-matching switch that otherwise looks exhaustive.",
  ],
  options: [
    {
      id: "switch-throws-npe-on-null-selector-no-case-null",
      label:
        "`route`'s `switch` expression has no explicit `case null` branch - a `switch` on a reference type throws `NullPointerException` immediately when the selector itself is `null`, before ever attempting to match any case, including `default`; carts with no discount code pass `code = null` into `route` by design, and every one of them hits this NPE, while `default` (which only catches non-null values that don't match any listed pattern) is never reached at all for the null case.",
      explanation:
        "The stack trace shows `NullPointerException` thrown directly at the `switch` statement's own line, before execution reaches any case body. `DiscountRouter.java.excerpt` confirms the switch has cases for `PercentOff`, `FlatAmount`, `FreeShipping`, and a `default`, but no explicit `case null`. Java's `switch` (both classic and pattern-matching) throws `NullPointerException` immediately if the selector expression evaluates to `null`, as a deliberate design decision to make null-handling explicit rather than silently falling into `default` - `default` only ever matches non-null values that don't match any other listed pattern. Since carts with no discount code represent that state as a literal `null` by design, every single one of them triggers this NPE, which exactly matches why this case - previously the most common one - now fails while every cart carrying an actual, non-null discount code routes correctly.",
    },
    {
      id: "discountcode-sealed-interface-missing-implementation",
      label: "The `DiscountCode` sealed interface is missing a required implementation, causing incomplete pattern coverage.",
      explanation:
        "The `switch` has a `default` branch, so it's already exhaustive from the compiler's perspective regardless of how many implementations `DiscountCode` has - the failure isn't about missing pattern coverage for a non-null value, it's specifically about the selector expression itself being `null`, which no amount of case coverage over non-null patterns can catch without an explicit `case null`.",
    },
    {
      id: "cart-discount-field-never-initialized",
      label: "The cart's discount code field is never properly initialized for carts with no discount.",
      explanation:
        "The constraint confirms representing 'no discount' as a literal `null` is the correct, long-standing, intentional design - this isn't an initialization bug; the field is correctly and deliberately `null` for exactly the case that's failing.",
    },
    {
      id: "applypercent-method-throwing-on-edge-case",
      label: "`applyPercent(p)` throws an unhandled exception for some edge-case discount values.",
      explanation:
        "The stack trace shows the exception thrown directly at the `switch` statement's line, before entering any case body - execution never reaches `applyPercent` or any other case-handling method at all for the failing (null) input.",
    },
  ],
  correctOptionId: "switch-throws-npe-on-null-selector-no-case-null",
  resolution: `The stack trace points directly at the \`switch\` statement's own line -
the exception is thrown before execution ever enters any case body.
\`DiscountRouter.java.excerpt\` shows why: the switch expression has cases
for every known \`DiscountCode\` implementation plus a \`default\`, but no
explicit \`case null\`. Java's \`switch\` - both the classic statement form
and the newer pattern-matching expression form - throws
\`NullPointerException\` immediately if the selector expression evaluates
to \`null\`, deliberately, rather than silently treating a null selector as
falling through to \`default\`. This is easy to overlook when writing a
new pattern-matching switch that otherwise looks thoroughly exhaustive
across every type case - \`default\` covers "any non-null value that
doesn't match a listed pattern," not "any value at all, null included."
Carts with no discount code represent that state as a literal \`null\` by
long-standing design, so every single one of them - previously the most
common, most unremarkable case in the whole system - now throws before
the switch can even begin evaluating patterns.

The fix is adding an explicit \`case null\` branch:

\`\`\`java
public String route(DiscountCode code) {
    return switch (code) {
        case null -> "no discount applied";   // handles the null case explicitly
        case PercentOff p -> applyPercent(p);
        case FlatAmount f -> applyFlat(f);
        case FreeShipping fs -> applyFreeShipping(fs);
        default -> "no discount applied";   // still needed for exhaustiveness
                                              // if DiscountCode isn't sealed
    };
}
\`\`\`

(\`case null, default ->\` can also combine both into one branch when they
share identical handling.) The general rule: any \`switch\` over a
reference type that might legitimately receive \`null\` needs an explicit
\`case null\` - without it, a null selector always throws
\`NullPointerException\` immediately, regardless of how complete the
switch's other case coverage looks.`,
};
