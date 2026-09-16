import type { Scenario } from "./types";

export const theCastThatWorkedUntilItDidnt: Scenario = {
  id: "the-cast-that-worked-until-it-didnt",
  title: "The Cast That Worked Until It Didn't",
  subtitle: "the pricing rules engine crashes with a ClassCastException only when two specific promotions are combined",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "generics", "type-erasure"],
  briefing: `"pricing-rules-engine" stores rule parameters in a shared, loosely-typed
\`Map<String, List>\` that different rule handlers read from with their own
assumed element type. Combining a "buy one get one" promotion with a
"spend threshold" promotion in the same cart throws a
ClassCastException deep inside rule evaluation, crashing checkout for
that cart.`,
  constraints: [
    "Each individual promotion, applied on its own, is confirmed to work correctly - the failure only happens when both specific rule handlers read from the same shared parameter map in the same request.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-rules-engine", namespace: "pricing", labels: { app: "pricing-rules-engine" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-rules-engine-6y7z8a9b0-c1d2e", namespace: "pricing", labels: { app: "pricing-rules-engine" } },
        status: { phase: "Running", containerStatuses: [{ name: "pricing-rules-engine", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pricing-rules-engine": [
            "2026-09-15T12:11:04.114Z ERROR c.e.pricing.SpendThresholdRule - java.lang.ClassCastException: class java.lang.String cannot be cast to class java.math.BigDecimal",
            "    at app//com.example.pricing.SpendThresholdRule.evaluate(SpendThresholdRule.java:9)",
          ],
        },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pricing-rules-notes", namespace: "pricing" },
        spec: {
          data: {
            "RuleContext.java.excerpt":
              "// shared, raw-typed parameter storage used across all rule handlers\nprivate final Map<String, List> sharedParams = new HashMap<>();\n\n// BogoRule.java writes SKU strings into 'thresholdList' by mistake -\n// both rules were written independently and happen to reuse the same key name\nsharedParams.put(\"thresholdList\", List.of(\"SKU-771\", \"SKU-882\"));\n\n// SpendThresholdRule.java.excerpt:\npublic boolean evaluate(RuleContext ctx) {\n    List<BigDecimal> thresholds = ctx.get(\"thresholdList\");   // raw List,\n        // unchecked cast happens implicitly here via generics erasure\n    BigDecimal min = thresholds.get(0);   // ClassCastException here at\n        // runtime - the list actually contains Strings\n    return ctx.cartTotal().compareTo(min) >= 0;\n}\n",
          },
        },
        age: "9mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap pricing-rules-notes -n pricing -o yaml` - two different rule handlers both use the key `\"thresholdList\"` on the same shared, raw-typed `Map<String, List>`. Do they agree on what's inside that list?",
    "Generics are erased at runtime - a raw `List` retrieved from a `Map<String, List>` and assigned to a `List<BigDecimal>` variable compiles with only an unchecked-cast warning, and throws `ClassCastException` only later, the moment something actually tries to use an element as a `BigDecimal`.",
    "The cast doesn't fail at the point of assignment (`List<BigDecimal> thresholds = ...`) - it fails at the first place an element is actually read out and treated as the wrong type. Trace where that first happens.",
  ],
  options: [
    {
      id: "raw-type-shared-map-erasure-classcastexception",
      label:
        "`sharedParams` is a raw-typed `Map<String, List>` used by multiple independently-written rule handlers that happen to reuse the same key name (`\"thresholdList\"`) for two different purposes - `BogoRule` stores a `List` of SKU strings under that key, and because Java generics are erased at runtime, `SpendThresholdRule` can assign that same raw `List` to a `List<BigDecimal>` variable with only a compile-time unchecked-cast warning; the actual `ClassCastException` only fires later, the moment code tries to use an element of that list as a `BigDecimal`, which is exactly what happens when both rules combine in the same request.",
      explanation:
        "The stack trace shows `ClassCastException: class java.lang.String cannot be cast to class java.math.BigDecimal`, thrown from inside `SpendThresholdRule.evaluate` at the line reading `thresholds.get(0)`. `RuleContext.java.excerpt` shows the shared, raw-typed `sharedParams` map has `\"thresholdList\"` written by `BogoRule` as a list of SKU strings, and separately read by `SpendThresholdRule` as if it were a `List<BigDecimal>` - two unrelated rules coincidentally reusing the same map key with completely different intended contents. Because generics are erased at runtime, the compiler can't catch this key collision or the mismatched element type at the assignment; it only manifests as a runtime `ClassCastException` the moment an element is actually pulled out and used as the wrong type - which only happens when both rules are active on the same cart, writing and then reading the same shared key.",
    },
    {
      id: "spendthresholdrule-configured-with-wrong-key",
      label: "`SpendThresholdRule` is simply configured to read from the wrong key name entirely.",
      explanation:
        "The key name itself (`\"thresholdList\"`) is being read consistently and deliberately by `SpendThresholdRule` - the actual problem is that an unrelated rule (`BogoRule`) happens to write completely different data under that exact same key on the same shared map, not that `SpendThresholdRule` is reading the wrong key by mistake.",
    },
    {
      id: "bigdecimal-parsing-locale-issue",
      label: "A locale-dependent `BigDecimal` parsing step is failing on the threshold value.",
      explanation:
        "There's no parsing step involved at all here - the exception is a direct `ClassCastException` from an unchecked generic cast failing, not a `NumberFormatException` from string-to-number parsing, which would look completely different in the stack trace.",
    },
    {
      id: "bogorule-and-spendthresholdrule-race-condition",
      label: "`BogoRule` and `SpendThresholdRule` are executing concurrently and racing to write the shared map.",
      explanation:
        "The failure is fully deterministic and reproducible any time both rules are active on the same cart, with no dependency on execution timing or ordering - it's a straightforward key-collision-plus-erased-generics bug, not a race condition between concurrently executing rule handlers.",
    },
  ],
  correctOptionId: "raw-type-shared-map-erasure-classcastexception",
  resolution: `The stack trace names the exact failure:
\`ClassCastException: class java.lang.String cannot be cast to class
java.math.BigDecimal\`, thrown from \`SpendThresholdRule.evaluate\` at the
line reading the first element out of a list. \`RuleContext.java.excerpt\`
reveals the root cause: \`sharedParams\` is a raw-typed
\`Map<String, List>\`, and two independently-written rule handlers happen
to reuse the exact same key, \`"thresholdList"\`, for two completely
different purposes - \`BogoRule\` stores SKU strings under it, while
\`SpendThresholdRule\` reads it back assuming it's a \`List<BigDecimal>\`.
Because Java implements generics via type erasure, a raw \`List\`
retrieved from this map and assigned to a \`List<BigDecimal>\`-typed
variable compiles with nothing worse than an unchecked-cast warning -
the compiler has no runtime information left to verify the list's actual
element type at that point. The mismatch only becomes a real,
crash-causing problem the moment code actually reads an element out and
tries to use it as a \`BigDecimal\`, which only happens when both rules
are active in the same request, writing and then reading that same
colliding key.

The fix is eliminating the shared, loosely-typed, string-keyed map in
favor of type-safe, rule-specific parameter storage:

\`\`\`java
// each rule gets its own strongly-typed parameter slot, no key collisions possible
record BogoParams(List<String> eligibleSkus) {}
record SpendThresholdParams(BigDecimal minimum) {}

public boolean evaluate(SpendThresholdParams params, RuleContext ctx) {
    return ctx.cartTotal().compareTo(params.minimum()) >= 0;
}
\`\`\`

The general rule: a shared, raw-typed (or loosely \`Object\`/wildcard-typed)
collection used as a grab-bag by multiple independent pieces of code is
a \`ClassCastException\` waiting to happen - generics erasure means the
compiler can't protect against key or type collisions in that pattern,
and it only surfaces at runtime, exactly when two unrelated features
happen to collide.`,
};
