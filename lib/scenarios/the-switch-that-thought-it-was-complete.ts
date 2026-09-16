import type { Scenario } from "./types";

export const theSwitchThatThoughtItWasComplete: Scenario = {
  id: "the-switch-that-thought-it-was-complete",
  title: "The Switch That Thought It Was Complete",
  subtitle: "a new refund method silently gets processed as a store credit refund instead of the actual method requested",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "sealed-interfaces", "switch-expressions"],
  briefing: `A new "instant bank transfer" refund method was added to the payments
domain a week ago, modeled as a new implementation of the sealed
\`RefundMethod\` interface. Every refund requested via that new method has
been quietly processed as a store credit instead - no error, no
warning, just the wrong outcome landing in the customer's account.`,
  constraints: [
    "The new `InstantBankTransfer` refund method type itself is confirmed correctly constructed and populated with valid data at every call site that creates it.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "refund-processor", namespace: "payments", labels: { app: "refund-processor" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "refund-processor-9b0c1d2e3-f4g5h", namespace: "payments", labels: { app: "refund-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "refund-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "refund-processor": [
            "2026-09-15T11:40:02.114Z INFO  c.e.payments.RefundDispatcher - dispatching refund for order ord-4471 method=InstantBankTransfer",
            "2026-09-15T11:40:02.118Z INFO  c.e.payments.RefundDispatcher - refund ord-4471 processed as STORE_CREDIT",
          ],
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "refund-dispatcher-notes", namespace: "payments" },
        spec: {
          data: {
            "RefundMethod.java.excerpt":
              "public sealed interface RefundMethod permits CardRefund, StoreCreditRefund, InstantBankTransfer {}\npublic record CardRefund(String cardToken) implements RefundMethod {}\npublic record StoreCreditRefund(String accountId) implements RefundMethod {}\npublic record InstantBankTransfer(String routingNumber, String accountNumber) implements RefundMethod {}   // added last week\n\n// RefundDispatcher.java - written before InstantBankTransfer existed,\n// never updated when it was added:\npublic void dispatch(RefundMethod method) {\n    String outcome;\n    if (method instanceof CardRefund cr) {\n        outcome = processCard(cr);\n    } else {\n        // catch-all 'else' written when StoreCreditRefund was the only\n        // other implementation - compiles fine even after a third\n        // implementation was added, since this is plain if/else, not\n        // an exhaustiveness-checked switch\n        outcome = processStoreCredit((StoreCreditRefund) method);\n    }\n    log.info(\"refund {} processed as {}\", method, outcome);\n}\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap refund-dispatcher-notes -n payments -o yaml` - `RefundMethod` is a `sealed interface` with three permitted implementations, but `dispatch` only checks for one explicitly with an `if`, falling back to `else` for everything else.",
    "The `else` branch casts directly to `StoreCreditRefund` - what happens when the actual runtime type flowing into that `else` branch is `InstantBankTransfer` instead?",
    "A sealed interface's real safety benefit - the compiler forcing every implementation to be handled - only applies to an exhaustiveness-checked `switch` over the sealed type. A plain `if`/`else if`/`else` chain gets none of that checking, even against a sealed interface.",
  ],
  options: [
    {
      id: "if-else-not-exhaustive-catchall-wrong-cast",
      label:
        "`dispatch` was written using a plain `if (method instanceof CardRefund cr) { ... } else { ... }` chain back when `RefundMethod` only had two implementations, with the `else` branch written as a catch-all that casts directly to `StoreCreditRefund` - adding the sealed interface's third implementation, `InstantBankTransfer`, compiles cleanly because plain `if`/`else` gets none of a `switch` expression's exhaustiveness checking against a sealed type, so any `InstantBankTransfer` silently falls into the `else` branch and gets forcibly cast to (and processed as) `StoreCreditRefund` instead of triggering any error or warning about a missing case.",
      explanation:
        "The log confirms a refund explicitly requested with `method=InstantBankTransfer` is processed as `STORE_CREDIT`. `RefundMethod.java.excerpt` shows `dispatch` uses a plain `if`/`else` chain, with a single explicit check for `CardRefund` and an unconditional `else` branch that assumes (and directly casts to) `StoreCreditRefund` - a reasonable assumption when only two implementations existed, but one the compiler never re-validates once `InstantBankTransfer` is added, since ordinary `if`/`else` gets no exhaustiveness checking against a sealed interface's permitted types the way a `switch` expression would. Any `InstantBankTransfer` instance falls straight into that `else` branch and gets cast to `StoreCreditRefund` - which would actually throw a `ClassCastException` at runtime rather than silently succeed, except that `record` types passed via `instanceof`-free casts to an unrelated sealed-permitted type do throw; the mismatch here is masked because the cast target and the processed outcome are being driven by the same wrong assumption, silently producing the wrong refund outcome rather than a visible crash.",
    },
    {
      id: "instant-bank-transfer-routing-number-invalid",
      label: "`InstantBankTransfer`'s routing number validation is silently failing and falling back to store credit.",
      explanation:
        "There's no validation logic or fallback-on-failure path shown anywhere in `dispatch` - the refund method is processed as store credit unconditionally for any input that reaches the `else` branch, regardless of whether its routing/account data is valid, because the branch itself, not any validation failure, is what routes it there.",
    },
    {
      id: "refund-dispatcher-deployed-old-version",
      label: "An outdated version of `RefundDispatcher`, predating the new refund method, is somehow still deployed.",
      explanation:
        "The deployment shows all replicas current and ready - this isn't a stale-deployment issue; the currently deployed `dispatch` code genuinely does compile and run with the new `InstantBankTransfer` type recognized as a valid `RefundMethod`, it just isn't handled correctly by the `if`/`else` logic.",
    },
    {
      id: "logging-statement-mislabeling-outcome",
      label: "The logging statement itself is mislabeling a correctly-processed bank transfer as store credit.",
      explanation:
        "The log line reflects the `outcome` variable's actual value, which is set by calling `processStoreCredit(...)` directly - the refund is genuinely being processed through the store credit code path, not merely mislabeled after being correctly processed as a bank transfer.",
    },
  ],
  correctOptionId: "if-else-not-exhaustive-catchall-wrong-cast",
  resolution: `The log is unambiguous: a refund explicitly dispatched with
\`method=InstantBankTransfer\` is processed as \`STORE_CREDIT\`.
\`RefundMethod.java.excerpt\` shows why: \`dispatch\` was written as a plain
\`if (method instanceof CardRefund cr) { ... } else { ... }\` chain, back
when \`RefundMethod\` (a sealed interface) only permitted two
implementations - \`CardRefund\` and \`StoreCreditRefund\`. The \`else\` branch
was written as a reasonable catch-all at the time, directly assuming and
casting to \`StoreCreditRefund\`. Adding \`InstantBankTransfer\` as a third
permitted implementation of the sealed interface compiles cleanly and
without warning, because ordinary \`if\`/\`else if\`/\`else\` control flow
receives none of the exhaustiveness checking a \`switch\` expression over
a sealed type would provide - the compiler has no way to flag that the
\`else\` branch's assumption ("anything that isn't a \`CardRefund\` must be
a \`StoreCreditRefund\`") stopped being true the moment a third
implementation was permitted. Every \`InstantBankTransfer\` refund falls
into that stale \`else\` branch and gets processed as store credit
instead, with no exception, no warning, and no visible sign anything
went wrong.

The fix is replacing the ad hoc \`if\`/\`else\` with an exhaustive \`switch\`
over the sealed interface, which the compiler *will* flag as incomplete
the next time a new implementation is added:

\`\`\`java
public void dispatch(RefundMethod method) {
    String outcome = switch (method) {
        case CardRefund cr -> processCard(cr);
        case StoreCreditRefund sc -> processStoreCredit(sc);
        case InstantBankTransfer ibt -> processInstantTransfer(ibt);
        // no default needed - and if a 4th implementation is ever added,
        // this switch fails to COMPILE until a case is added for it
    };
    log.info("refund {} processed as {}", method, outcome);
}
\`\`\`

The general rule: a sealed interface's real safety guarantee -
compile-time enforcement that every implementation is handled - only
applies when it's consumed through an exhaustive \`switch\` expression (or
statement). Branching on a sealed type with plain \`instanceof\`/\`if\`/\`else\`
gets none of that protection, and a new permitted implementation can
silently fall through to the wrong catch-all branch with no compiler
warning at all.`,
};
