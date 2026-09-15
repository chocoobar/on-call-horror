import type { Scenario } from "./types";

export const theListThatChangedUnderneath: Scenario = {
  id: "the-list-that-changed-underneath",
  title: "The List That Changed Underneath",
  subtitle: "the \"finalized\" audit snapshot of a purchase order keeps drifting away from what was actually approved",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "collections", "immutability"],
  briefing: `Procurement's audit trail is supposed to freeze a purchase order's
approved line items at the moment of sign-off, by wrapping the list in
an "unmodifiable" view before archiving it. Auditors have found several
archived snapshots that don't match what was actually approved -
extra items appear in the "frozen" record that were added afterward.`,
  constraints: [
    "The archiving code itself never calls any mutating method on the archived reference - no `.add()`, `.remove()`, or similar anywhere in the archival path.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "po-approval-service", namespace: "procurement", labels: { app: "po-approval-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "po-approval-service-1i2j3k4l5-m6n7o", namespace: "procurement", labels: { app: "po-approval-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "po-approval-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "po-approval-service": [
            "2026-09-15T09:02:11.114Z INFO  c.e.procurement.ApprovalService - archived snapshot for po-3391, 3 items",
            "2026-09-15T09:14:40.220Z INFO  c.e.procurement.LineItemEditor - added item 'extra-cables' to po-3391 (post-approval edit request)",
            "2026-09-15T09:14:40.225Z WARN  c.e.procurement.AuditReport - archived snapshot for po-3391 now shows 4 items, expected 3",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "po-approval-notes", namespace: "procurement" },
        spec: {
          data: {
            "ApprovalService.java.excerpt":
              "public void archiveSnapshot(PurchaseOrder po) {\n    // wraps the PO's live, mutable item list in an unmodifiable VIEW -\n    // this does not copy the underlying list's contents\n    List<LineItem> frozen = Collections.unmodifiableList(po.getItems());\n    auditArchive.store(po.id(), frozen);\n}\n",
            "notes.md":
              "`Collections.unmodifiableList(list)` returns a *view* backed by the\noriginal list - the returned view itself rejects direct mutation calls\n(`add`, `remove`, etc. on the view throw), but it reflects any change\nmade to the *original* backing list through any other reference that\nstill points at it, since it never copies any data at all.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap po-approval-notes -n procurement -o yaml` - does `Collections.unmodifiableList` copy the list's contents, or does it wrap the original list in place?",
    "The `LineItemEditor` log shows an item added to the *live* purchase order's item list, well after the snapshot was archived - what does the archived `frozen` reference actually point at?",
    "An unmodifiable *view* only prevents mutation through that specific view reference - it does nothing to stop the underlying list from being changed through a completely different reference that still has access to it.",
  ],
  options: [
    {
      id: "unmodifiablelist-is-a-view-not-a-copy",
      label:
        "`Collections.unmodifiableList(po.getItems())` returns an unmodifiable *view* wrapping the purchase order's live item list, not an independent copy of its contents - the view itself rejects direct mutation calls, but `po.getItems()`'s underlying list is completely unaffected and still fully mutable through the `PurchaseOrder` object itself, so any later edit made via that original reference (like `LineItemEditor` adding an item) is immediately visible through the supposedly 'frozen' archived view too.",
      explanation:
        "\`po-approval-notes\` explains exactly this: \`Collections.unmodifiableList\` wraps the original list without copying it. \`ApprovalService.java.excerpt\` archives \`frozen\`, a view over \`po.getItems()\`'s original backing list - not a snapshot of its current contents. When \`LineItemEditor\` later adds an item directly to the purchase order's live item list (a completely different code path that never touches \`frozen\` at all), that addition is immediately visible through \`frozen\` too, since view and original share the exact same underlying data. The archived record was never actually independent of the live order, no matter how "frozen" its name suggested.",
    },
    {
      id: "auditarchive-store-not-persisting-atomically",
      label: "`auditArchive.store()` isn't persisting the snapshot atomically, causing a partial/inconsistent write.",
      explanation:
        "The warning shows the archived snapshot's *content* itself has genuinely changed (from 3 items to 4) well after the store call completed successfully - this isn't a partial-write or consistency problem at the storage layer, it's that the in-memory object handed to storage was never actually independent of later changes.",
    },
    {
      id: "line-item-editor-bypassing-approval-workflow",
      label: "`LineItemEditor` is bypassing the approval workflow and directly modifying archived records.",
      explanation:
        "The log shows `LineItemEditor` adding an item to the live purchase order (`po-3391`), not to the archive directly - it has no special knowledge of or access to the archived snapshot at all; the snapshot only reflects the change because it was never truly independent of the live order's list in the first place.",
    },
    {
      id: "audit-report-querying-wrong-version",
      label: "`AuditReport` is querying the wrong, most-recent version of the purchase order instead of the archived one.",
      explanation:
        "The warning is generated by comparing the *archived* snapshot's own item count against the expected value - it's specifically observing the archived record itself changing, not an unrelated report accidentally reading live data instead of archived data.",
    },
  ],
  correctOptionId: "unmodifiablelist-is-a-view-not-a-copy",
  resolution: `\`po-approval-notes\` states the key fact plainly: \`Collections.unmodifiableList\`
returns a *view*, not a copy. \`ApprovalService.java.excerpt\` archives
\`frozen\`, built by wrapping \`po.getItems()\` - the purchase order's own
live, mutable item list - in that unmodifiable view. The view genuinely
does reject mutation calls made *through it* (calling \`.add()\` on \`frozen\`
itself would throw), which is exactly what made this feel safe. But it
does nothing at all to protect against the *original* list being mutated
through any other reference that still has access to it - and
\`PurchaseOrder\` keeps returning that same live, mutable list from
\`getItems()\` to anyone who asks, including \`LineItemEditor\`, completely
unaware that a supposedly-frozen archive is watching the exact same
underlying data.

The fix is archiving an actual, independent copy of the list's contents
at the moment of sign-off, not a view over the original:

\`\`\`java
public void archiveSnapshot(PurchaseOrder po) {
    List<LineItem> frozen = List.copyOf(po.getItems());   // genuine, independent copy
    auditArchive.store(po.id(), frozen);
}
\`\`\`

\`List.copyOf(...)\` both copies the current contents into a new backing
array *and* returns an immutable list, giving a real point-in-time
snapshot rather than a rejection-only view over data someone else can
still change. The general rule: "unmodifiable" and "immutable" are not
the same thing - an unmodifiable view only blocks mutation through that
one reference, while the data it wraps can still change out from under
it through any other reference with access to the original.`,
};
