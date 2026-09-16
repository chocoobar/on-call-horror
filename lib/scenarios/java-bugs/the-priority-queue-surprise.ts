import type { Scenario } from "../types";

export const thePriorityQueueSurprise: Scenario = {
  id: "the-priority-queue-surprise",
  title: "The Priority Queue Surprise",
  subtitle: "the \"top 5 most urgent tickets\" digest email regularly includes a ticket that isn't actually in the top 5",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "priorityqueue", "ordering"],
  briefing: `The on-call digest email is supposed to list the five most urgent open
tickets, in priority order, drawn directly from the team's live
\`PriorityQueue\`. Several engineers have noticed the listed tickets are
sometimes clearly not the five most urgent ones actually in the queue -
a genuinely lower-priority ticket sneaks into the list.`,
  constraints: [
    "Every ticket's priority value is confirmed correct at the moment it's inserted into the queue - there's no data-quality issue with the priorities themselves.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "oncall-digest", namespace: "support", labels: { app: "oncall-digest" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "7mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "oncall-digest-9q0r1s2t3-u4v5w", namespace: "support", labels: { app: "oncall-digest" } },
        status: { phase: "Running", containerStatuses: [{ name: "oncall-digest", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "oncall-digest": [
            "2026-09-15T07:00:04.114Z DEBUG c.e.support.DigestBuilder - iterating ticketQueue (size=42) for top-5 listing",
            "2026-09-15T07:00:04.118Z INFO  c.e.support.DigestBuilder - top-5 included ticket tkt-1188 (priority=2) ahead of tkt-1204 (priority=9)",
          ],
        },
        age: "7mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "oncall-digest-notes", namespace: "support" },
        spec: {
          data: {
            "DigestBuilder.java.excerpt":
              "public List<Ticket> topFive(PriorityQueue<Ticket> ticketQueue) {\n    List<Ticket> result = new ArrayList<>();\n    int count = 0;\n    for (Ticket t : ticketQueue) {   // iterates the queue's internal array directly\n        if (count++ >= 5) break;\n        result.add(t);\n    }\n    return result;\n}\n",
          },
        },
        age: "7mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap oncall-digest-notes -n support -o yaml` - `topFive` uses a plain enhanced for-loop directly over the `PriorityQueue`. Does `PriorityQueue`'s iterator guarantee any particular ordering?",
    "A `PriorityQueue` only guarantees that `.poll()` (or `.peek()`) returns elements in priority order, one at a time - its `iterator()` makes no such guarantee about the order elements are visited in.",
    "`PriorityQueue` is backed by a binary heap array, which only guarantees a parent-child ordering relationship, not a fully sorted array - iterating it directly walks that array in whatever internal order the heap happens to be arranged in.",
  ],
  options: [
    {
      id: "priorityqueue-iterator-not-ordered",
      label:
        "`topFive` iterates `ticketQueue` directly with a `for` loop, which uses `PriorityQueue`'s `iterator()` - but `PriorityQueue` only guarantees priority ordering for `poll()`/`peek()`, not for iteration, since it's backed by a binary heap array that only maintains a parent-child priority relationship, not a fully sorted sequence; iterating it directly visits elements in heap-internal array order, which can easily place a lower-priority ticket before a higher-priority one that happens to be positioned elsewhere in the heap.",
      explanation:
        "The log shows `tkt-1188` (priority 2) appearing in the top-5 listing ahead of `tkt-1204` (priority 9) - the opposite of intended priority order. `DigestBuilder.java.excerpt` builds the result by iterating `ticketQueue` directly with a `for` loop, which uses the queue's `iterator()`. The JDK documentation is explicit that `PriorityQueue`'s iterator makes no guarantee about traversal order - only repeated `poll()` calls are guaranteed to return elements in priority order. A `PriorityQueue`'s underlying binary heap array only maintains the heap property (each parent has priority over its own children), not a fully sorted array, so a direct iteration can easily surface a lower-priority element before a higher-priority one that's simply positioned deeper in a different branch of the heap.",
    },
    {
      id: "ticket-priority-comparator-reversed",
      label: "The `Comparator` used to order the `PriorityQueue` has its comparison logic reversed.",
      explanation:
        "The debug log confirms `tkt-1204`'s priority (`9`) is genuinely higher than `tkt-1188`'s (`2`), and correctly labeled as such - the queue's underlying ordering intent is right; what's wrong is how the top-5 list is extracted from it, not the comparison direction defining priority.",
    },
    {
      id: "tickets-inserted-with-stale-priority",
      label: "Tickets are being inserted into the queue with a stale priority value that later changes.",
      explanation:
        "The constraint confirms every ticket's priority is correct at insertion time - there's no indication either ticket's priority changed after being queued; the extraction logic itself picks the wrong five out of a correctly-prioritized set.",
    },
    {
      id: "digest-builder-race-condition",
      label: "Concurrent ticket insertions into the queue are racing with the digest build, corrupting the read.",
      explanation:
        "This is a single, deterministic misordering explainable entirely by how `PriorityQueue` iteration works, independent of any concurrent modification - the same wrong ordering would reproduce on a completely static, unchanging queue too.",
    },
  ],
  correctOptionId: "priorityqueue-iterator-not-ordered",
  resolution: `The debug log shows the actual failure: \`tkt-1188\` (priority \`2\`) lands
in the top-5 digest ahead of \`tkt-1204\` (priority \`9\`) - a much more
urgent ticket getting bumped out by a much less urgent one.
\`DigestBuilder.java.excerpt\` builds the list by iterating \`ticketQueue\`
directly with an enhanced \`for\` loop, which uses \`PriorityQueue\`'s
\`iterator()\`. The JDK documentation for \`PriorityQueue\` is explicit and
easy to miss: only \`poll()\` (and, for the single highest-priority
element, \`peek()\`) is guaranteed to respect priority order. The
iterator provides "no guarantees" about the order in which it traverses
elements. \`PriorityQueue\` is implemented as a binary heap stored in a
flat array, where the only structural guarantee is that each element has
at least as high a priority as its own children - there's no guarantee
about relative order between elements in different branches of that
heap, which is exactly why direct iteration can surface a low-priority
element before a much higher-priority one sitting deeper in a different
branch.

The fix is repeatedly polling the queue (or a copy of it, if the
original must stay intact) instead of iterating it directly:

\`\`\`java
public List<Ticket> topFive(PriorityQueue<Ticket> ticketQueue) {
    PriorityQueue<Ticket> copy = new PriorityQueue<>(ticketQueue);   // don't drain the original
    List<Ticket> result = new ArrayList<>();
    for (int i = 0; i < 5 && !copy.isEmpty(); i++) {
        result.add(copy.poll());   // poll() guarantees priority order
    }
    return result;
}
\`\`\`

The general rule: \`PriorityQueue\`'s iteration order is unspecified and
must never be relied on for anything priority-sensitive - only
\`poll()\`/\`peek()\` are documented to honor the queue's ordering; reach for
a genuinely sorted structure (like sorting a snapshot list, or a
\`TreeSet\`) if repeated iteration in priority order is actually needed.`,
};
