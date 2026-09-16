import type { Scenario } from "./types";

export const theInternedStringThatWasnt: Scenario = {
  id: "the-interned-string-that-wasnt",
  title: "The Interned String That Wasn't",
  subtitle: "the feature-flag short-circuit that's supposed to skip an expensive lookup for known flag names occasionally does the opposite",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "string-interning", "performance"],
  briefing: `An engineer added a fast-path optimization to "flag-resolver": if a flag
name reference is identical (\`==\`) to one of a small set of pre-interned
"hot" flag names, skip the expensive database lookup and return a cached
value directly. Since deploying it, a specific flag has intermittently
returned stale values instead of hitting the fast path reliably or
consistently falling through to the correct slow path.`,
  constraints: [
    "The cached value used by the fast path is confirmed to sometimes be legitimately stale - the actual bug under investigation is why the fast path is taken inconsistently for what should be the exact same flag name, not whether the cached value itself is fresh.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "flag-resolver", namespace: "platform", labels: { app: "flag-resolver" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "flag-resolver-7t8u9v0w1-x2y3z", namespace: "platform", labels: { app: "flag-resolver" } },
        status: { phase: "Running", containerStatuses: [{ name: "flag-resolver", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "flag-resolver": [
            "2026-09-15T09:33:02.114Z DEBUG c.e.platform.FlagResolver - flagName==HOT_FLAG_CONSTANT? true (source=literal call site)",
            "2026-09-15T09:33:02.208Z DEBUG c.e.platform.FlagResolver - flagName==HOT_FLAG_CONSTANT? false (source=deserialized from request body)",
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "flag-resolver-notes", namespace: "platform" },
        spec: {
          data: {
            "FlagResolver.java.excerpt":
              "private static final String HOT_FLAG_CONSTANT = \"new-checkout-enabled\";   // string literal - interned automatically\n\npublic boolean resolve(String flagName) {\n    if (flagName == HOT_FLAG_CONSTANT) {   // reference identity comparison,\n            // chosen deliberately for speed - intended to work because\n            // matching literal call sites are also interned\n        return cachedHotFlagValue;\n    }\n    return database.lookup(flagName);   // correct, but 'slow', path\n}\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl logs flag-resolver-7t8u9v0w1-x2y3z -n platform` - the exact same flag name text, `\"new-checkout-enabled\"`, is `==` true from one call site and `==` false from another. What's different about *how* the string arrived at each call site?",
    "`kubectl get configmap flag-resolver-notes -n platform -o yaml` - `HOT_FLAG_CONSTANT` is a source-code string literal, automatically interned by the JVM. Is a `String` built at runtime by deserializing a request body also automatically interned?",
    "Only compile-time string literals (and strings explicitly passed through `.intern()`) are guaranteed to share the JVM's string pool instance - a `String` constructed at runtime by a JSON/deserialization library is a brand-new object, even if its content exactly matches an interned literal.",
  ],
  options: [
    {
      id: "reference-equality-fast-path-only-works-for-literals",
      label:
        "The fast path compares `flagName == HOT_FLAG_CONSTANT` using reference identity, which only reliably matches when `flagName` itself came from a source-code string literal (automatically interned, and therefore genuinely the same pooled object as `HOT_FLAG_CONSTANT`) - but `flagName` values arriving from deserialized request bodies are freshly constructed `String` objects at runtime, never automatically interned, so even when their content exactly matches `HOT_FLAG_CONSTANT`, `==` returns `false` and the code falls through to the slow database lookup instead of the intended fast path, inconsistently, depending purely on where each particular `flagName` reference happened to originate.",
      explanation:
        "The debug log shows the exact same flag name text producing opposite `==` results depending on the call site's origin: `true` when the reference comes from a literal in source code, `false` when it comes from deserializing a request body. `FlagResolver.java.excerpt` confirms the fast path deliberately relies on `==` reference identity for speed, working correctly only because `HOT_FLAG_CONSTANT` and any matching literal call site are both automatically interned by the JVM and therefore share the same pooled object. A `String` built at runtime by a deserialization library, even with byte-for-byte identical content, is a distinct, non-interned object - `==` against it is reliably `false`, sending it down the slower, but still correct, database lookup path. This isn't corrupting any results (the slow path is always correct), but it defeats the intended optimization inconsistently and confusingly, purely based on each caller's origin rather than the flag name's actual value.",
    },
    {
      id: "database-lookup-returning-stale-cached-value",
      label: "`database.lookup(flagName)` itself is returning a stale, cached value for this specific flag.",
      explanation:
        "The constraint specifically separates the question of whether the cached fast-path value is stale (acknowledged as a possibility, but not the focus) from why the fast path is reached inconsistently in the first place - the `==` comparison's unreliable behavior across different string origins is the actual mechanism under investigation here.",
    },
    {
      id: "hot-flag-constant-value-changed-at-runtime",
      label: "`HOT_FLAG_CONSTANT`'s value is being reassigned or changed somewhere at runtime.",
      explanation:
        "`HOT_FLAG_CONSTANT` is declared `private static final`, a genuine compile-time constant that can never be reassigned after class initialization - the debug log confirms its value is consistently `\"new-checkout-enabled\"` throughout; what varies is whether an incoming `flagName` reference happens to be identical to that one fixed, interned object.",
    },
    {
      id: "multiple-flagresolver-instances-with-different-constants",
      label: "Multiple instances of `FlagResolver` are somehow initialized with different `HOT_FLAG_CONSTANT` values.",
      explanation:
        "`HOT_FLAG_CONSTANT` is a `static` field, shared across every instance and every thread within one JVM, and it's a compile-time literal with one single, fixed value - there's no mechanism here for different instances to end up with different values for it.",
    },
  ],
  correctOptionId: "reference-equality-fast-path-only-works-for-literals",
  resolution: `The debug log shows the exact same flag name text producing opposite
\`==\` results depending purely on where the \`flagName\` reference
originated: \`true\` for a call site passing a source-code literal,
\`false\` for one built by deserializing a request body.
\`FlagResolver.java.excerpt\` shows the fast path deliberately uses \`==\`
reference-identity comparison against \`HOT_FLAG_CONSTANT\`, a private
static final string literal - and it works correctly *only* because
Java automatically interns compile-time string literals, so any matching
literal appearing anywhere else in the compiled code shares that exact
same pooled object. A \`String\` constructed at runtime - by a JSON
deserialization library reading a request body, for instance - is never
automatically interned; it's a brand-new object built fresh from parsed
bytes, regardless of how precisely its content matches an interned
literal elsewhere. \`==\` against it is reliably \`false\`, even for the
literal same flag name, sending it down the slower (but still correct)
database lookup path instead of the intended fast path - inconsistently,
depending entirely on each caller's origin rather than the flag's actual
value.

The fix is comparing by content instead of reference identity - which
gives up essentially nothing in practice, since \`String.equals()\` for
two identical strings, including two interned ones, is extremely fast
via a length/hashcode short-circuit:

\`\`\`java
public boolean resolve(String flagName) {
    if (HOT_FLAG_CONSTANT.equals(flagName)) {   // content comparison, not reference
        return cachedHotFlagValue;
    }
    return database.lookup(flagName);
}
\`\`\`

If reference-identity comparison is genuinely needed for extreme
performance reasons, calling \`.intern()\` explicitly on \`flagName\` before
comparing would restore correctness (interning forces it into the shared
pool, making it identical to \`HOT_FLAG_CONSTANT\` if content matches) - but
this reintroduces string pool memory/performance trade-offs of its own,
and \`.equals()\` is almost always the better choice. The general rule:
\`==\` on \`String\` only reliably matches for genuinely interned strings -
literals in source code, or strings explicitly passed through
\`.intern()\` - never assume a runtime-constructed string will be \`==\` to
a matching literal elsewhere, no matter how identical its content is.`,
};
