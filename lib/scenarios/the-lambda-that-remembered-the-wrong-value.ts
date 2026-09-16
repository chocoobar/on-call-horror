import type { Scenario } from "./types";

export const theLambdaThatRememberedTheWrongValue: Scenario = {
  id: "the-lambda-that-remembered-the-wrong-value",
  title: "The Lambda That Remembered the Wrong Value",
  subtitle: "every button in the bulk-approval UI's generated action list ends up approving the same, final request",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "lambdas", "closures"],
  briefing: `"approval-queue-service" builds a list of clickable approve-actions, one
per pending request, for a manager's review screen. Clicking any button
in the list except the last one approves the wrong request - always
the very last request in that day's batch, regardless of which button
was actually clicked.`,
  constraints: [
    "Each generated action's displayed label (the request ID text shown on the button) is confirmed correct and unique per button - only which request actually gets approved when clicked is wrong.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "approval-queue-service", namespace: "workflow", labels: { app: "approval-queue-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "approval-queue-service-2e3f4g5h6-i7j8k", namespace: "workflow", labels: { app: "approval-queue-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "approval-queue-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "approval-queue-service": [
            "2026-09-15T09:50:02.114Z DEBUG c.e.workflow.ActionBuilder - built approve-action for req-101, req-102, req-103",
            "2026-09-15T09:51:14.220Z INFO  c.e.workflow.ActionBuilder - button for req-101 clicked -> approving req-103",
          ],
        },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "approval-action-builder-notes", namespace: "workflow" },
        spec: {
          data: {
            "ActionBuilder.java.excerpt":
              "public List<Runnable> buildActions(List<Request> requests) {\n    List<Runnable> actions = new ArrayList<>();\n    Request current = null;\n    for (Request r : requests) {\n        current = r;   // reassigned on every iteration, same variable reused\n        actions.add(() -> approve(current));   // captures the VARIABLE, not\n            // a per-iteration snapshot of its value at capture time\n    }\n    return actions;\n}\n",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap approval-action-builder-notes -n workflow -o yaml` - `current` is declared once, outside the loop, and reassigned on every iteration. What does the lambda `() -> approve(current)` actually capture?",
    "A Java lambda capturing a local variable must capture something *effectively final* - here, `current` isn't final at all, it's an ordinary mutable variable being reassigned. How is that even compiling, and what does it capture as a result?",
    "This compiles specifically because `current` is declared *outside* the loop body (so each iteration's assignment is a mutation of the one shared variable, not a fresh, effectively-final declaration) - every lambda closes over that same one variable, not a distinct value per iteration.",
  ],
  options: [
    {
      id: "shared-mutable-variable-captured-by-all-lambdas",
      label:
        "`current` is declared once, outside the loop, and reassigned on every iteration rather than being redeclared fresh inside the loop body - every lambda created in the loop closes over that same single shared variable (not a per-iteration snapshot), so by the time any button is actually clicked, `current` already holds whatever the loop's *final* assignment left it at, and every action ends up approving that same last request regardless of which button was clicked.",
      explanation:
        "The log shows clicking the button labeled for `req-101` actually approves `req-103` - the last request built in that batch. `ActionBuilder.java.excerpt` declares `current` once, outside the `for` loop, and reassigns it on every iteration - each lambda `() -> approve(current)` captures that one shared variable itself, not a distinct, frozen value per iteration. Because lambda execution happens later (when a button is clicked), by which point the loop has already finished and left `current` pointing at the last request processed, every single lambda - regardless of which iteration created it - reads that same final value when it eventually runs, producing exactly the observed behavior where every button approves the last request in the batch.",
    },
    {
      id: "approve-method-hardcoded-to-last-request",
      label: "The `approve(Request)` method itself has a bug that always resolves to the last request in some internal list.",
      explanation:
        "`approve(current)` is passed a specific `Request` argument directly at the call site - there's no internal lookup or 'last request' logic inside `approve` shown or needed here; the wrong value is already baked into what's passed in, before `approve` is ever called.",
    },
    {
      id: "ui-button-click-handlers-wired-incorrectly",
      label: "The front-end UI is wiring every button's click handler to the same underlying action object by mistake.",
      explanation:
        "The debug log shows a distinct `Runnable` action genuinely built per request (`built approve-action for req-101, req-102, req-103`) - three separate action objects exist; the bug is in what value each one's lambda body actually reads when invoked, not in the UI reusing a single action across multiple buttons.",
    },
    {
      id: "requests-list-mutated-after-actions-built",
      label: "The `requests` list itself is being mutated or reordered after the actions are built.",
      explanation:
        "The captured variable is `current`, a separate local variable independent of the `requests` list's own contents or ordering - even a completely untouched, stable `requests` list would still produce this bug, since the problem is entirely in how the loop variable is captured, not in the source list's stability.",
    },
  ],
  correctOptionId: "shared-mutable-variable-captured-by-all-lambdas",
  resolution: `The log shows clicking the button built for \`req-101\` actually approves
\`req-103\` - the last request in the batch, regardless of which button
was clicked. \`ActionBuilder.java.excerpt\` shows the mechanism: \`current\`
is declared *once*, outside the \`for\` loop, and reassigned on every
iteration - it's a single shared mutable variable, not a fresh,
per-iteration binding. Java lambdas capture *variables*, not
point-in-time values, when the captured variable is a field or, as here
via reassignment across iterations, something the compiler treats as one
continuously-mutated storage location - what actually makes this compile
is that \`current\` is declared outside the loop, so its per-iteration
assignment is a mutation, not a fresh effectively-final local each time
(which the compiler would otherwise reject capturing). Every lambda
built in the loop closes over that exact same variable. Lambdas don't
execute at creation time - they execute later, whenever a button is
actually clicked - and by then the loop has long since finished, leaving
\`current\` holding whatever its *last* assignment was. Every lambda,
regardless of which iteration created it, reads that same final value
when it eventually runs.

The fix is declaring a fresh, effectively-final variable *inside* the
loop body, so each iteration gets its own distinct binding for the
lambda to capture:

\`\`\`java
public List<Runnable> buildActions(List<Request> requests) {
    List<Runnable> actions = new ArrayList<>();
    for (Request r : requests) {
        final Request current = r;   // fresh binding, scoped to this iteration only
        actions.add(() -> approve(current));
    }
    return actions;
}
\`\`\`

Since \`r\` itself (the enhanced for-loop variable) is already
effectively final per iteration, capturing it directly (\`() -> approve(r)\`)
would also work correctly - the bug specifically comes from introducing
a separate, loop-external variable and reassigning it, rather than
capturing the naturally per-iteration loop variable itself. The general
rule: a lambda capturing a variable declared and reassigned outside the
loop it's created in captures that one shared variable's *final* state,
not a snapshot from when the lambda was built - always capture a
variable that's freshly bound within the same iteration.`,
};
