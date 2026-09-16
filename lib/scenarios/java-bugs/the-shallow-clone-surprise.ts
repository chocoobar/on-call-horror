import type { Scenario } from "../types";

export const theShallowCloneSurprise: Scenario = {
  id: "the-shallow-clone-surprise",
  title: "The Shallow Clone Surprise",
  subtitle: "editing a draft invoice sometimes silently changes numbers on the already-sent original",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "clone", "mutability"],
  briefing: `Finance uses a "duplicate as draft" feature to start a new invoice from a
previously sent one. A few customers have received corrected invoices
where the *original, already-sent* invoice's line item quantities
changed too - after the draft copy was edited, not before.`,
  constraints: [
    "The invoice's `LineItem` objects are confirmed to be the only part of the invoice affected - top-level invoice fields like customer and date copy correctly.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-service", namespace: "billing", labels: { app: "invoice-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-service-0h1i2j3k4-l5m6n", namespace: "billing", labels: { app: "invoice-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoice-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoice-service": [
            "2026-09-15T10:44:02.114Z INFO  c.e.billing.InvoiceCloner - duplicated invoice inv-4402 as draft inv-4487",
            "2026-09-15T10:47:19.302Z INFO  c.e.billing.DraftEditor - updated line item qty on inv-4487 item=li-1 qty=8",
            "2026-09-15T10:47:19.310Z WARN  c.e.billing.InvoiceAudit - line item qty changed on SENT invoice inv-4402 item=li-1 qty=8",
          ],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-cloner-notes", namespace: "billing" },
        spec: {
          data: {
            "Invoice.java.excerpt":
              "public class Invoice implements Cloneable {\n    private List<LineItem> lineItems;   // list of mutable LineItem objects\n\n    @Override\n    public Invoice clone() {\n        try {\n            Invoice copy = (Invoice) super.clone();\n            // Object.clone() performs a shallow copy: the `lineItems`\n            // field reference itself is copied, but the List object it\n            // points to - and every LineItem inside it - is shared, not duplicated\n            return copy;\n        } catch (CloneNotSupportedException e) {\n            throw new AssertionError(e);\n        }\n    }\n}\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl logs invoice-service-0h1i2j3k4-l5m6n -n billing` - editing the draft's line item somehow also changed the *sent* invoice's line item. Same object, or two separate objects with the same values?",
    "`kubectl get configmap invoice-cloner-notes -n billing -o yaml` - what exactly does `Object.clone()` (via `super.clone()`) copy for a field that's itself a reference to a mutable object, like a `List`?",
    "A shallow copy duplicates the *field* (the reference/pointer), not the object that field points to - two invoices can end up holding a reference to the very same `List` (and the very same `LineItem` objects) after `clone()`.",
  ],
  options: [
    {
      id: "shallow-clone-shares-mutable-lineitems",
      label:
        "`Invoice.clone()` relies on `super.clone()`, which performs a shallow copy - the `lineItems` field is copied as a reference, not deep-copied, so the draft and the original invoice end up pointing at the exact same `List<LineItem>` (and the same `LineItem` objects inside it); editing a line item's quantity on the draft mutates an object both invoices share, which is why the change is also visible on the already-sent original.",
      explanation:
        "`Invoice.java.excerpt`'s own comment confirms `super.clone()` performs a shallow copy: the `lineItems` field reference is duplicated, but the `List` object (and every `LineItem` inside it) it points to is shared between the original and the clone, not duplicated. The audit log shows editing `li-1`'s quantity on the draft (`inv-4487`) immediately triggers a warning about the same change appearing on the sent original (`inv-4402`) - exactly the signature of two `Invoice` objects unknowingly sharing one underlying mutable `LineItem` list.",
    },
    {
      id: "database-update-query-missing-where-clause",
      label: "The database UPDATE query for saving draft edits is missing a WHERE clause scoping it to the draft only.",
      explanation:
        "The warning is logged by in-memory `InvoiceAudit` immediately after the in-application edit, before any database write is described - this points at two Java objects sharing mutable state in memory, not at a database query updating rows beyond its intended scope.",
    },
    {
      id: "invoice-ids-colliding",
      label: "`inv-4402` and `inv-4487` are somehow resolving to the same invoice ID internally.",
      explanation:
        "The logs clearly show two distinct invoice IDs throughout, correctly distinguished at the top level (the original and the duplicate) - it's specifically the shared nested `LineItem` objects, not the invoices' own identity, that are causing the crossed change.",
    },
    {
      id: "cache-not-invalidated-between-invoices",
      label: "A shared cache layer isn't invalidating the sent invoice's cached copy after the draft is edited.",
      explanation:
        "The comment in `Invoice.java.excerpt` and the timing of the audit warning (firing immediately, in-process, right after the edit) point directly at object-level field sharing from `clone()`, not at a caching layer serving stale-but-otherwise-correct data.",
    },
  ],
  correctOptionId: "shallow-clone-shares-mutable-lineitems",
  resolution: `\`Invoice.java.excerpt\`'s own comment spells out the mechanism:
\`Object.clone()\` (invoked here via \`super.clone()\`) performs a *shallow*
copy - every field is copied by value, but for a field that's itself a
reference to another object (like \`lineItems\`, a \`List<LineItem>\`), only
the reference is duplicated, not the object it points to. After
\`clone()\`, the original invoice and its draft copy are two distinct
\`Invoice\` objects that both hold a reference to the *same* underlying
\`List\`, containing the *same* \`LineItem\` objects. Editing a line item's
quantity through the draft mutates a \`LineItem\` object that the sent
invoice also still references - there's no copying error or database
mixup involved at all, both invoices are, quite literally, looking at
the same in-memory data the whole time.

The fix is a genuine deep copy of anything mutable reachable from the
cloned object:

\`\`\`java
@Override
public Invoice clone() {
    try {
        Invoice copy = (Invoice) super.clone();
        copy.lineItems = lineItems.stream()
            .map(LineItem::clone)          // deep-copy each mutable LineItem too
            .collect(Collectors.toCollection(ArrayList::new));
        return copy;
    } catch (CloneNotSupportedException e) {
        throw new AssertionError(e);
    }
}
\`\`\`

The general rule: \`Object.clone()\` (and copy constructors that just copy
fields directly) only ever produce a shallow copy by default - any field
referencing a mutable object needs to be explicitly deep-copied, or two
supposedly-independent objects will silently share, and corrupt, each
other's state.`,
};
