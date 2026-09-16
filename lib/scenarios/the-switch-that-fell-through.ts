import type { Scenario } from "./types";

export const theSwitchThatFellThrough: Scenario = {
  id: "the-switch-that-fell-through",
  title: "The Switch That Fell Through",
  subtitle: "every customer gets free next-day shipping upgraded to overnight, whether they paid for it or not",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "switch-statement", "shipping"],
  briefing: `Warehouse ops flagged a spike in overnight shipping label printouts far
above what customers actually paid for. Investigation shows every order
with a shipping tier of "STANDARD" or higher is getting printed as
"OVERNIGHT" labels, costing the company real money on every single
order shipped today.`,
  constraints: [
    "The shipping tier stored on each order is confirmed correct in the database - the problem is entirely in how a tier gets turned into a printed label.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "label-printer-service", namespace: "warehouse", labels: { app: "label-printer-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "label-printer-service-4b5c6d7e8-f9g0h", namespace: "warehouse", labels: { app: "label-printer-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "label-printer-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "label-printer-service": [
            "2026-09-15T07:30:11.114Z INFO  c.e.warehouse.LabelPrinter - order ord-5521 tier=STANDARD -> printed label=OVERNIGHT",
            "2026-09-15T07:30:14.204Z INFO  c.e.warehouse.LabelPrinter - order ord-5522 tier=TWO_DAY -> printed label=OVERNIGHT",
          ],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "label-printer-notes", namespace: "warehouse" },
        spec: {
          data: {
            "LabelPrinter.java.excerpt":
              "public String labelFor(String tier) {\n    String label;\n    switch (tier) {\n        case \"STANDARD\":\n            label = \"GROUND\";\n        case \"TWO_DAY\":\n            label = \"TWO_DAY\";\n        case \"OVERNIGHT\":\n            label = \"OVERNIGHT\";\n            break;\n        default:\n            label = \"GROUND\";\n    }\n    return label;\n}\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap label-printer-notes -n warehouse -o yaml` - trace what `label` actually ends up holding for `tier = \"STANDARD\"`, one case at a time.",
    "A Java `switch` statement falls through to the next case unless a `break` (or `return`) stops it - a matched case with no `break` keeps executing every case below it too.",
    "Which cases in `labelFor` are missing a `break`, and what's the last assignment to `label` before the first `break` actually gets hit?",
  ],
  options: [
    {
      id: "missing-break-statements",
      label:
        "`case \"STANDARD\"` and `case \"TWO_DAY\"` are both missing a `break`, so once either matches, execution falls through every case below it, reassigning `label` each time, all the way down to `case \"OVERNIGHT\"` where the first `break` actually is - meaning any tier at or above STANDARD ends up printing an OVERNIGHT label regardless of what it should have been.",
      explanation:
        "`LabelPrinter.java.excerpt` shows `case \"STANDARD\"` and `case \"TWO_DAY\"` both lacking a `break` statement. A Java `switch` falls through to the next case's code when no `break` stops it, so matching `\"STANDARD\"` runs its own assignment, then falls into `\"TWO_DAY\"`'s assignment, then falls into `\"OVERNIGHT\"`'s assignment, and only then hits the first `break` - leaving `label` set to `\"OVERNIGHT\"` no matter which of the three tiers actually matched. The logs confirm both `STANDARD` and `TWO_DAY` orders print as `OVERNIGHT`, exactly matching this fall-through path.",
    },
    {
      id: "shipping-tier-stored-wrong",
      label: "Orders are having the wrong shipping tier stored in the database in the first place.",
      explanation:
        "The log line shows the correct tier (`STANDARD`, `TWO_DAY`) being read in and passed into `labelFor` - the input is right; it's what happens to it inside the method that produces the wrong output.",
    },
    {
      id: "printer-hardware-misconfigured",
      label: "The physical label printer hardware is misconfigured to always print the overnight template.",
      explanation:
        "The application itself logs that it computed and printed label `OVERNIGHT` for a `STANDARD` order - the wrong value is being decided in code before it ever reaches the printer, not misapplied by the printer afterward.",
    },
    {
      id: "default-case-wrong",
      label: "The `default` case in the switch statement is incorrectly set to OVERNIGHT.",
      explanation:
        "The `default` case in `labelFor` is correctly set to `\"GROUND\"` - the bug isn't in what happens for unrecognized tiers, it's in what happens after a *recognized* tier's case body runs without a `break` to stop it.",
    },
  ],
  correctOptionId: "missing-break-statements",
  resolution: `Tracing \`labelFor("STANDARD")\` step by step through
\`LabelPrinter.java.excerpt\` shows the actual problem: the \`switch\` matches
\`case "STANDARD"\`, assigns \`label = "GROUND"\`, and then - because there's
no \`break\` - keeps executing. It falls straight into \`case "TWO_DAY"\`'s
body, reassigning \`label = "TWO_DAY"\`, and then falls again into
\`case "OVERNIGHT"\`'s body, reassigning \`label = "OVERNIGHT"\`, where it
finally hits the first \`break\` in the whole statement and stops. Every
tier from \`STANDARD\` upward silently rides the fall-through all the way
to the \`OVERNIGHT\` assignment, which is exactly why the logs show
\`STANDARD\` and \`TWO_DAY\` orders both printing overnight labels while only
genuinely overnight orders were ever supposed to.

The fix is adding a \`break\` (or a \`return\`) to every case, or switching to
the arrow-form \`switch\` that doesn't fall through by default:

\`\`\`java
public String labelFor(String tier) {
    return switch (tier) {
        case "STANDARD" -> "GROUND";
        case "TWO_DAY" -> "TWO_DAY";
        case "OVERNIGHT" -> "OVERNIGHT";
        default -> "GROUND";
    };
}
\`\`\`

The general rule: classic Java \`switch\` statements fall through by
default unless every case body ends in \`break\`, \`return\`, \`throw\`, or
\`continue\` - a single missing \`break\` silently executes every case below
it. Modern arrow-form \`switch\` expressions don't fall through at all and
are the safer default for new code.`,
};
