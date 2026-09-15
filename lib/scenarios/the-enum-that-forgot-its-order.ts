import type { Scenario } from "./types";

export const theEnumThatForgotItsOrder: Scenario = {
  id: "the-enum-that-forgot-its-order",
  title: "The Enum That Forgot Its Order",
  subtitle: "a routine, unrelated code change silently reclassified thousands of stored support tickets into the wrong priority",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "enums", "persistence"],
  briefing: `Support leadership noticed a strange spike in "LOW" priority tickets and
a matching drop in "URGENT" ones, right after a deploy that only added
a new priority level for a different feature. No migration script ran,
and nobody touched any existing ticket's priority intentionally.`,
  constraints: [
    "The deploy in question only added one new enum constant - it's confirmed no application code path explicitly reassigns any existing ticket's priority.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ticket-service", namespace: "support", labels: { app: "ticket-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ticket-service-7o8p9q0r1-s2t3u", namespace: "support", labels: { app: "ticket-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "ticket-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "ticket-service": [
            "2026-09-15T09:00:01.114Z DEBUG c.e.support.TicketRepository - loaded ticket tkt-9021 priority_ordinal=3 -> Priority.URGENT (expected LOW)",
            "2026-09-15T09:00:01.116Z WARN  c.e.support.PriorityAudit - ticket tkt-9021 priority mismatch: stored intent=LOW, resolved=URGENT",
          ],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ticket-priority-notes", namespace: "support" },
        spec: {
          data: {
            "Priority.java.excerpt":
              "public enum Priority {\n    LOW,\n    MEDIUM,\n    ESCALATED,   // <-- newly added this release, inserted here\n    HIGH,\n    URGENT\n}\n\n// TicketRepository.java:\npublic Priority readPriority(int storedOrdinal) {\n    // the database column stores the integer ordinal() value, not the\n    // enum constant's name, from years before this table had a name column\n    return Priority.values()[storedOrdinal];\n}\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl logs ticket-service-7o8p9q0r1-s2t3u -n support` - a ticket stored expecting `LOW` priority is now resolving to `URGENT`. The stored value itself (`priority_ordinal=3`) never changed.",
    "`kubectl get configmap ticket-priority-notes -n support -o yaml` - what does the database column actually store: the enum constant's name, or its `ordinal()` position?",
    "Where was the new `ESCALATED` constant inserted in the enum's declaration order, and what does that do to the `ordinal()` value of every constant declared after it?",
  ],
  options: [
    {
      id: "enum-ordinal-persistence-shifted-by-new-constant",
      label:
        "The database stores each ticket's priority as `ordinal()`, the enum constant's integer *declaration position* - inserting the new `ESCALATED` constant in the middle of the enum (rather than at the end) shifted the ordinal of every constant declared after it (`HIGH`, `URGENT`) up by one, so a ticket stored with ordinal `3` (originally meaning `HIGH`) now resolves to whatever constant currently sits at ordinal `3`, which is `URGENT` after the insertion - silently reclassifying every previously-stored ticket whose ordinal fell after the insertion point.",
      explanation:
        "The log shows ticket `tkt-9021`, stored with `priority_ordinal=3`, resolving to `Priority.URGENT` when `LOW` was actually intended - and `Priority.java.excerpt` confirms `TicketRepository.readPriority` looks up `Priority.values()[storedOrdinal]`, using the enum's ordinal position, not its name. The same excerpt shows `ESCALATED` was inserted as the third constant in the declaration, between `MEDIUM` and `HIGH` - which shifts `HIGH` and `URGENT` each one ordinal position higher than before. Any ticket stored with an ordinal that used to mean `HIGH` or `URGENT` now silently resolves to a completely different constant, purely because of where the new constant happened to be inserted in source code, with no data migration involved at all.",
    },
    {
      id: "database-migration-ran-incorrectly",
      label: "A database migration accompanying the deploy incorrectly rewrote priority values.",
      explanation:
        "The constraint confirms no migration script ran, and the log shows the *stored* ordinal value (`3`) is completely unchanged from before - what changed is which enum constant that stored number now maps to in code, not the number itself in the database.",
    },
    {
      id: "priorityaudit-using-wrong-comparison-logic",
      label: "`PriorityAudit`'s own comparison logic has a bug, and the ticket's priority is actually still correct.",
      explanation:
        "`TicketRepository`'s own debug log independently confirms the resolved value is `URGENT` for a ticket whose stored intent was `LOW` - this is the actual, live value the application resolves and would act on, not merely something the audit tool itself miscalculated.",
    },
    {
      id: "tickets-batch-reprioritized-by-support-tooling",
      label: "An internal support tool ran a batch reprioritization job around the same time as the deploy.",
      explanation:
        "The stored `priority_ordinal` value is unchanged and was never rewritten by anything - the ticket's *meaning* changed purely because of how that same unchanged number is now interpreted by the application's enum, not because any process modified stored data.",
    },
  ],
  correctOptionId: "enum-ordinal-persistence-shifted-by-new-constant",
  resolution: `The debug log shows the exact mechanism: ticket \`tkt-9021\` is stored with
\`priority_ordinal=3\`, and now resolves to \`Priority.URGENT\` instead of
the \`LOW\` it was originally meant to represent. \`Priority.java.excerpt\`
confirms \`TicketRepository.readPriority\` looks up
\`Priority.values()[storedOrdinal]\` - using the enum constant's
\`ordinal()\`, its zero-based position in declaration order, as the stored
representation, a decision made years ago before the table had a proper
name column. This release inserted a brand-new \`ESCALATED\` constant in
the *middle* of the enum's declaration, between \`MEDIUM\` and \`HIGH\`,
rather than appending it at the end. Every constant declared after that
insertion point - \`HIGH\` and \`URGENT\` - shifted up by one ordinal
position as an automatic, unavoidable consequence of how \`ordinal()\`
works: it's purely positional, recalculated fresh from the enum's
current declaration order every time the class loads, with no memory of
what any number used to mean in a previous version. Every ticket whose
stored ordinal used to correspond to \`HIGH\` or \`URGENT\` now silently
resolves to a different constant, without a single row of data ever
being touched.

The immediate fix is reverting to appending new constants only at the
end (never inserting into the middle) and, more durably, storing the
enum by name instead of ordinal going forward:

\`\`\`java
public enum Priority {
    LOW, MEDIUM, HIGH, URGENT, ESCALATED   // appended at the end, not inserted
}

// prefer storing/reading by name for anything persisted:
public Priority readPriority(String storedName) {
    return Priority.valueOf(storedName);
}
\`\`\`

The general rule: \`Enum.ordinal()\` is a positional index, not a stable
identifier - it is never safe to persist for later reading back, because
it silently changes meaning whenever a constant is inserted, removed, or
reordered. Persist an enum's \`name()\` (or an explicit, manually-assigned
stable code) instead.`,
};
