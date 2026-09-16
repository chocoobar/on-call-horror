import type { Scenario } from "./types";

export const theTostringThatNeverStopped: Scenario = {
  id: "the-tostring-that-never-stopped",
  title: "The toString That Never Stopped",
  subtitle: "logging a single failed order occasionally hangs the whole request thread until it crashes with a stack overflow",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "recursion", "stackoverflow"],
  briefing: `A recently added "related orders" feature links an order back to the
order that triggered its automatic replacement, for warranty tracking.
Since then, a small number of order-processing failures - always
involving a replacement order - crash with a StackOverflowError the
instant the failure handler tries to log the order object for
debugging.`,
  constraints: [
    "The replacement-order linking data itself is confirmed correct and intentional - a replacement order legitimately references its original order, by design.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "order-processor", namespace: "orders", labels: { app: "order-processor" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "order-processor-6i7j8k9l0-m1n2o", namespace: "orders", labels: { app: "order-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "order-processor", ready: true, restartCount: 1, state: { running: {} } }] },
        logs: {
          "order-processor": [
            "2026-09-15T15:20:02.114Z ERROR c.e.orders.FailureHandler - java.lang.StackOverflowError",
            "    at java.base/java.lang.StringBuilder.append(StringBuilder.java:172)",
            "    at app//com.example.orders.Order.toString(Order.java:14)",
            "    at app//com.example.orders.Order.toString(Order.java:14)",
            "    at app//com.example.orders.Order.toString(Order.java:14)",
            "    ... (repeats thousands of times)",
          ],
        },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "order-processor-notes", namespace: "orders" },
        spec: {
          data: {
            "Order.java.excerpt":
              "public class Order {\n    private String id;\n    private Order replacementFor;   // the original order this one replaced,\n                                      // null for a normal, non-replacement order\n\n    @Override\n    public String toString() {\n        return \"Order{id=\" + id + \", replacementFor=\" + replacementFor + \"}\";\n        // string concatenation with `replacementFor` implicitly calls ITS\n        // own toString() too\n    }\n}\n\n// order-fulfillment.java: for warranty tracking edge cases, a\n// replacement order and its original can end up pointing at each other:\noriginalOrder.setReplacementFor(replacementOrder);\nreplacementOrder.setReplacementFor(originalOrder);   // creates a cycle\n",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`kubectl logs order-processor-6i7j8k9l0-m1n2o -n orders` - the stack trace is the same line, `Order.toString(Order.java:14)`, repeated thousands of times. What does that line actually do?",
    "`kubectl get configmap order-processor-notes -n orders -o yaml` - `toString()` concatenates `replacementFor` directly into the string, which implicitly calls `replacementFor.toString()` too. What happens if `replacementFor` points back to an order whose own `replacementFor` points back to the first one?",
    "The fulfillment code comment shows a specific edge case where an original order and its replacement can end up referencing each other - a genuine two-node cycle in the `replacementFor` chain, not just a long one-way chain.",
  ],
  options: [
    {
      id: "circular-reference-infinite-tostring-recursion",
      label:
        "`Order.toString()` concatenates `replacementFor` directly, which implicitly calls `replacementFor`'s own `toString()` - for the edge case where an original order and its replacement end up referencing each other (`originalOrder.replacementFor = replacementOrder` and `replacementOrder.replacementFor = originalOrder`), calling `toString()` on either one recurses into the other's `toString()`, which recurses back into the first's, forever, with no base case to stop it, until the call stack is exhausted and `StackOverflowError` is thrown.",
      explanation:
        "The stack trace shows the exact same line, `Order.toString(Order.java:14)`, repeated thousands of times - the unmistakable signature of unbounded recursion. `Order.java.excerpt` shows `toString()` concatenates `replacementFor` directly into the result string, which implicitly invokes `replacementFor.toString()` too (Java calls `toString()` on any object involved in string concatenation). The same excerpt's fulfillment comment confirms a specific edge case creates a genuine two-node cycle: an original order's `replacementFor` points to its replacement, and that replacement's `replacementFor` points right back to the original. Calling `toString()` on either order in that cycle recurses into the other's `toString()`, which recurses back, indefinitely, with no cycle-detection or depth limit anywhere - exactly matching both the repeating stack trace and the fact that this only affects orders involved in a replacement relationship.",
    },
    {
      id: "logging-framework-buffer-overflow",
      label: "The logging framework's internal buffer is overflowing when handling a large order object graph.",
      explanation:
        "`StackOverflowError` is a JVM error about the call stack's depth limit being exceeded due to recursive method calls - not a buffer-capacity issue, which would produce a completely different kind of error (or simply truncated output), and the repeating identical stack frames point specifically at recursive execution of one method.",
    },
    {
      id: "order-id-field-null-causing-npe-loop",
      label: "A null `id` field is causing an internal retry loop in the failure handler.",
      explanation:
        "The stack trace shows a clean, consistent `StackOverflowError` from repeated `toString()` calls, not a `NullPointerException` or any retry-related exception - and string concatenation with a null `id` would simply print the text `\"null\"`, not cause any looping behavior at all.",
    },
    {
      id: "failure-handler-calling-tostring-in-a-loop",
      label: "`FailureHandler`'s own code explicitly calls `toString()` in a retry loop.",
      explanation:
        "The repeated stack frames are all inside `Order.toString()` calling itself, not inside `FailureHandler` calling `Order.toString()` repeatedly from an external loop - the recursion is happening entirely within the object's own `toString()` implementation, one call implicitly triggering the next.",
    },
  ],
  correctOptionId: "circular-reference-infinite-tostring-recursion",
  resolution: `The stack trace's shape is the giveaway: the exact same line,
\`Order.toString(Order.java:14)\`, repeated thousands of times in a row -
classic unbounded recursion, not a one-off deep call chain.
\`Order.java.excerpt\` shows \`toString()\` builds its result via string
concatenation that includes \`replacementFor\` directly - and string
concatenation in Java implicitly calls \`.toString()\` on any non-\`String\`
operand, meaning \`Order.toString()\` calls \`replacementFor.toString()\`
(itself an \`Order\`) as part of building its own result. The same
configmap's fulfillment code comment reveals the actual trigger: a
specific warranty-tracking edge case creates a genuine cycle - an
original order's \`replacementFor\` points to its replacement order, and
that replacement's own \`replacementFor\` points right back to the
original. Calling \`toString()\` on either order in that cycle recurses
into the other's \`toString()\`, which recurses back into the first's,
forever - there's no cycle detection, no depth limit, and no base case
anywhere in the method to ever stop it, so the call stack grows without
bound until the JVM throws \`StackOverflowError\`.

The fix is breaking the recursion, either by not directly embedding the
full nested object in \`toString()\`, or by tracking visited objects:

\`\`\`java
@Override
public String toString() {
    String refId = (replacementFor != null) ? replacementFor.id : "none";
    return "Order{id=" + id + ", replacementForId=" + refId + "}";
    // references the related order by ID only - no recursive toString() call
}
\`\`\`

The general rule: any \`toString()\` (or \`equals()\`/\`hashCode()\`) that
embeds another object of a type capable of referencing back to the
original - directly or through a longer chain - risks infinite recursion
the moment a cycle exists in the data, even if cycles are a rare edge
case; reference related objects by a simple identifier rather than
recursively including their own full representation, or explicitly
guard against revisiting an object already being formatted.`,
};
