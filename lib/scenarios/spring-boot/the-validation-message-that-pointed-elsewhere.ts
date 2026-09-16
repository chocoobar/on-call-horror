import type { Scenario } from "../types";

export const theValidationMessageThatPointedElsewhere: Scenario = {
  id: "the-validation-message-that-pointed-elsewhere",
  title: "The Validation Message That Pointed Elsewhere",
  subtitle: "onboarding-api rejects a third of new signups with an error about a field that isn't even on the form",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "bean-validation", "spring-boot"],
  briefing: `Support is fielding complaints from new users whose signup gets rejected
with a 400 error mentioning "address.postalCode must not be blank" - but
the signup form doesn't collect a postal code at all on step one, and the
users insist they haven't reached the address step yet. It only affects
about a third of signups, seemingly at random.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "onboarding-api", namespace: "growth", labels: { app: "onboarding-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "onboarding-api", image: "registry.internal/onboarding-api:6.3.1" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "4d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "onboarding-api-6k5l4m3n2-o1p0q", namespace: "growth", labels: { app: "onboarding-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "onboarding-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "onboarding-api": [
            "2026-09-15T10:11:01.114Z WARN  o.s.w.s.m.s.DefaultHandlerExceptionResolver - Resolved MethodArgumentNotValidException: [Field error in object 'signupRequest' on field 'address.postalCode': rejected value [null]; default message [must not be blank]]",
            "2026-09-15T10:11:01.116Z INFO  c.e.growth.SignupController - rejecting signup req-40218 with 400 (validation failed)",
          ],
        },
        age: "4d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "onboarding-api-notes", namespace: "growth" },
        spec: {
          data: {
            "SignupRequest.java.excerpt":
              "public class SignupRequest {\n    @NotBlank\n    private String email;\n\n    @Valid  // cascades validation into nested Address, even when address\n            // itself is optional and null-by-default on step 1\n    private Address address; // no @NotNull here - can legitimately be\n                              // null on the step-1 partial submission\n}\n\npublic class Address {\n    @NotBlank\n    private String postalCode; // required whenever Address is present\n                                // at all - but the deserializer\n                                // constructs an empty Address object\n                                // instead of leaving it null when the\n                                // client omits the 'address' key but\n                                // includes an empty 'address: {}' block\n}\n",
          },
        },
        age: "4d",
      },
    ],
  },
  hints: [
    "`kubectl logs onboarding-api-6k5l4m3n2-o1p0q -n growth` - the validation error is about `address.postalCode`, a *nested* field. Is `address` itself required on this request?",
    "`kubectl get configmap onboarding-api-notes -n growth -o yaml` - `@Valid` on the `address` field cascades validation into `Address` whenever it's non-null. What happens if the client sends an empty `address: {}` instead of omitting the key entirely?",
    "About a third of clients are failing - check what's different about how those specific clients serialize an empty/optional nested object versus the others.",
  ],
  options: [
    {
      id: "cascaded-validation-on-empty-nested-object",
      label:
        "`@Valid` on `SignupRequest.address` cascades Bean Validation into the nested `Address` object whenever it's non-null; some step-1 form clients send `\"address\": {}` (an empty object) instead of omitting the key, which deserializes into a non-null `Address` with all its own fields empty - triggering `Address.postalCode`'s `@NotBlank` even though the step-1 form never intended to collect an address at all.",
      explanation:
        "The validation error explicitly targets the nested `address.postalCode` field, not anything on the actual step-1 form - a strong sign the nested object is being validated when it shouldn't be evaluated yet at all. `onboarding-api-notes` shows why: `address` has no `@NotNull`, so it's allowed to be entirely absent, but `@Valid` still cascades into it whenever it *is* present - and some clients send an empty `address: {}` object rather than omitting the field, which is enough to trigger the nested `@NotBlank` on `postalCode`, rejecting a signup that should have passed step 1 cleanly.",
    },
    {
      id: "postal-code-field-required-by-mistake",
      label: "The `postalCode` field was mistakenly marked required and should be optional everywhere.",
      explanation:
        "`postalCode` being required *whenever an address is actually supplied* is reasonable - the real problem is that an address object is being evaluated at all during a step where it shouldn't exist yet, not that the field's own required-ness within a real address is wrong.",
    },
    {
      id: "frontend-form-bug-sending-wrong-step",
      label: "The frontend is submitting the wrong form step's data entirely.",
      explanation:
        "The log shows a normal step-1 signup request being rejected over a nested field that step 1 was never meant to collect - the issue is server-side validation cascading into an object that's present-but-empty, not the frontend submitting an unrelated step's data.",
    },
    {
      id: "database-constraint-violation",
      label: "A database-level NOT NULL constraint on postal_code is rejecting the insert.",
      explanation:
        "The error is a `MethodArgumentNotValidException` resolved before the request ever reaches a repository or database call - this is Bean Validation running against the incoming request object itself, not a database constraint failing on a write.",
    },
  ],
  correctOptionId: "cascaded-validation-on-empty-nested-object",
  resolution: `The rejection is over \`address.postalCode\`, a field the step-1 signup
form never even shows - which points at the nested \`Address\` object being
validated when it shouldn't be evaluated at this stage at all.
\`onboarding-api-notes\` shows the mechanism: \`SignupRequest.address\` has no
\`@NotNull\`, so it's meant to be legitimately absent on a partial, step-1
submission - but it *is* annotated \`@Valid\`, which cascades Bean
Validation into \`Address\` whenever the field is non-null. Some client
implementations serialize an "I have nothing to send here yet" address as
an empty JSON object, \`"address": {}\`, rather than omitting the key
entirely. Jackson happily deserializes that into a non-null, all-fields-empty
\`Address\` instance - which is exactly enough to trigger \`Address\`'s own
\`@NotBlank\` on \`postalCode\`, rejecting a signup that a client omitting
the key outright would have sailed through.

The fix is making the cascade conditional on the address actually having
meaningful content, rather than merely being non-null:

\`\`\`java
@Valid
@AssertTrue(message = "address must be complete or entirely omitted")
private boolean isAddressValid() {
    return address == null || address.isComplete();
}
\`\`\`

or, more simply, treat an empty \`Address\` object the same as a missing
one during deserialization so the cascade never fires on it in the first
place. Either way, \`@Valid\` on an optional nested object needs an explicit
answer for "present but empty" - otherwise different clients' JSON
serialization habits silently decide which of your validation rules
actually apply.`,
};
