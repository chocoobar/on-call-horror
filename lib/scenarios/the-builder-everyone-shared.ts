import type { Scenario } from "./types";

export const theBuilderEveryoneShared: Scenario = {
  id: "the-builder-everyone-shared",
  title: "The Builder Everyone Shared",
  subtitle: "shipping confirmation emails occasionally contain another customer's order number, spliced into the middle of the text",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "shared-state", "concurrency"],
  briefing: `A handful of customers have reported shipping confirmation emails with
garbled or duplicated content - fragments of what looks like another
order's confirmation text mixed into their own. It only happens during
peak hours when many confirmation emails are being generated at once.`,
  constraints: [
    "Each email's core data (recipient, order ID passed into the email builder) is confirmed correctly fetched per-request - the corruption appears only in the final assembled message text.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-notifier", namespace: "notifications", labels: { app: "shipping-notifier" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipping-notifier-3k4l5m6n7-o8p9q", namespace: "notifications", labels: { app: "shipping-notifier" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipping-notifier", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipping-notifier": [
            "2026-09-15T18:02:01.114Z INFO  c.e.notifications.EmailBuilder - building confirmation for order ord-7710",
            "2026-09-15T18:02:01.115Z INFO  c.e.notifications.EmailBuilder - building confirmation for order ord-7711",
            "2026-09-15T18:02:01.121Z WARN  c.e.notifications.EmailSender - sent email to customer for ord-7710 contains reference to ord-7711",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipping-notifier-notes", namespace: "notifications" },
        spec: {
          data: {
            "EmailBuilder.java.excerpt":
              "@Service\npublic class EmailBuilder {\n    // shared across every request handled by this singleton service instance\n    private final StringBuilder buffer = new StringBuilder();\n\n    public String build(Order order) {\n        buffer.setLength(0);   // reset - but this alone doesn't make concurrent use safe\n        buffer.append(\"Hi \").append(order.customerName()).append(\",\\n\");\n        buffer.append(\"Your order \").append(order.id()).append(\" has shipped.\\n\");\n        return buffer.toString();\n    }\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap shipping-notifier-notes -n notifications -o yaml` - `EmailBuilder` is a `@Service` (a Spring singleton by default) with a field-level `StringBuilder`. How many requests share that one instance?",
    "The log shows two different orders' emails being built one millisecond apart - on a service handling many requests concurrently, `buffer.setLength(0)` resetting a *shared* field doesn't stop a second thread from appending to it mid-build.",
    "`StringBuilder` is explicitly not thread-safe, and a field on a singleton bean is shared by every request thread that calls into it - what happens when two threads call `build()` on the same instance around the same time?",
  ],
  options: [
    {
      id: "shared-mutable-stringbuilder-field-on-singleton",
      label:
        "`EmailBuilder` is a singleton service with `buffer` as an instance field, shared by every concurrent request thread - `StringBuilder` isn't thread-safe, so when two threads call `build()` around the same time, one thread's `buffer.setLength(0)` or `.append(...)` calls can interleave with another thread's in-progress append calls on the *same* shared buffer, producing a corrupted, spliced-together string that mixes content from two different orders being built concurrently.",
      explanation:
        "The log shows two different orders' emails being built one millisecond apart, immediately followed by a warning that one order's sent email contains a reference to the other order's ID. `EmailBuilder.java.excerpt` declares `buffer` as an instance field on a `@Service` (a singleton bean by default, shared across every concurrent request), and calls `buffer.setLength(0)` to 'reset' it before building - but `StringBuilder` provides no synchronization at all, so under concurrent access, one thread's reset or append can interleave with another thread's still-in-progress append calls on that same shared buffer, producing exactly the kind of spliced, cross-order content reported. This only manifests under real concurrent load (peak hours), which matches why it wasn't caught by lower-traffic testing.",
    },
    {
      id: "email-template-has-wrong-placeholder",
      label: "The email template's placeholder substitution logic is using the wrong variable name.",
      explanation:
        "There's no template/placeholder substitution shown here at all - the message is built by directly appending order-specific values to a `StringBuilder` field; the corruption comes from concurrent access to that shared, stateful field, not from a placeholder resolving to the wrong source.",
    },
    {
      id: "order-service-returning-wrong-order",
      label: "The order-lookup service is occasionally returning the wrong `Order` object for a given ID.",
      explanation:
        "The constraint confirms each email's input `Order` data is correctly fetched per-request - `order.id()` for a given call is genuinely correct; it's the concurrent reuse of one shared buffer across calls that corrupts the final text, not what data goes into any single call.",
    },
    {
      id: "email-queue-processing-out-of-order",
      label: "The outbound email queue is processing and sending messages out of order.",
      explanation:
        "The corruption is inside the *content* of a single email (containing text referencing a second order), not in emails being delivered to the wrong recipient or in the wrong sequence - out-of-order delivery wouldn't explain one email's body literally containing fragments meant for another.",
    },
  ],
  correctOptionId: "shared-mutable-stringbuilder-field-on-singleton",
  resolution: `The warning log is the tell: an email sent for \`ord-7710\` contains a
reference to \`ord-7711\`, and both orders' emails were being built
essentially simultaneously, a millisecond apart. \`EmailBuilder.java.excerpt\`
declares \`buffer\` - a plain \`StringBuilder\` - as an *instance field* on
\`EmailBuilder\`, which is annotated \`@Service\`, meaning it's a singleton
bean shared by every request thread that calls into it. \`StringBuilder\`
provides no internal synchronization at all; it's explicitly documented
as not safe for concurrent use. Calling \`buffer.setLength(0)\` at the top
of \`build()\` resets the buffer, but does nothing to prevent a second,
concurrently-executing thread from appending its own order's content
into that same buffer in between (or interleaved with) the first
thread's own append calls - the two threads are mutating one shared
object at the same time, and whichever thread calls \`toString()\` gets
whatever the buffer happens to contain at that instant, potentially a
splice of both orders' text.

The fix is not sharing mutable state across requests at all - use a
local variable instead of a field:

\`\`\`java
@Service
public class EmailBuilder {
    public String build(Order order) {
        StringBuilder buffer = new StringBuilder();   // local to this call, not shared
        buffer.append("Hi ").append(order.customerName()).append(",\\n");
        buffer.append("Your order ").append(order.id()).append(" has shipped.\\n");
        return buffer.toString();
    }
}
\`\`\`

The general rule: mutable state stored as an instance field on a
singleton-scoped service is shared by every concurrent caller - anything
that's meant to be scoped to a single request or single call (like a
`StringBuilder` building one message) belongs in a local variable, never
a field, unless it's explicitly designed and synchronized for concurrent
access.`,
};
