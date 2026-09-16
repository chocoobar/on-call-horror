import type { Scenario } from "../types";

export const theRecordThatNeverEqualedItself: Scenario = {
  id: "the-record-that-never-equaled-itself",
  title: "The Record That Never Equaled Itself",
  subtitle: "the duplicate-shipment detector never catches a single duplicate, no matter how obviously identical two shipments are",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "records", "equals-hashcode"],
  briefing: `"shipment-dedup" is supposed to flag when the exact same shipment
manifest (same items, same destination) gets submitted twice in a row,
a known symptom of a flaky retry in the label printer integration.
Since switching the manifest model to a Java \`record\` for cleaner code,
the dedup check has never once fired, even on manifests confirmed
byte-for-byte identical.`,
  constraints: [
    "The two manifests in the reported incident are confirmed to contain the exact same items in the exact same order and the exact same destination - a genuine duplicate submission.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipment-dedup", namespace: "shipping", labels: { app: "shipment-dedup" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipment-dedup-8a9b0c1d2-e3f4g", namespace: "shipping", labels: { app: "shipment-dedup" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipment-dedup", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipment-dedup": [
            "2026-09-15T10:22:01.114Z DEBUG c.e.shipping.DedupCheck - manifest1.equals(manifest2)=false (items confirmed identical by manual diff)",
            "2026-09-15T10:22:01.116Z INFO  c.e.shipping.DedupCheck - not a duplicate, both shipments allowed",
          ],
        },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipment-manifest-notes", namespace: "shipping" },
        spec: {
          data: {
            "ShipmentManifest.java.excerpt":
              "public record ShipmentManifest(String[] itemSkus, String destination) {\n    // auto-generated equals()/hashCode() cover every component - but\n    // itemSkus is an array, not a List\n}\n\n// DedupCheck.java:\nif (manifest1.equals(manifest2)) {\n    reject(\"duplicate shipment\");\n}\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap shipment-manifest-notes -n shipping -o yaml` - `ShipmentManifest` is a `record` with an array-typed component (`String[]`). What does a record's auto-generated `equals()` actually do for an array field?",
    "A Java `record`'s generated `equals()` compares each component using that component's own `equals()` method - and arrays don't override `Object.equals()`, so array components are still compared by reference identity, not by content.",
    "Two `String[]` arrays holding the exact same SKU strings, in the exact same order, but built as two separate array objects, are never `.equals()` to each other - even though `Arrays.equals(...)` (a completely different method) would say they match.",
  ],
  options: [
    {
      id: "record-array-component-reference-equality",
      label:
        "`ShipmentManifest` is a `record` with an array-typed component (`String[] itemSkus`) - a record's auto-generated `equals()` compares each component using that component's own `equals()` method, and arrays never override `Object.equals()`, so two array components are compared by reference identity, not by content; two manifests built from two separate (even if content-identical) `String[]` arrays are never `.equals()` to each other no matter how completely their actual item lists match.",
      explanation:
        "The debug log confirms `manifest1.equals(manifest2)` returns `false` even though a manual diff confirms the items are genuinely identical. `ShipmentManifest.java.excerpt` declares `itemSkus` as `String[]` - an array type. A record's generated `equals()` delegates to each component's own `equals()` method for comparison, and `Object.equals()` (the only `equals()` an array ever has, since arrays don't override it) is reference-based - two distinct array objects are never equal via `.equals()` regardless of their contents. Since the two duplicate manifests were deserialized/constructed as two separate `String[]` instances (even with identical content), the record's `equals()` always reports them unequal, silently defeating the entire dedup check.",
    },
    {
      id: "hashcode-not-generated-for-records",
      label: "Java `record`s don't generate a `hashCode()` implementation automatically, causing the comparison to fail.",
      explanation:
        "Records do generate both `equals()` and `hashCode()` automatically for every declared component - the failure here is `equals()` itself returning `false` for genuinely-equal manifests, specifically because of how it handles the array-typed component, not because `hashCode()` is missing entirely.",
    },
    {
      id: "manifest-destination-field-mismatch",
      label: "The `destination` field differs slightly between the two manifests (e.g. trailing whitespace).",
      explanation:
        "The constraint confirms the destination is genuinely identical between the two manifests, and `String`'s own `equals()` (used correctly for that component) would correctly detect any real difference - the failure is isolated to the array-typed `itemSkus` component, not `destination`.",
    },
    {
      id: "dedup-check-comparing-wrong-manifest-objects",
      label: "`DedupCheck` is comparing the wrong pair of manifest objects entirely.",
      explanation:
        "The debug log confirms both manifests are correctly retrieved and compared (with their items independently confirmed identical by manual diff) - the correct objects are being compared; it's the record's own generated `equals()` behavior on an array component that produces the wrong result.",
    },
  ],
  correctOptionId: "record-array-component-reference-equality",
  resolution: `The debug log shows exactly the surprising result: \`manifest1.equals(manifest2)\`
returns \`false\` even though a manual diff independently confirms the two
manifests' items are genuinely identical. \`ShipmentManifest.java.excerpt\`
declares \`itemSkus\` as \`String[]\` - a plain array. A Java \`record\`'s
compiler-generated \`equals()\` is implemented by calling each component's
own \`equals()\` method and combining the results - it's convenient and
correct for ordinary types, but arrays are a well-known exception: they
never override \`Object.equals()\`, so an array's "own" \`equals()\` is
still simple reference identity, completely blind to the array's actual
contents. Two \`ShipmentManifest\` records built from two separate
\`String[]\` array objects - even ones holding the exact same SKU strings
in the exact same order - are therefore never \`.equals()\` to each other,
no matter how perfectly their real content matches. The dedup check,
which relies entirely on this generated \`equals()\`, silently and
permanently fails to catch any duplicate at all.

The fix is using a content-comparable collection type instead of an
array for any record component that needs value-based equality:

\`\`\`java
public record ShipmentManifest(List<String> itemSkus, String destination) {
    // List's equals() compares elements by content, recursively -
    // the record's generated equals() now works correctly
}
\`\`\`

If an array genuinely must be kept (for interop with an array-based API,
for example), overriding \`equals()\`/\`hashCode()\` explicitly with
\`Arrays.equals(...)\`/\`Arrays.hashCode(...)\` is the alternative. The
general rule: never use a raw array as a \`record\` (or any value-equality
class's) component when structural equality matters - arrays compare by
reference regardless of the surrounding class's own generated or
intended equality semantics; use \`List\` or another properly
content-comparable collection instead.`,
};
