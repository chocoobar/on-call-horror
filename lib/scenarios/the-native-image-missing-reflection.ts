import type { Scenario } from "./types";

export const theNativeImageMissingReflection: Scenario = {
  id: "the-native-image-missing-reflection",
  title: "The Native Image Missing Reflection",
  subtitle: "coupon-validator's native-image build passes every test but throws in production for one specific coupon type",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "graalvm", "native-image"],
  briefing: `"coupon-validator" was recently migrated to a GraalVM native image for
faster cold starts during Black Friday-style scaling events. The full
test suite passes, and 99% of coupon validations work fine in production.
But one specific coupon type - percentage-based bulk discounts, added a
few months ago and rarely exercised in tests - throws an unhandled
exception every single time it's validated in the native build, despite
working perfectly on the regular JVM.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "coupon-validator", namespace: "commerce", labels: { app: "coupon-validator" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "coupon-validator", image: "registry.internal/coupon-validator:native-2.0.0" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "coupon-validator-9u0v1w2x3-y4z5a", namespace: "commerce", labels: { app: "coupon-validator" } },
        status: { phase: "Running", containerStatuses: [{ name: "coupon-validator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "coupon-validator": [
            "2026-09-15T10:40:01.114Z ERROR c.e.commerce.CouponController - failed to validate coupon BULK25: com.fasterxml.jackson.databind.exc.InvalidDefinitionException: Cannot construct instance of `com.example.commerce.BulkPercentageCoupon` (no Creators, like default constructor, exist): cannot deserialize from Object value",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "coupon-validator-notes", namespace: "commerce" },
        spec: {
          data: {
            "reflect-config.json.excerpt":
              "[\n  { \"name\": \"com.example.commerce.PercentageCoupon\", \"allDeclaredConstructors\": true, \"allDeclaredFields\": true },\n  { \"name\": \"com.example.commerce.FixedAmountCoupon\", \"allDeclaredConstructors\": true, \"allDeclaredFields\": true },\n  { \"name\": \"com.example.commerce.FreeShippingCoupon\", \"allDeclaredConstructors\": true, \"allDeclaredFields\": true }\n  // BulkPercentageCoupon, added a few months ago as a subclass of\n  // PercentageCoupon, was never added to this file - it's only ever\n  // instantiated via Jackson polymorphic deserialization based on a\n  // \"type\" discriminator field, never referenced directly anywhere\n  // else in the codebase that a native-image build's static analysis\n  // could discover on its own\n]\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl logs coupon-validator-9u0v1w2x3-y4z5a -n commerce` - `Cannot construct instance ... no Creators, like default constructor, exist`. This class works fine on the regular JVM - what's different in a native image build?",
    "`kubectl get configmap coupon-validator-notes -n commerce -o yaml` (`reflect-config.json.excerpt`) - is `BulkPercentageCoupon` listed anywhere in the reflection configuration?",
    "GraalVM native-image's static analysis can only discover classes that are referenced directly in code it can see - a class only ever instantiated via Jackson's polymorphic (discriminator-field-based) deserialization isn't something static analysis can find on its own; it needs to be told about explicitly.",
  ],
  options: [
    {
      id: "bulkpercentagecoupon-missing-from-reflect-config",
      label:
        "`BulkPercentageCoupon` is only ever instantiated via Jackson's polymorphic deserialization (a runtime, reflection-based mechanism triggered by a \"type\" discriminator field), which GraalVM native-image's static analysis has no way to discover on its own since nothing in the code directly references the class by name; it was never added to `reflect-config.json` when it was introduced, so the native image was built without any reflective constructor metadata for it - on the regular JVM, which allows reflection freely at runtime, this same code works fine, but in the native build, an unregistered class simply can't be reflectively constructed, producing exactly this `InvalidDefinitionException`.",
      explanation:
        "The error is specific and precise: `Cannot construct instance of BulkPercentageCoupon (no Creators, like default constructor, exist)` - the kind of failure that happens when Jackson can't find constructor metadata to use, which on a native image means the class's reflection data was never registered. `coupon-validator-notes` confirms `BulkPercentageCoupon` is missing entirely from `reflect-config.json`, while its sibling coupon types are all present; the comment explains why static analysis couldn't catch this automatically - the class is only ever reached through a runtime, discriminator-based polymorphic deserialization path, invisible to native-image's ahead-of-time reachability analysis.",
    },
    {
      id: "jackson-version-incompatible-with-native-image",
      label: "The version of Jackson in use is simply incompatible with GraalVM native images generally.",
      explanation:
        "Every other coupon type - `PercentageCoupon`, `FixedAmountCoupon`, `FreeShippingCoupon` - deserializes correctly in the exact same native image using the same Jackson version, which rules out a blanket incompatibility; the difference is specifically that those three are registered in `reflect-config.json` and `BulkPercentageCoupon` is not.",
    },
    {
      id: "bulkpercentagecoupon-has-a-real-bug",
      label: "`BulkPercentageCoupon` itself has a bug in its constructor logic.",
      explanation:
        "The scenario states this exact code works correctly on the regular JVM - a real constructor logic bug would fail identically in both environments; the fact that it only fails specifically in the native build points at a native-image-specific cause (missing reflection metadata), not a defect in the class's own logic.",
    },
    {
      id: "native-image-build-cache-stale",
      label: "The native-image build used a stale build cache that predates BulkPercentageCoupon's introduction.",
      explanation:
        "`reflect-config.json` is a checked-in, hand (or tool-assisted) maintained configuration file, not a build cache artifact - a stale cache would typically produce a build failure or clearly wrong behavior across the board, not a precise, consistent runtime failure isolated to exactly the one class missing from that specific config file.",
    },
  ],
  correctOptionId: "bulkpercentagecoupon-missing-from-reflect-config",
  resolution: `The error is precise about what's missing: \`Cannot construct instance of
BulkPercentageCoupon (no Creators, like default constructor, exist)\` - the
signature of Jackson being unable to find constructor metadata to use for
a class. On the regular JVM, reflection works freely at runtime and this
never surfaces; a native image, by contrast, only has reflective access
to exactly the classes and members explicitly registered ahead of time.

\`coupon-validator-notes\` confirms the gap directly: \`reflect-config.json\`
lists \`PercentageCoupon\`, \`FixedAmountCoupon\`, and \`FreeShippingCoupon\`,
each with \`allDeclaredConstructors\` and \`allDeclaredFields\` registered -
but \`BulkPercentageCoupon\`, added as a subclass a few months later, was
never added to the file. The comment explains why native-image's own
static analysis couldn't catch this automatically: \`BulkPercentageCoupon\`
is only ever instantiated through Jackson's polymorphic deserialization,
triggered at runtime by a \`"type"\` discriminator field in the incoming
JSON - there's no direct code reference to the class anywhere static
analysis can trace to discover it needs reflective access.

The fix is adding the missing class to the reflection configuration, and
building a process to prevent this recurring for the next new subtype:

\`\`\`json
{
  "name": "com.example.commerce.BulkPercentageCoupon",
  "allDeclaredConstructors": true,
  "allDeclaredFields": true
}
\`\`\`

Since GraalVM ships a Tracing Agent (\`-agentlib:native-image-agent\`) that
can generate this configuration automatically by observing real
reflective usage during a test run, running the full coupon-type test
suite under the agent - and regenerating \`reflect-config.json\` from its
output - is the more durable fix: any polymorphic type introduced in the
future gets captured automatically as long as it's actually exercised by
a test, rather than depending on someone remembering to hand-edit this
file every time a new subtype is added.`,
};
