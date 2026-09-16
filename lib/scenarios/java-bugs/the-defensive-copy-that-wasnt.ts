import type { Scenario } from "../types";

export const theDefensiveCopyThatWasnt: Scenario = {
  id: "the-defensive-copy-that-wasnt",
  title: "The Defensive Copy That Wasn't",
  subtitle: "a completed subscription's renewal date keeps drifting away from what was recorded at checkout",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "mutability", "encapsulation"],
  briefing: `"subscription-service" records each subscription's renewal date at the
moment it's created and treats it as permanent history from then on.
Auditors found several subscriptions whose stored renewal date had
silently changed, weeks after creation, with no corresponding update
event logged anywhere.`,
  constraints: [
    "There is no code path anywhere that explicitly reassigns a `Subscription`'s renewal date field after construction - confirmed by review of every write to that field.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "subscription-service", namespace: "billing", labels: { app: "subscription-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "subscription-service-1s2t3u4v5-w6x7y", namespace: "billing", labels: { app: "subscription-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "subscription-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "subscription-service": [
            "2026-09-15T09:00:01.114Z INFO  c.e.billing.Subscription - created subscription sub-4471 renewalDate=2026-10-15",
            "2026-09-15T09:04:12.301Z INFO  c.e.billing.PromoCalendar - shared calendar instance advanced by 14 days for promo window calc",
            "2026-09-15T09:04:12.305Z WARN  c.e.billing.SubscriptionAudit - subscription sub-4471 renewalDate now reads 2026-10-29, expected 2026-10-15",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "subscription-service-notes", namespace: "billing" },
        spec: {
          data: {
            "Subscription.java.excerpt":
              "public class Subscription {\n    private final Calendar renewalDate;   // java.util.Calendar - mutable\n\n    public Subscription(Calendar renewalDate) {\n        this.renewalDate = renewalDate;   // stores the caller's reference directly,\n                                           // no defensive copy taken\n    }\n\n    public Calendar getRenewalDate() {\n        return renewalDate;   // returns the live internal reference directly too\n    }\n}\n\n// PromoCalendar.java - unrelated code elsewhere in the same request:\nCalendar shared = subscription.getRenewalDate();\nshared.add(Calendar.DAY_OF_MONTH, 14);   // intended only as scratch math for\n                                          // a promo window, on what the author\n                                          // assumed was a throwaway copy\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs subscription-service-1s2t3u4v5-w6x7y -n billing` - `PromoCalendar` logs advancing 'a shared calendar instance' by 14 days, right before the subscription's own renewal date shifts by exactly 14 days too. Coincidence?",
    "`kubectl get configmap subscription-service-notes -n billing -o yaml` - `Subscription`'s constructor and getter both hand out the *same* `Calendar` object reference it was given, with no copying anywhere.",
    "`java.util.Calendar` is a mutable class - calling `.add(...)` on any reference to it mutates the one underlying object, visible through every other reference anyone else is holding to that same object.",
  ],
  options: [
    {
      id: "no-defensive-copy-of-mutable-calendar-field",
      label:
        "`Subscription` stores and returns the exact same mutable `Calendar` reference it was constructed with, taking no defensive copy in the constructor or the getter - unrelated code elsewhere (`PromoCalendar`) calls `getRenewalDate()` and mutates it directly with `.add(...)` for its own scratch calculation, assuming it had its own private copy, but because no copy was ever made, that mutation permanently changes the subscription's actual stored renewal date too.",
      explanation:
        "The logs line up exactly: `PromoCalendar` advances 'a shared calendar instance' by 14 days, and the subscription's `renewalDate` immediately shifts by that same 14 days, from `2026-10-15` to `2026-10-29`. `Subscription.java.excerpt` confirms neither the constructor nor `getRenewalDate()` ever copies the `Calendar` object - both simply pass the one original reference around. `Calendar` is a mutable class, so `PromoCalendar`'s call to `.add(Calendar.DAY_OF_MONTH, 14)`, written assuming it was working with a private, disposable copy for its own promo-window math, actually mutates the exact same object `Subscription` is still holding onto internally, silently corrupting what was meant to be a fixed, historical value.",
    },
    {
      id: "database-update-trigger-recalculating-date",
      label: "A database trigger is recalculating the renewal date automatically based on other fields.",
      explanation:
        "The logs show the change happening entirely in application memory, correlated precisely with an in-process `Calendar.add()` call - there's no database write, trigger, or persistence-layer involvement shown anywhere in this sequence at all.",
    },
    {
      id: "clock-drift-affecting-renewal-calculation",
      label: "System clock drift on the node is affecting how the renewal date is calculated.",
      explanation:
        "The shift is exactly 14 days, matching precisely the 14-day advance `PromoCalendar` explicitly logs performing - this is a deliberate, logged mutation of a specific object, not the kind of small, continuous drift a misbehaving system clock would produce.",
    },
    {
      id: "subscription-audit-comparing-wrong-timezone",
      label: "`SubscriptionAudit` is comparing the renewal date against the wrong timezone, producing a false mismatch.",
      explanation:
        "The discrepancy is exactly 14 days - far larger than any timezone-offset difference (which tops out around a day) could ever produce - and it precisely matches the 14-day advance explicitly logged by an unrelated piece of code that shares access to the same underlying object.",
    },
  ],
  correctOptionId: "no-defensive-copy-of-mutable-calendar-field",
  resolution: `The two log lines tell the whole story when read together: \`PromoCalendar\`
advances "a shared calendar instance" by 14 days, and the subscription's
\`renewalDate\` shifts by that exact same 14 days moments later.
\`Subscription.java.excerpt\` shows why they're actually the same object:
the constructor stores the \`Calendar\` reference it's handed directly,
with no copy, and \`getRenewalDate()\` hands that same live reference back
out to any caller, also with no copy. \`java.util.Calendar\` is mutable -
calling \`.add(Calendar.DAY_OF_MONTH, 14)\` on any reference to it changes
the one underlying object that reference points to, visible through
*every* other reference anyone else is holding. \`PromoCalendar\`'s author
called \`subscription.getRenewalDate()\` assuming they were getting a safe,
private copy to scratch on for an unrelated promo-window calculation -
but because \`Subscription\` never defensively copies anything, they were
actually mutating the subscription's own permanent, supposedly-immutable
internal state.

The fix is defensive copying on both the way in and the way out of any
class wrapping a mutable type:

\`\`\`java
public class Subscription {
    private final Calendar renewalDate;

    public Subscription(Calendar renewalDate) {
        this.renewalDate = (Calendar) renewalDate.clone();   // copy on the way in
    }

    public Calendar getRenewalDate() {
        return (Calendar) renewalDate.clone();   // copy on the way out
    }
}
\`\`\`

Migrating to \`java.time\`'s immutable types (\`LocalDate\`, \`Instant\`, and
similar) sidesteps the whole problem, since they can never be mutated by
any caller in the first place. The general rule: any class that stores
or returns a reference to a mutable object without copying it is
implicitly exposing its internal state to modification by anyone who
holds that reference - genuine encapsulation requires defensive copies
for both constructor arguments and getter return values whenever the
underlying type is mutable.`,
};
