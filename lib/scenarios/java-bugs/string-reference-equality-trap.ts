import type { Scenario } from "../types";

export const stringReferenceEqualityTrap: Scenario = {
  id: "string-reference-equality-trap",
  title: "The String Reference Equality Trap",
  subtitle: "orders placed through the partner API always show status \"UNKNOWN\" on the fulfillment dashboard",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "strings", "equality"],
  briefing: `The fulfillment dashboard shows "UNKNOWN" status for every single order
that arrives through the partner ingestion API, even though the partner's
own payload clearly contains a valid, recognized status string like
"SHIPPED". Orders created directly in-app, where the status is set from
a hardcoded literal, always display correctly.`,
  constraints: [
    "The set of valid status strings the dashboard recognizes is confirmed correct and unchanged - the values coming from the partner really are among them.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fulfillment-status-service", namespace: "fulfillment", labels: { app: "fulfillment-status-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "fulfillment-status-service-3a4b5c6d7-e8f9g", namespace: "fulfillment", labels: { app: "fulfillment-status-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "fulfillment-status-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "fulfillment-status-service": [
            "2026-09-15T08:12:01.114Z DEBUG c.e.fulfillment.StatusBadge - partner payload status=\"SHIPPED\" (len=7)",
            "2026-09-15T08:12:01.116Z INFO  c.e.fulfillment.StatusBadge - order ord-8891 badge=UNKNOWN",
          ],
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fulfillment-status-notes", namespace: "fulfillment" },
        spec: {
          data: {
            "StatusBadge.java.excerpt":
              "public String badgeFor(String status) {\n    // status comes from the partner API's JSON payload, deserialized\n    // fresh on every request - a genuinely new String object each time\n    if (status == \"SHIPPED\") {\n        return \"SHIPPED\";\n    } else if (status == \"DELIVERED\") {\n        return \"DELIVERED\";\n    }\n    return \"UNKNOWN\";\n}\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap fulfillment-status-notes -n fulfillment -o yaml` - how is `status` being compared against each expected value?",
    "`==` on `String` compares object reference identity, not content - it only 'accidentally' works when both sides happen to be the exact same interned/pooled string object.",
    "String literals in source code are automatically interned and share one pooled instance - a `String` freshly deserialized from a JSON payload is a brand-new object, even if its content is identical.",
  ],
  options: [
    {
      id: "string-equals-vs-double-equals",
      label:
        "`badgeFor` compares `status` against each literal using `==` instead of `.equals()` - string literals in the source are interned and share the same pooled object, but `status` is a freshly deserialized `String` from the partner payload, a distinct object every time, so `==` is always `false` regardless of content, no matter how correct the actual text is.",
      explanation:
        "`StatusBadge.java.excerpt` uses `status == \"SHIPPED\"` - a reference comparison. The debug log confirms the payload's content is genuinely `\"SHIPPED\"`, but it was deserialized into a new `String` object, not the interned literal `\"SHIPPED\"` living in the string pool, so `==` compares two different objects and is always false. In-app-created orders that assign the literal directly happen to compare the same interned object against itself, which is exactly why only partner-sourced orders are affected.",
    },
    {
      id: "partner-payload-malformed",
      label: "The partner API is sending a malformed or misspelled status value.",
      explanation:
        "The debug log shows the payload's status is exactly `\"SHIPPED\"`, correctly spelled and matching a recognized value - the payload content itself isn't the problem; how it's compared against expected values is.",
    },
    {
      id: "json-deserializer-dropping-whitespace",
      label: "The JSON deserializer is adding invisible whitespace or control characters to the string.",
      explanation:
        "The logged length (`len=7`) matches `\"SHIPPED\"` exactly with no extra characters - there's no evidence of corrupted content, only of a comparison that doesn't check content at all.",
    },
    {
      id: "dashboard-caching-stale-status",
      label: "The dashboard is caching a stale status value from an earlier request.",
      explanation:
        "The log shows this exact request computing `UNKNOWN` freshly, in real time, directly from this request's own payload - there's no cache layer involved in this computation, just a direct comparison producing the wrong result.",
    },
  ],
  correctOptionId: "string-equals-vs-double-equals",
  resolution: `\`StatusBadge.java.excerpt\` compares \`status\` against each expected value
with \`==\`, which for \`String\` (a reference type) compares object identity,
not textual content. String literals appearing directly in Java source
code are automatically interned by the JVM and share a single pooled
instance - so when an order is created in-app with a status literal
assigned directly, that literal and the literal inside \`badgeFor\` are
often the exact same pooled object, and \`==\` "works" by coincidence.
A status string deserialized from a partner API's JSON payload is a
brand-new \`String\` object built at runtime, regardless of how identical
its content is to the literal it's being compared against - so \`==\`
against it is always \`false\`, every single time, for every partner order.

The fix is comparing content, not identity:

\`\`\`java
public String badgeFor(String status) {
    if ("SHIPPED".equals(status)) {
        return "SHIPPED";
    } else if ("DELIVERED".equals(status)) {
        return "DELIVERED";
    }
    return "UNKNOWN";
}
\`\`\`

Putting the literal on the left also avoids a \`NullPointerException\` if
\`status\` is ever null. The general rule: never compare \`String\` (or any
non-primitive reference type) with \`==\` unless object identity is
specifically what's being tested - use \`.equals()\` for value comparison,
always, regardless of whether \`==\` happens to work in some cases today.`,
};
