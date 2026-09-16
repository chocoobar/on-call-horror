import type { Scenario } from "./types";

export const theUnexpectedEnum: Scenario = {
  id: "the-unexpected-enum",
  title: "The Unexpected Enum",
  subtitle: "the webhook processor started crash-looping the moment the payment provider added a new status",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "enums", "external-api"],
  briefing: `"payment-webhook-handler" has been rock solid for over a year. This
morning, right after the payment provider's changelog mentions a new
transaction status they started sending, every webhook for that new
status type crashes the handler thread and the event is lost - never
retried, never logged as a business event, just gone.`,
  constraints: [
    "The payment provider's webhook payload format itself is unchanged and still valid JSON - only the *value* of one status field is new.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payment-webhook-handler", namespace: "payments", labels: { app: "payment-webhook-handler" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payment-webhook-handler-9g0h1i2j3-k4l5m", namespace: "payments", labels: { app: "payment-webhook-handler" } },
        status: { phase: "Running", containerStatuses: [{ name: "payment-webhook-handler", ready: true, restartCount: 3, state: { running: {} } }] },
        logs: {
          "payment-webhook-handler": [
            "2026-09-15T08:44:01.114Z ERROR c.e.payments.WebhookHandler - java.lang.IllegalArgumentException: No enum constant com.example.payments.TxnStatus.PARTIALLY_REFUNDED",
            "    at java.base/java.lang.Enum.valueOf(Enum.java:293)",
            "    at app//com.example.payments.TxnStatus.valueOf(TxnStatus.java:3)",
            "    at app//com.example.payments.WebhookHandler.handle(WebhookHandler.java:11)",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "payment-webhook-notes", namespace: "payments" },
        spec: {
          data: {
            "WebhookHandler.java.excerpt":
              "public enum TxnStatus {\n    PENDING, COMPLETED, FAILED, REFUNDED\n    // PARTIALLY_REFUNDED does not exist yet in our own enum\n}\n\npublic void handle(WebhookPayload payload) {\n    TxnStatus status = TxnStatus.valueOf(payload.status());   // throws for\n                                                                // any unrecognized value\n    process(status);\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs payment-webhook-handler-9g0h1i2j3-k4l5m -n payments` - `IllegalArgumentException: No enum constant ...PARTIALLY_REFUNDED` is thrown from inside `Enum.valueOf`.",
    "`kubectl get configmap payment-webhook-notes -n payments -o yaml` - does the application's own `TxnStatus` enum include every value the payment provider can now send?",
    "`Enum.valueOf(String)` throws `IllegalArgumentException` for any name that doesn't exactly match an existing constant - it never has, and never will, silently ignore or default an unrecognized value.",
  ],
  options: [
    {
      id: "enum-valueof-throws-on-unknown-value",
      label:
        "The application's own `TxnStatus` enum doesn't have a constant for the payment provider's new `PARTIALLY_REFUNDED` status - `TxnStatus.valueOf(payload.status())` throws `IllegalArgumentException` for any string that doesn't exactly match one of the enum's existing constants, uncaught here, crashing the handler thread every time this specific new status arrives while every previously-known status keeps working fine.",
      explanation:
        "The stack trace names the exact failure: `IllegalArgumentException: No enum constant ...TxnStatus.PARTIALLY_REFUNDED`, thrown from inside the JDK's own `Enum.valueOf`. `WebhookHandler.java.excerpt` confirms `TxnStatus` has no `PARTIALLY_REFUNDED` constant at all, and `handle` calls `TxnStatus.valueOf(payload.status())` with no try/catch around it - `Enum.valueOf` is documented to throw for any name it doesn't recognize, and it makes no exception for a value that's merely new from an external system's perspective rather than genuinely malformed.",
    },
    {
      id: "payment-provider-sending-malformed-payload",
      label: "The payment provider's webhook payload is malformed for this new status type.",
      explanation:
        "The exception is thrown from deep inside JSON-independent enum resolution logic, specifically because the status string is a legitimately new, well-formed value the application's own enum simply doesn't define yet - not because the payload itself failed to parse as valid JSON.",
    },
    {
      id: "webhook-handler-out-of-date-deployment",
      label: "An older version of payment-webhook-handler somehow got deployed, missing recent code.",
      explanation:
        "The reported deployment shows all replicas updated and ready on the current version - this isn't a deployment/rollout issue, it's that the current, correctly-deployed version's own enum genuinely doesn't include a status value the provider only started sending today.",
    },
    {
      id: "webhook-signature-verification-failing",
      label: "Webhook signature verification is failing for messages carrying the new status.",
      explanation:
        "The exception occurs during status parsing, well past any authentication/signature step - and the stack trace shows execution reached deep into business logic (`WebhookHandler.handle`), which wouldn't happen if signature verification had already rejected the request.",
    },
  ],
  correctOptionId: "enum-valueof-throws-on-unknown-value",
  resolution: `The stack trace is explicit: \`IllegalArgumentException: No enum constant
com.example.payments.TxnStatus.PARTIALLY_REFUNDED\`, thrown from the JDK's
own \`Enum.valueOf\`. \`WebhookHandler.java.excerpt\` shows exactly why:
\`TxnStatus\` is a closed set of four constants that doesn't include
\`PARTIALLY_REFUNDED\` at all, and \`handle\` calls
\`TxnStatus.valueOf(payload.status())\` directly, with nothing catching the
exception \`valueOf\` throws for any unrecognized name. This is standard,
documented \`Enum.valueOf\` behavior, not a bug in the JDK or in how the
payload is parsed - it's a mismatch between a closed internal enum and an
external system that's free to introduce new values on its own schedule,
with no obligation to notify (or coordinate with) any particular
consumer's code first.

The fix has two parts: add the new constant so it's understood going
forward, and handle unrecognized values gracefully so a *future* new
value from the provider doesn't crash the handler again:

\`\`\`java
public enum TxnStatus {
    PENDING, COMPLETED, FAILED, REFUNDED, PARTIALLY_REFUNDED, UNKNOWN
}

public void handle(WebhookPayload payload) {
    TxnStatus status;
    try {
        status = TxnStatus.valueOf(payload.status());
    } catch (IllegalArgumentException e) {
        log.warn("unrecognized transaction status '{}', treating as UNKNOWN", payload.status());
        status = TxnStatus.UNKNOWN;
    }
    process(status);
}
\`\`\`

The general rule: any enum whose values come from an external system you
don't control should never assume it has already seen every value that
system might ever send - parse defensively, with an explicit fallback,
rather than letting \`Enum.valueOf\`'s exception propagate uncaught.`,
};
