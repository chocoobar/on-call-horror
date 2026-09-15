import type { Scenario } from "./types";

export const theOptionalThatWasnt: Scenario = {
  id: "the-optional-that-wasnt",
  title: "The Optional That Wasn't",
  subtitle: "checkout throws a 500 for exactly one category of customer, and only them",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "optional", "production-bug"],
  briefing: `Guest checkout (no account, no saved shipping address) has thrown a 500
error for every single attempt for the last two days. Logged-in customer
checkout, which is the overwhelming majority of traffic and the only
thing QA regularly tests, works perfectly.`,
  constraints: [
    "This started right after a routine release two days ago that added support for saving a preferred shipping address to logged-in accounts - a feature that has nothing to do with guest checkout on the surface.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-api-1a2b3c4d5-e6f7g", namespace: "checkout", labels: { app: "checkout-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-api": [
            "2026-09-15T10:00:01.114Z ERROR c.e.checkout.ShippingResolver - java.util.NoSuchElementException: No value present",
            "    at java.base/java.util.Optional.get(Optional.java:143)",
            "    at app//com.example.checkout.ShippingResolver.resolvePreferredAddress(ShippingResolver.java:22)",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-shipping-notes", namespace: "checkout" },
        spec: {
          data: {
            "ShippingResolver.java.excerpt":
              "public Address resolvePreferredAddress(Customer customer) {\n    Optional<Address> preferred = customer.getPreferredAddress();\n    // new in this release: prefer the saved address if one exists\n    return preferred.get();   // <-- added without checking isPresent()/isEmpty() first\n}\n",
            "notes.md":
              "`Customer.getPreferredAddress()` returns `Optional.empty()` for guest\ncheckout customers (who have no account and therefore no saved\naddress), and a populated `Optional` for logged-in customers who've\nsaved one. QA's checkout test suite exclusively uses seeded logged-in\ntest accounts that already have a preferred address saved, so this code\npath has only ever been exercised with a present value during testing.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl logs checkout-api-1a2b3c4d5-e6f7g -n checkout` - `Optional.get()` throwing `NoSuchElementException` means exactly one specific thing about the `Optional` it was called on.",
    "`kubectl get configmap checkout-shipping-notes -n checkout -o yaml` - for which category of customer does `getPreferredAddress()` return an empty `Optional`, by design?",
    "QA's test accounts are described as always having a saved address - would their tests ever actually exercise the empty case, even if they ran this exact code path constantly?",
  ],
  options: [
    {
      id: "optional-get-without-presence-check",
      label:
        "`resolvePreferredAddress` calls `Optional.get()` directly with no `isPresent()`/`isEmpty()` check first - `Customer.getPreferredAddress()` returns an empty `Optional` by design for guest checkout customers (who have no account and no saved address), so every guest checkout hits `Optional.get()` on an empty `Optional` and throws `NoSuchElementException`, while every logged-in test account QA uses always has a saved address and never exercises the empty path at all.",
      explanation:
        "The stack trace names the exact call site - `Optional.get()` inside `resolvePreferredAddress`, thrown with the standard `NoSuchElementException: No value present` message that `Optional.get()` always throws on an empty `Optional`. `checkout-shipping-notes` confirms `getPreferredAddress()` returns empty specifically and only for guest customers, by design - and separately confirms QA's test suite exclusively uses seeded accounts that already have a saved address, meaning this exact code path has genuinely never been exercised against an empty `Optional` before reaching production. This explains the precise symptom: total, 100% failure for guest checkout specifically, zero impact on logged-in checkout, starting exactly with the release that added this unguarded `.get()` call.",
    },
    {
      id: "database-missing-guest-records",
      label: "The database is missing address records for guest customers.",
      explanation:
        "Guest customers have no account and are never expected to have a saved address record at all - that's the intended, correct state, not a data-integrity gap. The bug is in code assuming a value is always present, not in any data that's supposedly missing when it should exist.",
    },
    {
      id: "customer-object-not-populated-for-guests",
      label: "The `Customer` object itself isn't being populated correctly for guest checkout sessions.",
      explanation:
        "The stack trace shows the failure specifically inside `Optional.get()`, called successfully on a `Customer` object that was retrieved and used just fine to call `getPreferredAddress()` on - the `Customer` object itself is present and working; it's the *result* of one specific method call on it that's correctly empty and then mishandled.",
    },
    {
      id: "concurrent-checkout-race",
      label: "Concurrent checkout attempts by the same guest are racing and corrupting shared state.",
      explanation:
        "The failure is total and deterministic for every single guest checkout attempt, individually, with no dependency on concurrency or timing - a straightforward, always-reproducible null/empty-value bug, not an intermittent race condition.",
    },
  ],
  correctOptionId: "optional-get-without-presence-check",
  resolution: `The stack trace names the exact problem: \`Optional.get()\`, thrown with
\`NoSuchElementException: No value present\` - the specific, standard
exception \`Optional.get()\` always throws when called on an empty
\`Optional\`. \`ShippingResolver.java.excerpt\` shows the new code added this
release calls \`.get()\` directly with no presence check beforehand.
\`checkout-shipping-notes\` confirms \`getPreferredAddress()\` is designed to
return \`Optional.empty()\` for exactly one category of customer: guests,
who by definition have no account and therefore nothing to have saved.
Every guest checkout attempt hits this code path, gets an empty
\`Optional\`, and crashes immediately and totally - while every logged-in
customer (all of QA's seeded test accounts included) always has a saved
address by the time this code runs, so the empty case was never
exercised anywhere before this shipped to production.

\`Optional\` exists specifically to force a decision about the missing-value
case at compile time in a way a bare, nullable return type doesn't as
clearly - calling \`.get()\` without checking presence first defeats that
entire purpose and reintroduces the same class of bug \`Optional\` is meant
to help avoid. The fix is handling the empty case explicitly, with real
fallback behavior for guest checkout:

\`\`\`java
public Address resolvePreferredAddress(Customer customer) {
    return customer.getPreferredAddress()
        .orElseGet(this::promptForNewAddress);   // guest / no-saved-address path
}
\`\`\`

Any \`Optional\` returned from a method whose documentation (or, as here,
domain logic) makes clear it can legitimately be empty needs its empty
case handled at every call site - \`.get()\` should be reserved for
situations where absence would itself indicate a bug elsewhere, not for a
value that's expected to be empty under completely normal, everyday
conditions like guest checkout.`,
};
