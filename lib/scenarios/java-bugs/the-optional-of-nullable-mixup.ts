import type { Scenario } from "../types";

export const theOptionalOfNullableMixup: Scenario = {
  id: "the-optional-of-nullable-mixup",
  title: "The Optional.of Nullable Mixup",
  subtitle: "looking up a customer's middle name - a field that's optional by design - crashes the profile page for about a third of users",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 18,
  tags: ["java25", "optional", "null-handling"],
  briefing: `A recent refactor wrapped several nullable customer profile fields in
\`Optional\` for cleaner downstream code. Since then, roughly a third of
profile page loads throw an exception during rendering - always for
customers who never provided an optional field like middle name in the
first place, exactly the case \`Optional\` was supposed to handle
gracefully.`,
  constraints: [
    "The underlying customer record correctly and legitimately stores `null` for any optional field the customer never provided - this is expected, valid data, not a data-quality problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "profile-service", namespace: "accounts", labels: { app: "profile-service" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "profile-service-3p4q5r6s7-t8u9v", namespace: "accounts", labels: { app: "profile-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "profile-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "profile-service": [
            "2026-09-15T10:05:02.114Z ERROR c.e.accounts.ProfileMapper - java.lang.NullPointerException: Cannot invoke \"java.lang.String.trim()\" because \"value\" is null",
            "    at java.base/java.util.Optional.of(Optional.java:113)",
            "    at app//com.example.accounts.ProfileMapper.toDto(ProfileMapper.java:9)",
          ],
        },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "profile-mapper-notes", namespace: "accounts" },
        spec: {
          data: {
            "ProfileMapper.java.excerpt":
              "public ProfileDto toDto(Customer customer) {\n    // customer.middleName() legitimately returns null for any customer\n    // who never provided one\n    Optional<String> middleName = Optional.of(customer.middleName().trim());\n        // Optional.of(...) throws NullPointerException immediately if its\n        // argument is null - it does NOT tolerate null the way\n        // Optional.ofNullable(...) does\n    return new ProfileDto(middleName);\n}\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl logs profile-service-3p4q5r6s7-t8u9v -n accounts` - the NPE is thrown from inside `Optional.of`, the JDK's own code, not from application logic directly.",
    "`kubectl get configmap profile-mapper-notes -n accounts -o yaml` - `Optional.of(...)` and `Optional.ofNullable(...)` are two different factory methods with two very different behaviors for a `null` argument. Which one is actually being used here?",
    "`customer.middleName()` legitimately returns `null` for customers who never provided a middle name - and `.trim()` is called on that potentially-null value *before* it's even passed into `Optional.of(...)` at all.",
  ],
  options: [
    {
      id: "optional-of-throws-on-null-should-use-ofnullable",
      label:
        "`toDto` calls `Optional.of(customer.middleName().trim())` - but `customer.middleName()` legitimately returns `null` for any customer who never provided one, and calling `.trim()` on that `null` throws `NullPointerException` immediately, before `Optional.of(...)` (which itself would also throw on a null argument, being designed for values that must never be null) is ever even reached; the fix needs both a null-safe way to get the trimmed value and `Optional.ofNullable(...)` instead of `Optional.of(...)`, since the whole point of wrapping this field was to represent the legitimately-missing case safely.",
      explanation:
        "The stack trace shows the `NullPointerException` originates from `.trim()` being called on a null value, surfacing inside `Optional.of`'s own frame in the trace due to how the expression is evaluated inline. `ProfileMapper.java.excerpt` confirms `customer.middleName()` legitimately returns `null` for customers without one, and the code calls `.trim()` directly on that result before ever reaching `Optional.of(...)` - which itself is documented to throw `NullPointerException` immediately for a null argument, by design, since `Optional.of` exists specifically for values guaranteed never to be null. Using `Optional.of` here at all defeats the purpose of wrapping a legitimately-nullable field in `Optional` in the first place - the correct factory for a value that might genuinely be null is `Optional.ofNullable(...)`, and the `.trim()` call needs to happen only when a value is actually present.",
    },
    {
      id: "customer-middlename-field-corrupted-in-database",
      label: "The `middleName` field is being corrupted or improperly nulled in the customer database.",
      explanation:
        "The constraint confirms a `null` middle name is legitimate, expected data for any customer who never provided one - it isn't corruption or a data-quality issue; the bug is entirely in how the mapping code handles that expected, valid `null` value.",
    },
    {
      id: "profiledto-constructor-rejecting-empty-optional",
      label: "`ProfileDto`'s constructor rejects an empty `Optional` argument.",
      explanation:
        "The stack trace shows the exception thrown before `ProfileDto`'s constructor is ever reached - execution fails while still computing the `middleName` value to pass into it, specifically at the `.trim()`/`Optional.of()` call, not inside the DTO's own constructor logic.",
    },
    {
      id: "trim-method-doesnt-handle-unicode-whitespace",
      label: "`String.trim()` doesn't correctly handle certain Unicode whitespace characters in some middle names.",
      explanation:
        "The exception is thrown because `.trim()` is called on a `null` reference entirely, not because of any issue with the *content* of a non-null string - customers who provided a middle name (a genuine, non-null string) go through this exact same code path without any problem at all.",
    },
  ],
  correctOptionId: "optional-of-throws-on-null-should-use-ofnullable",
  resolution: `The stack trace shows the failure inside \`Optional.of\`'s own frame, with
the underlying cause being a \`.trim()\` call on a null value.
\`ProfileMapper.java.excerpt\` shows \`toDto\` calling
\`Optional.of(customer.middleName().trim())\` - and \`customer.middleName()\`
is confirmed to legitimately return \`null\` for any customer who never
provided one, which is expected, valid data, not a bug in the underlying
record. Calling \`.trim()\` directly on that potentially-null return value
throws \`NullPointerException\` immediately for any such customer, before
\`Optional.of(...)\` is ever reached at all - though even if the \`.trim()\`
call were removed, \`Optional.of(...)\` itself would still throw for a
null argument, since it's specifically documented and designed for
values that are guaranteed to never be null; that's precisely what
distinguishes it from \`Optional.ofNullable(...)\`, which safely wraps a
possibly-null value into an empty \`Optional\` instead. Using
\`Optional.of\` to wrap a field that's legitimately, expectedly nullable
defeats the entire purpose of introducing \`Optional\` for it in the first
place.

The fix is handling the possibly-null value safely before wrapping it,
and using the correct factory method:

\`\`\`java
public ProfileDto toDto(Customer customer) {
    Optional<String> middleName = Optional.ofNullable(customer.middleName())
        .map(String::trim);   // .trim() only runs if a value is actually present
    return new ProfileDto(middleName);
}
\`\`\`

The general rule: \`Optional.of(...)\` is for values that must never be
null - use it only when a null argument would itself indicate a bug
elsewhere. Any field or value that's legitimately, expectedly nullable
should be wrapped with \`Optional.ofNullable(...)\`, and any transformation
applied to it (like \`.trim()\`) should happen through \`Optional\`'s own
\`.map(...)\`, which safely skips the transformation entirely when the
value is absent, rather than being applied eagerly to a value that might
not exist.`,
};
