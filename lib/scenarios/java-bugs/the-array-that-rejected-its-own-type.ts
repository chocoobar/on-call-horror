import type { Scenario } from "../types";

export const theArrayThatRejectedItsOwnType: Scenario = {
  id: "the-array-that-rejected-its-own-type",
  title: "The Array That Rejected Its Own Type",
  subtitle: "adding a gift-card line item to an order crashes with an exception nobody can explain from the stack trace alone",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "arrays", "generics"],
  briefing: `"order-export" builds a small array of line items for a legacy XML export
format used by one warehouse partner. It's worked for years, until a new
\`GiftCardLineItem\` subtype was introduced last sprint - orders containing
a gift card now throw a runtime exception during export, while every
other line item type exports fine.`,
  constraints: [
    "`GiftCardLineItem` is a valid subclass of `LineItem` and passes every unit test written for it in isolation - the export code itself is the focus here.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "order-export-28901505", namespace: "orders", labels: { app: "order-export" } },
        spec: { completions: 1 },
        status: { failed: 1 },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "order-export-28901505-q8r9s", namespace: "orders", labels: { app: "order-export" } },
        status: { phase: "Failed", containerStatuses: [{ name: "order-export", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "order-export": [
            "2026-09-15T12:20:04.114Z ERROR c.e.orders.LineItemExporter - java.lang.ArrayStoreException: com.example.orders.GiftCardLineItem",
            "    at app//com.example.orders.LineItemExporter.export(LineItemExporter.java:16)",
          ],
        },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "order-export-notes", namespace: "orders" },
        spec: {
          data: {
            "LineItemExporter.java.excerpt":
              "public void export(List<LineItem> lineItems) {\n    // legacy XML writer API requires a plain array, not a List\n    PhysicalLineItem[] physical = new PhysicalLineItem[lineItems.size()];\n    Object[] target = physical;   // upcast to Object[] - compiles fine,\n                                   // array covariance allows this\n    for (int i = 0; i < lineItems.size(); i++) {\n        target[i] = lineItems.get(i);   // runtime-checked, not compile-time-checked\n    }\n    xmlWriter.writeAll(physical);\n}\n",
          },
        },
        age: "40m",
      },
    ],
  },
  hints: [
    "`kubectl get configmap order-export-notes -n orders -o yaml` - the array is declared as `PhysicalLineItem[]` but assigned into it through an `Object[]`-typed reference. Does that array's actual runtime type ever change?",
    "Java arrays are covariant - a `PhysicalLineItem[]` can be assigned to an `Object[]` variable, and the compiler allows storing *any* `Object` into it through that reference - but the array itself still remembers its true, original component type at runtime.",
    "`ArrayStoreException` is thrown the moment something is stored into an array whose actual runtime component type can't hold it - regardless of what the reference variable used to do the storing is typed as.",
  ],
  options: [
    {
      id: "array-covariance-arraystoreexception",
      label:
        "`physical` is created as a `PhysicalLineItem[]`, and Java's array covariance allows assigning it to an `Object[]`-typed reference (`target`) without a cast - but the array's actual runtime component type stays `PhysicalLineItem[]` regardless, so storing a `GiftCardLineItem` (which isn't a `PhysicalLineItem`) into it through `target[i] = ...` compiles fine but throws `ArrayStoreException` at runtime, while every genuinely-`PhysicalLineItem` line item stores without issue.",
      explanation:
        "The stack trace shows `ArrayStoreException: com.example.orders.GiftCardLineItem`, thrown from inside `export` at the assignment line. `LineItemExporter.java.excerpt` creates `physical` as `PhysicalLineItem[]`, then upcasts the reference to `Object[]` (`target`) - legal because Java arrays are covariant - and writes into it through that wider reference. The compiler can't statically verify each stored element's type through an `Object[]` reference, so the JVM checks at runtime instead, and throws `ArrayStoreException` the instant something incompatible with the array's *true* component type (`PhysicalLineItem`, not `Object`) is stored - which is exactly what a `GiftCardLineItem` (presumably not a `PhysicalLineItem` subtype) triggers, while other `PhysicalLineItem` subtypes store without any issue.",
    },
    {
      id: "gift-card-line-item-missing-fields",
      label: "`GiftCardLineItem` is missing required fields that the XML writer expects.",
      explanation:
        "The exception is `ArrayStoreException`, thrown at the array assignment itself, before the XML writer is ever invoked - this is a type-compatibility failure at the point of storing into the array, not a missing-data failure inside the XML serialization logic.",
    },
    {
      id: "xml-writer-doesnt-support-new-type",
      label: "The legacy XML writer library doesn't have a defined schema element for gift card line items.",
      explanation:
        "`xmlWriter.writeAll(physical)` is never reached - the stack trace's line number points inside the loop building the array, before the XML writer is ever called, so whatever the writer does or doesn't support isn't relevant to this specific failure.",
    },
    {
      id: "lineitems-list-concurrently-modified",
      label: "The `lineItems` list is being concurrently modified during export.",
      explanation:
        "`ArrayStoreException` is a very specific, well-documented exception about storing an incompatible type into an array with a narrower runtime component type - it isn't the exception Java throws for concurrent list modification (that would be `ConcurrentModificationException`), and nothing here suggests concurrent access.",
    },
  ],
  correctOptionId: "array-covariance-arraystoreexception",
  resolution: `The stack trace names the exact exception and offending type:
\`ArrayStoreException: com.example.orders.GiftCardLineItem\`, thrown right
where \`LineItemExporter.export\` stores into the array.
\`LineItemExporter.java.excerpt\` creates \`physical\` with the concrete type
\`PhysicalLineItem[]\`, then assigns it to an \`Object[]\`-typed variable
(\`target\`) - legal in Java because arrays are *covariant*: any
\`SubType[]\` can be assigned where a \`SuperType[]\` is expected. That
covariance is a compile-time convenience only; the array object itself
never forgets its true, original component type (\`PhysicalLineItem\`).
Writing into it through the wider \`target\` reference bypasses the
compiler's ability to check each element's type at compile time, so the
JVM checks at the moment of each store instead - and throws
\`ArrayStoreException\` the instant an object incompatible with the array's
*actual* runtime component type is stored into it, no matter what type
the reference used to write it was declared as. A \`GiftCardLineItem\`
that isn't itself a \`PhysicalLineItem\` triggers exactly this, while every
genuine \`PhysicalLineItem\` (or subtype of it) stores in without issue.

The fix is avoiding the covariant array/store pattern entirely - build
the array with its actual, correct component type used consistently, or
validate/cast explicitly before storing:

\`\`\`java
public void export(List<LineItem> lineItems) {
    List<PhysicalLineItem> physicalOnly = lineItems.stream()
        .filter(PhysicalLineItem.class::isInstance)
        .map(PhysicalLineItem.class::cast)
        .toList();
    xmlWriter.writeAll(physicalOnly.toArray(new PhysicalLineItem[0]));
}
\`\`\`

The general rule: array covariance lets the compiler accept code that can
still fail at runtime - any time an array is stored into through a
reference typed more broadly than the array's actual creation type,
that's an \`ArrayStoreException\` waiting to happen the moment an
incompatible element shows up. Generic collections don't have this
problem, which is one reason they're generally preferred over raw arrays
for heterogeneous or evolving type hierarchies.`,
};
