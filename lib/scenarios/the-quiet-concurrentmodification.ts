import type { Scenario } from "./types";

export const theQuietConcurrentModification: Scenario = {
  id: "the-quiet-concurrentmodification",
  title: "The Quiet ConcurrentModificationException",
  subtitle: "unsubscribing from three newsletters in one settings-page save crashes the request, but unsubscribing from one works fine",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "collections", "concurrentmodificationexception"],
  briefing: `The email preferences page lets customers unsubscribe from multiple
newsletters in a single save. Unsubscribing from exactly one newsletter
always works. Unsubscribing from two or more newsletters in the same
save throws an exception and the whole preference update is rolled
back - no unsubscribes are applied at all.`,
  constraints: [
    "This is a single request handled by a single thread, start to finish - no concurrent request or background job touches the same preference list during this operation.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "preferences-service", namespace: "notifications", labels: { app: "preferences-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "preferences-service-3u4v5w6x7-y8z9a", namespace: "notifications", labels: { app: "preferences-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "preferences-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "preferences-service": [
            "2026-09-15T15:10:02.114Z ERROR c.e.notifications.PreferenceUpdater - java.util.ConcurrentModificationException",
            "    at java.base/java.util.ArrayList$Itr.checkForComodification(ArrayList.java:1013)",
            "    at java.base/java.util.ArrayList$Itr.next(ArrayList.java:967)",
            "    at app//com.example.notifications.PreferenceUpdater.unsubscribe(PreferenceUpdater.java:11)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "preferences-updater-notes", namespace: "notifications" },
        spec: {
          data: {
            "PreferenceUpdater.java.excerpt":
              "public void unsubscribe(List<String> subscriptions, List<String> toRemove) {\n    for (String newsletter : subscriptions) {\n        if (toRemove.contains(newsletter)) {\n            subscriptions.remove(newsletter);   // mutating the same list\n                                                  // the for-each is iterating over\n        }\n    }\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs preferences-service-3u4v5w6x7-y8z9a -n notifications` - `ConcurrentModificationException` thrown from inside `ArrayList$Itr`, despite this being fully single-threaded. This exception isn't actually only about multiple threads.",
    "`kubectl get configmap preferences-updater-notes -n notifications -o yaml` - what collection is the enhanced `for` loop iterating, and what collection does `subscriptions.remove(...)` modify?",
    "An enhanced `for` loop over a `List` uses that list's `Iterator` internally, which tracks a modification count - calling `.remove()` directly on the list (not through the iterator itself) while that same loop is still iterating it invalidates that count and throws on the very next `.next()` call, single-threaded or not.",
  ],
  options: [
    {
      id: "structural-modification-during-foreach-same-thread",
      label:
        "`unsubscribe` iterates `subscriptions` with an enhanced `for` loop while calling `subscriptions.remove(newsletter)` directly on that same list inside the loop body - `ConcurrentModificationException` isn't actually about concurrency between threads specifically, it's thrown whenever a `List`'s backing structure is modified directly while an active iterator (which the for-each loop uses internally) is still walking it, and this happens reliably the moment a second newsletter needs removing, since the first `.remove()` call already invalidates the iterator mid-loop.",
      explanation:
        "The stack trace shows `ConcurrentModificationException` thrown from `ArrayList$Itr.checkForComodification`, called from `.next()` - both are part of `ArrayList`'s fail-fast iterator mechanism, which detects *any* direct structural modification to the list while an iterator over it is still active, regardless of whether that modification comes from another thread or the very same one. `PreferenceUpdater.java.excerpt` shows exactly this: an enhanced `for` loop over `subscriptions` (which uses an `Iterator` internally) calls `subscriptions.remove(newsletter)` directly on the list from inside the loop body. Removing exactly one newsletter can, depending on its position, sometimes avoid ever calling `.next()` again afterward and slip through undetected - but removing two or more reliably calls `.next()` again after the list has already been structurally modified, tripping the fail-fast check and throwing on every multi-item unsubscribe.",
    },
    {
      id: "database-transaction-isolation-level",
      label: "The database transaction's isolation level is allowing a dirty read of the preferences list.",
      explanation:
        "`ConcurrentModificationException` here is thrown entirely within in-memory `List` iteration, before any database transaction is described as being involved - it's a Java collections-API exception about iterator/list consistency, not a database isolation-level symptom.",
    },
    {
      id: "two-requests-racing-on-same-preferences",
      label: "Two concurrent requests from the same session are racing to update the same preferences list.",
      explanation:
        "The constraint confirms this is a single request on a single thread with no concurrent access to the same list - `ConcurrentModificationException`'s name is a common source of confusion, but the JDK documentation is explicit that it can, and reliably does, occur from purely single-threaded modification during iteration too.",
    },
    {
      id: "toRemove-list-null-for-some-requests",
      label: "The `toRemove` list is sometimes null, causing unexpected behavior.",
      explanation:
        "The stack trace points specifically at `ArrayList$Itr.next()` failing its modification-count check, which is unrelated to whatever `toRemove` contains - a null `toRemove` would produce a `NullPointerException` at the `.contains()` call instead, a completely different failure with a different, distinguishable stack trace.",
    },
  ],
  correctOptionId: "structural-modification-during-foreach-same-thread",
  resolution: `The stack trace shows \`ConcurrentModificationException\` thrown from
\`ArrayList$Itr.checkForComodification\`, called during \`.next()\` - both
part of \`ArrayList\`'s internal fail-fast iterator. Despite the name,
this exception isn't limited to genuinely concurrent, multi-threaded
access: it's thrown any time a list's structure is modified directly
while an iterator over that same list is still active, on any thread,
including the very one doing the iterating. \`PreferenceUpdater.java.excerpt\`
shows an enhanced \`for\` loop over \`subscriptions\` - which compiles down
to using an \`Iterator\` internally - calling \`subscriptions.remove(newsletter)\`
directly on the underlying list from inside the loop body. That direct
\`.remove()\` call increments the list's internal modification counter
without the iterator's own knowledge. Removing exactly one item can,
depending on where it sits in the list, sometimes finish the loop
without ever calling \`.next()\` again afterward, letting the mismatch go
unnoticed - but removing a second (or later) item reliably requires at
least one more \`.next()\` call, which checks the modification count,
finds it's changed unexpectedly, and throws.

The fix is removing through the iterator itself, or building a
new list instead of mutating the original mid-iteration:

\`\`\`java
public void unsubscribe(List<String> subscriptions, List<String> toRemove) {
    subscriptions.removeIf(toRemove::contains);   // safe: not iterating and
                                                    // mutating separately at all
}
\`\`\`

The general rule: \`ConcurrentModificationException\` is thrown by
fail-fast collection iterators whenever the underlying collection is
structurally modified outside the iterator's own \`remove()\` method
while iteration is in progress - this applies equally on a single
thread and across multiple threads; use \`Iterator.remove()\`,
\`Collection.removeIf(...)\`, or build a fresh filtered collection instead
of mutating one while iterating it directly.`,
};
