import type { Scenario } from "../types";

export const theWildcardThatGotTooClever: Scenario = {
  id: "the-wildcard-that-got-too-clever",
  title: "The Wildcard That Got Too Clever",
  subtitle: "a warehouse restocking batch job inserts pallets of the wrong product category into the wrong bin group",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "generics", "raw-types"],
  briefing: `A generic \`BinGroup<T extends Item>\` class enforces (at compile time) that
only one item subtype can be added to a given bin group. A recent
integration with a legacy restocking system bypasses that safety
entirely - electronics pallets have started appearing in produce bin
groups, a serious cross-contamination and safety issue for the
warehouse's cold-storage compliance.`,
  constraints: [
    "`BinGroup<T>`'s own `add(T item)` method, and its compile-time type parameter enforcement, are confirmed correct and unchanged - the integration code is the focus here.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "legacy-restock-bridge-28901760", namespace: "warehouse", labels: { app: "legacy-restock-bridge" } },
        spec: { completions: 1 },
        status: { succeeded: 1 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "legacy-restock-bridge-28901760-r3s4t", namespace: "warehouse", labels: { app: "legacy-restock-bridge" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "legacy-restock-bridge", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "legacy-restock-bridge": [
            "2026-09-15T05:10:02.114Z WARN  c.e.warehouse.LegacyRestockBridge - added ElectronicsItem(sku=TV-4471) to produceBinGroup (BinGroup<ProduceItem>)",
            "2026-09-15T05:10:02.116Z INFO  c.e.warehouse.LegacyRestockBridge - restock batch applied, no errors",
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "legacy-restock-bridge-notes", namespace: "warehouse" },
        spec: {
          data: {
            "LegacyRestockBridge.java.excerpt":
              "public class BinGroup<T extends Item> {\n    private List<T> items = new ArrayList<>();\n    public void add(T item) { items.add(item); }\n}\n\n// LegacyRestockBridge.java - integrates with an old system that only\n// knows about raw types, no generics at all:\npublic void applyLegacyBatch(BinGroup rawGroup, List rawItems) {\n    // both parameters declared as RAW types (no <T>) to interoperate\n    // with the legacy system's non-generic API surface\n    for (Object item : rawItems) {\n        rawGroup.add(item);   // compiles with only an unchecked warning -\n            // raw types bypass ALL generic type checking entirely\n    }\n}\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get configmap legacy-restock-bridge-notes -n warehouse -o yaml` - `applyLegacyBatch` declares both `BinGroup` and `List` as raw types, with no type parameter at all. What does using a raw type do to generic type checking for that variable?",
    "Using a class's raw type (the name with no `<...>` at all, not even `<?>`) suppresses generic type checking entirely for every operation performed through that reference - it's not the same as a wildcard like `BinGroup<?>`, which still enforces read-side safety.",
    "`rawGroup.add(item)` compiles with only an unchecked-cast warning, not an error, precisely because `rawGroup`'s raw type erases the compiler's ability to verify `item`'s type against whatever `T` the actual underlying `BinGroup` was created with.",
  ],
  options: [
    {
      id: "raw-type-bypasses-generic-safety-entirely",
      label:
        "`applyLegacyBatch` declares both parameters as raw types (`BinGroup`, `List`, with no `<...>` at all) to interoperate with the legacy system's non-generic API - using a raw type suppresses generic type checking entirely for every operation performed through that reference, so `rawGroup.add(item)` compiles with only an unchecked warning regardless of `item`'s actual type, completely bypassing the compile-time type safety `BinGroup<T extends Item>` was specifically designed to enforce, letting any item type (including `ElectronicsItem`) be added to any bin group (including one actually typed `BinGroup<ProduceItem>`).",
      explanation:
        "The warning log shows exactly the unsafe outcome: an `ElectronicsItem` added to `produceBinGroup`, a `BinGroup<ProduceItem>`, with the job reporting 'no errors' - the addition genuinely succeeded at runtime. `LegacyRestockBridge.java.excerpt` shows `applyLegacyBatch` declares its `BinGroup` and `List` parameters as raw types specifically to interoperate with the legacy system's non-generic API. Raw types don't behave like a wildcard (`BinGroup<?>`, which still enforces PECS-style read/write safety) - they suppress the compiler's generic type checking entirely for that reference, treating every generic method as if it operated on raw `Object`. `rawGroup.add(item)` compiles with nothing worse than an unchecked warning, and at runtime genuinely adds whatever object is passed in, with no type enforcement left to stop an `ElectronicsItem` from landing in a produce-only bin group.",
    },
    {
      id: "electronicsitem-mismapped-to-produceitem",
      label: "The legacy system's own data mapping incorrectly labels `ElectronicsItem` records as produce category.",
      explanation:
        "The log shows the item correctly identified and logged as `ElectronicsItem(sku=TV-4471)` throughout - it's never mislabeled as produce anywhere; it's added to the produce bin group directly and correctly identified as electronics the whole time, which is exactly the problem.",
    },
    {
      id: "bingroup-add-method-missing-type-check",
      label: "`BinGroup.add(T item)` itself is missing a runtime type check before adding an item.",
      explanation:
        "`BinGroup<T>.add(T item)`'s compile-time type parameter enforcement is confirmed correct and unchanged - it's designed to rely on the compiler catching type mismatches at the call site (which it can no longer do once the caller uses a raw type), not on an additional runtime check inside `add` itself.",
    },
    {
      id: "restock-batch-job-processing-wrong-file",
      label: "The restocking batch job is reading from the wrong input file, mixing categories.",
      explanation:
        "The log shows a single, specific electronics item being deliberately routed into a produce bin group by the integration code itself - this isn't a case of an entire wrong file being processed, it's individual items losing their type-safety enforcement through the raw-typed bridge code.",
    },
  ],
  correctOptionId: "raw-type-bypasses-generic-safety-entirely",
  resolution: `The warning log shows the unsafe outcome directly: an \`ElectronicsItem\`
added to \`produceBinGroup\`, a \`BinGroup<ProduceItem>\`, reported as a
completely error-free operation. \`LegacyRestockBridge.java.excerpt\`
shows why nothing stopped it: \`applyLegacyBatch\` declares its
\`BinGroup\` and \`List\` parameters using *raw types* - the bare class name
with no type argument at all, not even a wildcard - specifically to
interoperate with a legacy system's non-generic API surface. This is a
meaningfully different, and much less safe, choice than using a wildcard
like \`BinGroup<?>\`, which still enforces read-side type safety (you
can't add an arbitrary object to a \`BinGroup<?>\`, only read from it as
\`Item\`). A raw type suppresses the compiler's generic type checking
entirely for every operation performed through that reference - it's
effectively treated as pre-generics, unchecked \`Object\`-based Java.
\`rawGroup.add(item)\` compiles with nothing worse than an "unchecked call"
warning, easy to overlook or suppress, and at runtime genuinely performs
the add with no type enforcement left to catch the mismatch.

The fix is preserving type safety at the integration boundary instead of
using raw types - validating and casting explicitly, one bin group at a
time, rather than accepting an untyped batch across arbitrary bin
groups:

\`\`\`java
public <T extends Item> void applyLegacyBatch(BinGroup<T> group, Class<T> itemType, List<?> rawItems) {
    for (Object item : rawItems) {
        if (!itemType.isInstance(item)) {
            throw new IllegalArgumentException("wrong item type for this bin group: " + item);
        }
        group.add(itemType.cast(item));   // checked, safe cast
    }
}
\`\`\`

The general rule: a raw type isn't a lightweight equivalent to a
wildcard - it disables generic type checking entirely for every
operation on that reference, silently reintroducing exactly the kind of
type-confusion bug generics exist to prevent at compile time. Reach for
a wildcard (\`<?>\`) or a properly parameterized method instead of a raw
type whenever interoperating with legacy, non-generic code.`,
};
