import type { Scenario } from "./types";

export const theRetryThatNeverRetried: Scenario = {
  id: "the-retry-that-never-retried",
  title: "The Retry That Never Retried",
  subtitle: "email-dispatch-service gives up on the first bounce from the mail provider, every time",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "resilience4j", "spring-boot"],
  briefing: `"email-dispatch-service" was configured with a Resilience4j retry policy
months ago specifically to ride out the mail provider's known brief
hiccups. During today's provider incident (a few minutes of 503s), every
single email failed permanently on the first attempt - the retry policy
never seemed to kick in at all, despite being clearly present in the
config.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "email-dispatch-service", namespace: "notifications", labels: { app: "email-dispatch-service" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "email-dispatch-service", image: "registry.internal/email-dispatch-service:4.1.2" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "20d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "email-dispatch-service-6o7p8q9r0-s1t2u", namespace: "notifications", labels: { app: "email-dispatch-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "email-dispatch-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "email-dispatch-service": [
            "2026-09-15T10:15:02.114Z ERROR c.e.notifications.MailProviderClient - send failed for msg-88213: org.springframework.web.client.HttpServerErrorException$ServiceUnavailable: 503 Service Unavailable",
            "2026-09-15T10:15:02.116Z ERROR c.e.notifications.EmailDispatcher - permanently failed to send msg-88213 after exhausting retries (attempts=1)",
          ],
        },
        age: "20d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "email-dispatch-service-notes", namespace: "notifications" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "resilience4j:\n  retry:\n    instances:\n      mailProvider:\n        max-attempts: 4\n        wait-duration: 500ms\n        retry-exceptions:\n          - java.net.SocketTimeoutException\n          - java.io.IOException\n        # HttpServerErrorException (and its ServiceUnavailable subclass)\n        # is not listed here at all\n",
          },
        },
        age: "20d",
      },
    ],
  },
  hints: [
    "`kubectl logs email-dispatch-service-6o7p8q9r0-s1t2u -n notifications` - `attempts=1` means the retry policy considered this failure exhausted after a single try. What kind of exception was actually thrown?",
    "`kubectl get configmap email-dispatch-service-notes -n notifications -o yaml` - `retry-exceptions` is an explicit allow-list. Is the exception type in the logs actually on it?",
    "Resilience4j's `@Retry` only retries exceptions matching `retry-exceptions` (or all exceptions, if that list is omitted entirely) - anything else propagates immediately on the first failure.",
  ],
  options: [
    {
      id: "retry-exceptions-allowlist-missing-the-actual-exception",
      label:
        "The `mailProvider` retry policy's `retry-exceptions` allow-list only includes `SocketTimeoutException` and generic `IOException`, but the mail provider's 503s surface as Spring's `HttpServerErrorException$ServiceUnavailable` - a type that was never added to the list - so Resilience4j correctly treats it as a non-retryable exception and gives up after the very first attempt, exactly as configured, just not as intended.",
      explanation:
        "The log shows the actual exception thrown is `HttpServerErrorException$ServiceUnavailable`, and the very next line reports `attempts=1` before declaring the message permanently failed. `email-dispatch-service-notes` shows `retry-exceptions` explicitly lists only `SocketTimeoutException` and `IOException` - `HttpServerErrorException` (and its subclasses) is absent from that list entirely, so Resilience4j's retry logic never engages for it; the policy isn't broken, it's just scoped to a different set of exceptions than the ones this provider actually throws for a 503.",
    },
    {
      id: "resilience4j-config-not-loaded",
      label: "The Resilience4j retry configuration isn't actually being loaded by the application at all.",
      explanation:
        "If the retry config weren't loaded at all, the failure log wouldn't reference an `attempts` count from the retry framework's own bookkeeping - `attempts=1` is Resilience4j itself reporting it decided not to retry, which means the config is present and active, just not matching this exception type.",
    },
    {
      id: "wait-duration-too-short",
      label: "The retry policy's 500ms wait-duration is too short to matter during a real outage.",
      explanation:
        "A too-short wait duration would still result in multiple attempts being made, just close together - `attempts=1` means no retry attempt happened at all, which points at the exception not matching the retry policy's criteria, not at the delay between attempts being too brief.",
    },
    {
      id: "circuit-breaker-blocking-retries",
      label: "A circuit breaker in front of the retry logic is short-circuiting every call before retry can run.",
      explanation:
        "There's no circuit breaker log line, open-state event, or short-circuit exception here - the log shows a real network exception being thrown and Resilience4j's retry bookkeeping deciding not to act on it, which is specifically a retry-exception-matching issue.",
    },
  ],
  correctOptionId: "retry-exceptions-allowlist-missing-the-actual-exception",
  resolution: `The log shows the real exception thrown during the incident:
\`HttpServerErrorException$ServiceUnavailable\` - Spring's client-side
representation of the mail provider's 503 response. The very next line
reports \`attempts=1\` before declaring the message permanently failed -
Resilience4j's own bookkeeping confirming it never made a second attempt.

\`email-dispatch-service-notes\` explains why: the \`mailProvider\` retry
instance's \`retry-exceptions\` is an explicit allow-list containing only
\`SocketTimeoutException\` and \`IOException\`. \`HttpServerErrorException\`
(and its \`ServiceUnavailable\` subclass) was never added to it - likely
because the policy was written with network-level timeouts in mind, not
HTTP-level error status codes. Resilience4j's \`@Retry\` only acts on
exceptions matching that list; anything else, including exactly the kind
of transient 503 this policy was meant to protect against, propagates
immediately on the very first failure.

The fix is adding the actual exception type the provider throws to the
allow-list:

\`\`\`yaml
resilience4j:
  retry:
    instances:
      mailProvider:
        max-attempts: 4
        wait-duration: 500ms
        retry-exceptions:
          - java.net.SocketTimeoutException
          - java.io.IOException
          - org.springframework.web.client.HttpServerErrorException
\`\`\`

Whenever a Resilience4j retry (or circuit breaker) policy scopes itself to
a specific exception allow-list, it's worth verifying that list actually
matches what the real client library throws for the failure modes it's
meant to cover - a policy that looks complete can still silently exclude
the exact exception it was built to catch.`,
};
