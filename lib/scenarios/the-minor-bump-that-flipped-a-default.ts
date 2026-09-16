import type { Scenario } from "./types";

export const theMinorBumpThatFlippedADefault: Scenario = {
  id: "the-minor-bump-that-flipped-a-default",
  title: "The Minor Bump That Flipped a Default",
  subtitle: "partner-webhook-ingest starts rejecting every payload from one specific integration after a routine patch bump",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "jackson", "spring-boot"],
  briefing: `A routine Spring Boot patch bump (3.3.4 -> 3.3.5) went out to
"partner-webhook-ingest" overnight with no code changes of its own. This
morning, every webhook from one particular partner - the one whose
payloads always include a couple of extra, undocumented fields their
system started adding last year - is being rejected with a 400. Every
other partner's webhooks are unaffected.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "partner-webhook-ingest", namespace: "integrations", labels: { app: "partner-webhook-ingest" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "partner-webhook-ingest", image: "registry.internal/partner-webhook-ingest:9.12.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "partner-webhook-ingest-2m3n4o5p6-q7r8s", namespace: "integrations", labels: { app: "partner-webhook-ingest" } },
        status: { phase: "Running", containerStatuses: [{ name: "partner-webhook-ingest", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "partner-webhook-ingest": [
            "2026-09-15T06:15:02.884Z WARN  o.s.w.s.m.s.DefaultHandlerExceptionResolver - Resolved HttpMessageNotReadableException: JSON parse error: Unrecognized field \"shippingHintCode\" (class com.example.integrations.WebhookPayload), not marked as ignorable",
            "2026-09-15T06:15:02.886Z INFO  c.e.integrations.WebhookController - rejecting webhook from partner-globex with 400 (malformed payload)",
          ],
        },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "partner-webhook-ingest-notes", namespace: "integrations" },
        spec: {
          data: {
            "CHANGELOG.excerpt":
              "Spring Boot 3.3.5's dependency management bumped the managed\njackson-databind version. Between the two patch versions this app moved\nbetween, an internal default in Spring Boot's own Jackson\nauto-configuration for `spring.jackson.deserialization.fail-on-unknown-properties`\nchanged from effectively unset (Jackson's own default: false) to\nexplicitly `true` in one intermediate release, then partially reverted -\nleaving `WebhookPayload`, which has no explicit `@JsonIgnoreProperties`\nof its own, newly strict about fields it used to silently ignore.",
          },
        },
        age: "10h",
      },
    ],
  },
  hints: [
    "`kubectl logs partner-webhook-ingest-2m3n4o5p6-q7r8s -n integrations` - the rejection is a JSON parse error about an *unrecognized* field, not a missing required one. What changed about how strict deserialization is?",
    "Only partner-globex's webhooks are affected - what's different about their payload compared to every other partner's?",
    "`kubectl get configmap partner-webhook-ingest-notes -n integrations -o yaml` - no application code changed, only the Spring Boot patch version. What does that changelog say moved as a transitive default?",
  ],
  options: [
    {
      id: "fail-on-unknown-properties-now-strict",
      label:
        "The Spring Boot patch bump changed the effective default for Jackson's `fail-on-unknown-properties` deserialization setting, making `WebhookPayload` (which has no `@JsonIgnoreProperties` of its own) newly strict about fields it used to silently ignore - so partner-globex's payloads, which have always included a couple of extra undocumented fields, now fail to deserialize entirely, while every other partner's leaner payloads pass through unaffected.",
      explanation:
        "The error is explicit: `Unrecognized field \"shippingHintCode\" ... not marked as ignorable` - this is Jackson refusing an unknown field, not rejecting a malformed or missing one. `partner-webhook-ingest-notes` confirms the mechanism: the patch bump shifted the effective default for unknown-property handling, and `WebhookPayload` was never given its own explicit `@JsonIgnoreProperties(ignoreUnknown = true)` to guard against exactly this. Only partner-globex is affected because they're the only integration whose payloads actually contain extra fields the DTO doesn't declare - everyone else's leaner payloads happen to already match the DTO exactly.",
    },
    {
      id: "partner-globex-changed-their-payload",
      label: "partner-globex changed their webhook payload format overnight, coincidentally at the same time as the deploy.",
      explanation:
        "The extra field, `shippingHintCode`, is described as something their system has sent for over a year, unchanged - the timing lines up precisely with this service's own patch deploy, not with any change on the partner's side, and the changelog confirms a relevant Jackson default shifted in that exact release.",
    },
    {
      id: "webhookpayload-schema-corrupted",
      label: "The WebhookPayload DTO's schema got corrupted or malformed during the deploy.",
      explanation:
        "There's no indication the DTO's own fields are broken - the error is specifically about an *extra*, previously-tolerated field now being rejected, which is a deserialization strictness setting, not a corrupted or malformed class definition.",
    },
    {
      id: "webhook-signature-validation-failing",
      label: "Webhook signature validation is failing for partner-globex due to a key rotation issue.",
      explanation:
        "The logged error is a JSON deserialization failure (`HttpMessageNotReadableException`) happening before any business logic runs, not an authentication or signature-verification failure - those would produce a distinct 401/403 and a different exception type entirely.",
    },
  ],
  correctOptionId: "fail-on-unknown-properties-now-strict",
  resolution: `The rejection log is unambiguous about what kind of failure this is:
\`Unrecognized field "shippingHintCode" ... not marked as ignorable\` - a
strict-deserialization failure over an *extra* field, not a missing or
malformed one. \`partner-webhook-ingest-notes\` connects it to the overnight
deploy: the Spring Boot patch bump shifted the managed jackson-databind
version, and along with it, the effective default for
\`spring.jackson.deserialization.fail-on-unknown-properties\` in Spring
Boot's own Jackson auto-configuration. \`WebhookPayload\` was never given
its own explicit \`@JsonIgnoreProperties\`, so it inherited whatever the
framework's current default happened to be - and that default just became
noticeably stricter.

Only partner-globex is affected because they're the one integration whose
payloads genuinely contain fields \`WebhookPayload\` doesn't declare -
\`shippingHintCode\` among them, present in their payloads for over a year
without ever causing a problem, because unknown fields used to be quietly
ignored.

The fix is making the DTO's tolerance for unknown fields an explicit,
version-independent decision rather than an inherited framework default:

\`\`\`java
@JsonIgnoreProperties(ignoreUnknown = true)
public class WebhookPayload {
    // ...
}
\`\`\`

Any DTO deserializing payloads from an external party that isn't fully
under this team's control should make its unknown-field policy explicit -
relying on whatever a framework's current default happens to be means a
routine patch bump can silently change which payloads are considered
valid.`,
};
