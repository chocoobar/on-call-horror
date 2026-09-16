import type { Scenario } from "./types";

export const theComparableThatDisagreedWithEquals: Scenario = {
  id: "the-comparable-that-disagreed-with-equals",
  title: "The Comparable That Disagreed With Equals",
  subtitle: "two clearly different support tickets vanish from the triage board the instant they're both assigned the same due date",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "comparable", "treeset"],
  briefing: `The triage board keeps open tickets in a `TreeSet<Ticket>` sorted by due
date, for a clean chronological view. Support agents have reported
tickets randomly disappearing from the board - not resolved, not
closed, just gone - and it always seems to happen right after two
unrelated tickets happen to get the same due date.`,
  constraints: [
    "Every ticket that disappears is confirmed to still exist and be open in the underlying ticket database - it's specifically missing from the in-memory triage board.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "triage-board", namespace: "support", labels: { app: "triage-board" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "triage-board-1n2o3p4q5-r6s7t", namespace: "support", labels: { app: "triage-board" } },
        status: { phase: "Running", containerStatuses: [{ name: "triage-board", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "triage-board": [
            "2026-09-15T09:12:04.114Z DEBUG c.e.support.TriageBoard - adding tkt-9001 (dueDate=2026-09-20) to board (size before=14)",
            "2026-09-15T09:12:04.116Z DEBUG c.e.support.TriageBoard - adding tkt-9002 (dueDate=2026-09-20) to board (size after=14, expected 15)",
          ],
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "triage-board-notes", namespace: "support" },
        spec: {
          data: {
            "Ticket.java.excerpt":
              "public class Ticket implements Comparable<Ticket> {\n    private final String id;\n    private final LocalDate dueDate;\n\n    @Override\n    public int compareTo(Ticket other) {\n        return dueDate.compareTo(other.dueDate);   // compares ONLY by dueDate\n    }\n\n    // equals()/hashCode() are the default Object identity-based ones -\n    // never overridden anywhere in this class\n}\n\n// TriageBoard.java:\nprivate final TreeSet<Ticket> board = new TreeSet<>();   // no custom\n    // Comparator passed - uses Ticket's own compareTo() for both ordering\n    // AND uniqueness\nboard.add(ticket);\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl logs triage-board-1n2o3p4q5-r6s7t -n support` - the board's size doesn't increase after adding `tkt-9002`, even though it's a genuinely different ticket from `tkt-9001`. What does `TreeSet` use to decide two elements are 'the same'?",
    "`kubectl get configmap triage-board-notes -n support -o yaml` - `Ticket.compareTo()` only compares `dueDate`. A `TreeSet` with no custom `Comparator` uses the element's own `compareTo()` for BOTH sort order AND to decide whether an element is a duplicate.",
    "`TreeSet` considers two elements 'equal' (and refuses to add the second as a duplicate) whenever `compareTo()` returns `0` between them - regardless of what `equals()` would say, and regardless of whether the two objects are actually the same real-world ticket at all.",
  ],
  options: [
    {
      id: "compareto-inconsistent-with-equals-treeset-dedup",
      label:
        "`Ticket.compareTo()` compares only by `dueDate`, and `TreeSet` (with no custom `Comparator` supplied) uses that same `compareTo()` for both sort ordering *and* determining whether an element is a duplicate - any two distinct tickets that happen to share the same `dueDate` compare as `0` (\"equal\") to the set, so `TreeSet` silently refuses to add the second one as a duplicate, even though the two tickets are completely different by identity and by `equals()`, which is never even consulted.",
      explanation:
        "The debug log shows the board's size staying at `14` after adding `tkt-9002`, even though it's confirmed to be a genuinely different, still-open ticket from `tkt-9001` - the two just happen to share the same `dueDate` (`2026-09-20`). `Ticket.java.excerpt` shows `compareTo()` compares only `dueDate`, and `TriageBoard`'s `TreeSet<Ticket>` uses no custom `Comparator`, meaning it relies entirely on `Ticket`'s own `compareTo()` for both maintaining sort order and detecting duplicates - `TreeSet`'s documentation is explicit that it considers two elements duplicates whenever `compareTo()` returns `0` between them, completely independent of `equals()`. Any two tickets sharing a due date compare as `0`, so the second one is silently discarded as a 'duplicate' by the set, even though it's a completely different, still-open ticket - this is 'comparable inconsistent with equals,' a documented `TreeSet`/`TreeMap` pitfall.",
    },
    {
      id: "database-marking-tickets-resolved-incorrectly",
      label: "The ticket database is incorrectly marking one of the two tickets as resolved when due dates collide.",
      explanation:
        "The constraint confirms every 'disappeared' ticket is still open and present in the underlying database - the ticket's actual stored state is untouched; it's specifically missing from the in-memory `TreeSet`-backed board, a purely in-application-memory symptom.",
    },
    {
      id: "triageboard-deduplicating-by-id-incorrectly",
      label: "`TriageBoard` has its own explicit deduplication logic that's incorrectly matching tickets by a shared field.",
      explanation:
        "There's no explicit deduplication logic anywhere in `TriageBoard` - the described behavior is `TreeSet`'s own built-in, standard duplicate-detection mechanism (based on `compareTo()` returning `0`) operating exactly as documented, not a custom matching rule written by the application.",
    },
    {
      id: "localdate-equals-broken-for-same-day-values",
      label: "`LocalDate.equals()` has a bug causing two genuinely different dates to compare as equal.",
      explanation:
        "`LocalDate.compareTo()`/`.equals()` are core, thoroughly correct JDK methods - the two tickets here have the exact same, genuinely identical `dueDate` value; the problem isn't a bug in date comparison, it's that ticket identity is being conflated with due date equality entirely by the `TreeSet`'s deduplication mechanism.",
    },
  ],
  correctOptionId: "compareto-inconsistent-with-equals-treeset-dedup",
  resolution: `The debug log shows the board's size staying flat after adding a
confirmed-distinct, still-open ticket - the telltale sign of an
unwanted deduplication. \`Ticket.java.excerpt\` shows why: \`compareTo()\`
compares tickets *only* by \`dueDate\`, and \`TriageBoard\`'s \`TreeSet<Ticket>\`
is constructed with no custom \`Comparator\`, meaning it relies entirely
on \`Ticket\`'s own \`compareTo()\` for everything - both maintaining sort
order and deciding whether a newly-added element is a duplicate of one
already present. \`TreeSet\`'s documented contract is explicit and easy to
overlook: it considers two elements "the same" (and silently refuses to
add the second) whenever \`compareTo()\` returns \`0\` between them,
completely independent of \`equals()\` - which, in this class, is never
even overridden and would correctly say the two tickets are different if
it were consulted. Any two tickets that happen to share a due date
compare as \`0\` and collide, silently discarding whichever one is added
second, with no exception, no warning, and no visible sign that anything
was dropped.

The fix is making \`compareTo()\` a total ordering that's consistent with
identity (or \`equals()\`), typically by adding a stable tiebreaker like
the ticket's own unique ID:

\`\`\`java
@Override
public int compareTo(Ticket other) {
    int byDueDate = dueDate.compareTo(other.dueDate);
    if (byDueDate != 0) return byDueDate;
    return id.compareTo(other.id);   // tiebreaker - never returns 0 for
                                       // two genuinely different tickets
}
\`\`\`

The general rule: any type used in a \`TreeSet\`/\`TreeMap\` (directly or via
its natural ordering) needs a \`compareTo()\` that only ever returns \`0\` for
elements that are truly meant to be treated as duplicates - if
\`compareTo()\` can return \`0\` for objects that are meaningfully different,
\`TreeSet\`/\`TreeMap\` will silently drop one of them, regardless of what
\`equals()\` says, because those collections never consult \`equals()\` at
all when a custom or natural ordering is in play.`,
};
