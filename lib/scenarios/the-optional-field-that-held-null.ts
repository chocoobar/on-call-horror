import type { Scenario } from "./types";

export const theOptionalFieldThatHeldNull: Scenario = {
  id: "the-optional-field-that-held-null",
  title: "The Optional Field That Held Null",
  subtitle: "the referral-bonus check throws an NPE on a call that the type signature seemed to promise couldn't happen",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "optional", "null-handling"],
  briefing: `"referral-service" checks whether a customer has an active referral code
before applying a signup bonus. New customers who signed up without
being referred by anyone crash the signup flow with a
NullPointerException, even though the field holding their referral
information is typed `Optional<ReferralCode>` - a type that's supposed
to make "no value" an explicit, safe, non-null case.`,
  constraints: [
    "`Optional<ReferralCode>` is confirmed to be the field's declared type everywhere it's used - this isn't a case of a plain nullable field being mistaken for an `Optional` somewhere.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "referral-service", namespace: "growth", labels: { app: "referral-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "referral-service-4v5w6x7y8-z9a0b", namespace: "growth", labels: { app: "referral-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "referral-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "referral-service": [
            "2026-09-15T13:00:08.114Z ERROR c.e.growth.ReferralChecker - java.lang.NullPointerException: Cannot invoke \"java.util.Optional.isPresent()\" because \"customer.referralCode\" is null",
            "    at app//com.example.growth.ReferralChecker.hasActiveReferral(ReferralChecker.java:8)",
          ],
        },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "referral-checker-notes", namespace: "growth" },
        spec: {
          data: {
            "Customer.java.excerpt":
              "public class Customer {\n    // field is typed Optional<ReferralCode>, but nothing enforces it\n    // is ever actually assigned a real Optional instance\n    public Optional<ReferralCode> referralCode;\n\n    public Customer(String name) {\n        this.name = name;\n        // referralCode is left completely unassigned here for customers\n        // who signed up without a referrer - defaults to null, not\n        // Optional.empty()\n    }\n}\n\n// ReferralChecker.java:\npublic boolean hasActiveReferral(Customer customer) {\n    return customer.referralCode.isPresent() && customer.referralCode.get().isActive();\n}\n",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl logs referral-service-4v5w6x7y8-z9a0b -n growth` - the exception message says `\"customer.referralCode\" is null`, not that the `Optional` is empty. Those are two very different things.",
    "`kubectl get configmap referral-checker-notes -n growth -o yaml` - does `Customer`'s constructor ever actually assign `referralCode` for a customer with no referrer?",
    "`Optional<T>` being the declared type of a field doesn't prevent that field from holding a literal `null` reference instead of an actual `Optional` instance (whether empty or populated) - the type system allows it, even though it defeats the entire purpose of using `Optional`.",
  ],
  options: [
    {
      id: "optional-typed-field-left-null-instead-of-empty",
      label:
        "`Customer.referralCode` is typed `Optional<ReferralCode>`, but for a customer with no referrer, the constructor simply never assigns it anything at all, leaving it at its default value of `null` - a literal null reference, not `Optional.empty()` - so `hasActiveReferral` calling `.isPresent()` directly on that field throws a `NullPointerException` for exactly the customers `Optional` was supposed to safely represent: the ones with no referral code.",
      explanation:
        "The exception message is explicit: `\"customer.referralCode\" is null` - not that the `Optional` reports itself empty, but that the field itself holds no `Optional` object at all. `Customer.java.excerpt` confirms the constructor never assigns `referralCode` for a customer with no referrer, so it defaults to `null` like any unassigned reference-type field would. `ReferralChecker.java.excerpt` calls `customer.referralCode.isPresent()` directly, assuming the field always holds a real `Optional` instance (empty or populated) - which is exactly the assumption `Optional`'s design is meant to make safe, but only if every code path that constructs a `Customer` actually honors it by assigning `Optional.empty()` instead of leaving the field unassigned.",
    },
    {
      id: "referralcode-active-flag-not-set",
      label: "`ReferralCode.isActive()` doesn't handle a newly created, not-yet-activated code correctly.",
      explanation:
        "The stack trace shows the exception is thrown at the `.isPresent()` call itself, before `.get().isActive()` is ever reached - execution never gets far enough to call `isActive()` at all for the failing case.",
    },
    {
      id: "database-migration-missing-default-value",
      label: "A database migration failed to backfill a default referral code value for existing customers.",
      explanation:
        "This is a `NullPointerException` thrown directly during `Customer` object construction and immediately afterward, before any database read of a persisted value is shown in this path - the null originates in application code's own default field state, not from a missing database column value.",
    },
    {
      id: "concurrent-customer-signup-race",
      label: "Concurrent signup requests are racing and leaving `referralCode` in an inconsistent state.",
      explanation:
        "This is a fully deterministic failure for any customer signing up without a referrer, reproducible every single time regardless of concurrent load - it needs no race condition to explain it, since the field is simply never assigned in that code path at all.",
    },
  ],
  correctOptionId: "optional-typed-field-left-null-instead-of-empty",
  resolution: `The exception message is precise and easy to misread quickly:
\`"customer.referralCode" is null\` - not "the Optional is empty," but
that the field itself holds no \`Optional\` object whatsoever.
\`Customer.java.excerpt\` shows why: the constructor only ever assigns
\`referralCode\` implicitly for customers with a referrer (elsewhere in
code not shown here) - for a customer with no referrer, it's simply
never assigned anything at all, and defaults to \`null\` exactly like any
other unassigned reference-type field would, regardless of its declared
type being \`Optional<ReferralCode>\`. Declaring a field's type as
\`Optional<T>\` does nothing on its own to prevent that field from holding
a literal \`null\` - the whole safety \`Optional\` is meant to provide only
holds if every code path constructing the object actually assigns
\`Optional.empty()\` for the "no value" case, rather than leaving the field
at its default. \`ReferralChecker.hasActiveReferral\` calls
\`customer.referralCode.isPresent()\` directly, trusting that assumption -
which fails exactly for the customers this whole mechanism was supposed
to safely represent.

The fix is two-fold: always assign `Optional.empty()` explicitly, and
defend against a stray null at the point of use too:

\`\`\`java
public Customer(String name) {
    this.name = name;
    this.referralCode = Optional.empty();   // explicit, never left unassigned
}

// defensively, at the point of use:
public boolean hasActiveReferral(Customer customer) {
    return Optional.ofNullable(customer.referralCode)
        .flatMap(opt -> opt)
        .map(ReferralCode::isActive)
        .orElse(false);
}
\`\`\`

The general rule: \`Optional\` only delivers on its promise of eliminating
null-related bugs if every code path that could produce "no value"
explicitly constructs \`Optional.empty()\` - the type system does nothing
to enforce this on its own, and an `Optional`-typed field left
unassigned is just as capable of holding a literal `null` as any other
reference type.`,
};
