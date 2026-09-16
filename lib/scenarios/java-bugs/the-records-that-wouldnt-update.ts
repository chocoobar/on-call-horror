import type { Scenario } from "../types";

export const theRecordsThatWouldntUpdate: Scenario = {
  id: "the-records-that-wouldnt-update",
  title: "The Records That Wouldn't Update",
  subtitle: "feature-flags-cache never reflects a flag change, even seconds after it's flipped",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "records", "caching"],
  briefing: `"feature-flags-cache" is supposed to keep an in-memory cache of feature
flag states in sync with the config service, refreshed on every flag
change via a webhook. Every webhook is confirmed to be received and
processed without any error - but the in-memory cache read by the rest of
the application never actually changes, no matter how many times a flag
is flipped.`,
  constraints: [
    "The webhook handler itself runs successfully end to end every time, with no exceptions - the code that's supposed to update the cache genuinely executes without failing.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "feature-flags-cache", namespace: "platform", labels: { app: "feature-flags-cache" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "feature-flags-cache-2h3i4j5k6-l7m8n", namespace: "platform", labels: { app: "feature-flags-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "feature-flags-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "feature-flags-cache": [
            "2026-09-15T09:00:01.114Z INFO  c.e.flags.WebhookHandler - received flag update: new-checkout-enabled=true",
            "2026-09-15T09:00:01.120Z INFO  c.e.flags.WebhookHandler - cache updated for flag 'new-checkout-enabled'",
            "2026-09-15T09:00:05.204Z DEBUG c.e.flags.FlagReader - read flag 'new-checkout-enabled': current value=false",
          ],
        },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "feature-flags-cache-notes", namespace: "platform" },
        spec: {
          data: {
            "WebhookHandler.java.excerpt":
              "public record FlagState(String name, boolean enabled) {\n    public FlagState withEnabled(boolean newValue) {\n        return new FlagState(name, newValue);   // records are immutable -\n        // this returns a brand-new instance, it does not mutate `this`\n    }\n}\n\nprivate final Map<String, FlagState> cache = new ConcurrentHashMap<>();\n\npublic void handleWebhook(String flagName, boolean newValue) {\n    FlagState current = cache.get(flagName);\n    current.withEnabled(newValue);   // <-- return value discarded entirely\n    log.info(\"cache updated for flag '{}'\", flagName);\n}\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap feature-flags-cache-notes -n platform -o yaml` - `withEnabled(...)` returns something. Is that return value actually used anywhere in `handleWebhook`?",
    "A `record` in Java is immutable by definition - calling a method on a record instance can never change that instance's own fields, it can only ever produce and return a *new* instance with different values.",
    "The log line says \"cache updated\" right after calling `withEnabled(...)` - is that log line actually verifying anything, or just asserting it happened regardless of whether the call's result went anywhere?",
  ],
  options: [
    {
      id: "record-immutability-discarded-return-value",
      label:
        "`FlagState` is an immutable `record`, so `current.withEnabled(newValue)` returns a brand-new `FlagState` instance rather than modifying `current` in place - `handleWebhook` calls it and discards the returned new instance entirely, never storing it back into `cache`, so the map keeps holding the original, unchanged `FlagState` forever regardless of how many times the webhook successfully 'updates' it.",
      explanation:
        "`WebhookHandler.java.excerpt` shows exactly this: `current.withEnabled(newValue)` is called for its return value, which is then never assigned to anything or put back into `cache` - it's simply discarded. Records are immutable by design specifically so that calling a method like `withEnabled` can never mutate the receiver in place; it can only ever return a new, independent instance representing the changed state. The webhook handler runs successfully, logs a reassuring \"cache updated\" message, and genuinely never touches an exception anywhere - it just never actually stores the new value anywhere a subsequent read would see it, which is exactly why `FlagReader` keeps reading the original, stale value no matter how many webhooks arrive.",
    },
    {
      id: "webhook-payload-not-parsed-correctly",
      label: "The webhook payload isn't being parsed correctly, so the wrong flag name is being updated.",
      explanation:
        "The log line confirms the correct flag name (`new-checkout-enabled`) is being read from the webhook and referenced throughout - the parsing itself is correct; the problem is what happens (or rather, doesn't happen) to the cache after the correct flag name and value are already known.",
    },
    {
      id: "concurrenthashmap-not-thread-safe-here",
      label: "`ConcurrentHashMap` isn't providing the thread-safety guarantees needed here.",
      explanation:
        "This isn't a concurrency or thread-safety problem at all - the failure is completely deterministic and reproducible every single time, by a single webhook call in isolation with no concurrent access involved, which points at the update never being written back to the map rather than at a race condition between concurrent writers.",
    },
    {
      id: "flagreader-caching-its-own-stale-copy",
      label: "`FlagReader` has its own separate, stale cached copy of the flags, independent of the webhook handler's cache.",
      explanation:
        "There's no indication of a second, independent cache layer here - `FlagReader` is described as reading from the same shared `cache` map that `handleWebhook` is supposed to update; the actual problem is that the update to that one shared map's stored value never happens at all, not that a separate copy elsewhere is out of sync with a correctly-updated original.",
    },
  ],
  correctOptionId: "record-immutability-discarded-return-value",
  resolution: `\`WebhookHandler.java.excerpt\` contains the whole bug in three lines:
\`current.withEnabled(newValue)\` is called, its return value is never
assigned to anything, and execution moves straight on to logging a
success message. \`FlagState\` is declared as a Java \`record\`, which is
immutable by specification - every field is final, and there is no
mechanism by which calling a method on a record instance can modify that
instance's own state. \`withEnabled\` does exactly what an immutable
"wither" method is supposed to do: it constructs and returns a brand-new
\`FlagState\` with the updated value, leaving the original \`current\`
completely untouched. Discarding that returned new instance - which is
exactly what happens here - means the entire operation was pure busywork:
a new object was created, described a correct update, and was then
immediately thrown away, while \`cache\` keeps holding the same original,
unchanged \`FlagState\` it always had. Nothing throws an exception anywhere
in this sequence, because nothing here is actually wrong from the
compiler's or the runtime's perspective - it's a logically incomplete
operation, not a broken one.

The fix is storing the returned new instance back into the map, which is
also exactly the pattern \`ConcurrentHashMap\` is built to support
atomically:

\`\`\`java
public void handleWebhook(String flagName, boolean newValue) {
    cache.computeIfPresent(flagName, (name, state) -> state.withEnabled(newValue));
    log.info("cache updated for flag '{}'", flagName);
}
\`\`\`

Any code working with immutable value types - records, or any other
"wither"-style immutable object - needs to treat every transformation
method's return value as the *only* place the update actually lives. It's
an easy mistake to make precisely because it compiles cleanly, runs
without error, and even logs a message asserting success - the operation
genuinely happened, it just happened to an object nobody kept a reference
to.`,
};
