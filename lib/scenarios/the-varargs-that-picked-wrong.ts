import type { Scenario } from "./types";

export const theVarargsThatPickedWrong: Scenario = {
  id: "the-varargs-that-picked-wrong",
  title: "The Varargs That Picked Wrong",
  subtitle: "logging a single failed SKU sometimes logs a cryptic object hash code instead of the SKU string",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "overloading", "varargs"],
  briefing: `The inventory-adjustment audit log occasionally records an entry like
"failed to adjust: [Ljava.lang.String;@1a2b3c4d" instead of the actual
SKU that failed. It only happens for adjustments involving exactly one
SKU - batches of two or more always log correctly.`,
  constraints: [
    "The SKU value passed into the logging call is confirmed to be a real, valid SKU string at the call site every time - this isn't a data problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-adjuster", namespace: "inventory", labels: { app: "inventory-adjuster" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "inventory-adjuster-8p9q0r1s2-t3u4v", namespace: "inventory", labels: { app: "inventory-adjuster" } },
        status: { phase: "Running", containerStatuses: [{ name: "inventory-adjuster", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "inventory-adjuster": [
            "2026-09-15T13:33:10.114Z WARN  c.e.inventory.AdjustmentLogger - failed to adjust: [Ljava.lang.String;@6a7b8c9d",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inventory-adjuster-notes", namespace: "inventory" },
        spec: {
          data: {
            "AdjustmentLogger.java.excerpt":
              "public void logFailure(String reason, Object detail) {\n    log.warn(reason + \": \" + detail);\n}\n\npublic void logFailure(String reason, String... skus) {\n    log.warn(reason + \": \" + String.join(\", \", skus));\n}\n\n// call site:\nString failedSku = adjustment.sku();\nlogger.logFailure(\"failed to adjust\", failedSku);   // ambiguous-looking call\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap inventory-adjuster-notes -n inventory -o yaml` - there are two overloads of `logFailure` here. Which one does a call with exactly one `String` argument actually resolve to?",
    "Java's overload resolution prefers the *most specific applicable* method without needing varargs expansion - a single `String` argument can match `logFailure(String, Object)` directly, without treating it as a one-element varargs array.",
    "What does `String.valueOf(...)`/string concatenation produce when the second argument's compile-time resolved type is `Object` and its runtime value happens to be a `String[]` array passed some other way, versus when it's genuinely just a `String`?",
  ],
  options: [
    {
      id: "overload-resolution-picked-object-overload",
      label:
        "With exactly one `String` argument, Java's overload resolution prefers `logFailure(String, Object)` over `logFailure(String, String...)`, because the fixed-arity overload matches directly without needing varargs expansion - but at some call sites, `failedSku` is actually being wrapped as a one-element `String[]` before being passed in, and that array, once bound to the `Object detail` parameter, gets string-concatenated using `Object.toString()`'s default array behavior, printing `[Ljava.lang.String;@...` instead of the SKU text itself.",
      explanation:
        "The log shows `[Ljava.lang.String;@6a7b8c9d` - the default `Object.toString()` output for a `String[]` array, not a SKU. `AdjustmentLogger.java.excerpt` defines both a fixed-arity `logFailure(String, Object)` and a varargs `logFailure(String, String...)`; Java's overload resolution always prefers a fixed-arity match over expanding a varargs call when one is available, so when a single `String[]` array (not a bare `String`) is handed to a call site expecting to use the varargs overload, it instead matches `logFailure(String, Object)` directly, binding the whole array to `detail` as one `Object`, and concatenation calls the array's default `toString()` rather than joining its contents - exactly matching the reported garbled output, and exactly why batches (multiple SKUs, or code paths that pass a bare single `String`) don't hit it while a wrapped one-element array does.",
    },
    {
      id: "sku-string-corrupted-before-logging",
      label: "The SKU string itself is being corrupted or nulled out before the log call.",
      explanation:
        "The constraint confirms `failedSku` is a real, valid SKU string at the call site - the garbled log output is a well-known symptom of an array's default `toString()`, not of a null or corrupted string value.",
    },
    {
      id: "logger-configuration-truncating-single-arg-messages",
      label: "The logging framework's configuration is truncating or mangling single-argument log messages.",
      explanation:
        "`[Ljava.lang.String;@...` is a specific, recognizable Java array `toString()` output, not a truncation artifact - the logging framework is faithfully printing exactly what was concatenated into the message string, whatever that value actually was.",
    },
    {
      id: "varargs-array-allocation-failing-under-load",
      label: "Varargs array allocation is intermittently failing under memory pressure.",
      explanation:
        "This is a completely deterministic outcome of which overload gets resolved and what's passed into it - not an intermittent allocation failure, which would produce an `OutOfMemoryError` or similar, not a specific, reproducible mis-formatted log line.",
    },
  ],
  correctOptionId: "overload-resolution-picked-object-overload",
  resolution: `\`[Ljava.lang.String;@6a7b8c9d\` is the JVM's default \`Object.toString()\`
representation for a \`String[]\` array - the telltale sign that an array
ended up somewhere expecting to be treated as meaningful text.
\`AdjustmentLogger.java.excerpt\` defines two overloads:
\`logFailure(String, Object)\` and \`logFailure(String, String... skus)\`.
Java's overload resolution algorithm always prefers a fixed-arity match
over expanding a varargs call, when one applies without needing that
expansion. At the call site where a one-element \`String[]\` array
(constructed somewhere upstream, rather than a bare \`String\`) is passed
as the second argument, the compiler resolves the call to
\`logFailure(String, Object)\` - the array itself, as a single \`Object\`,
binds to \`detail\` - rather than to the varargs overload, which would have
correctly treated it as (or joined) individual SKU strings. String
concatenation with that \`Object\`-typed array then calls its default
\`toString()\`, producing the garbled class-name-and-hash-code output
instead of the SKU text.

The fix is removing the overload ambiguity - either by giving the two
methods clearly distinct names, or ensuring call sites always pass a
genuine \`String\`, not an array, when a single value is intended:

\`\`\`java
public void logFailure(String reason, String detail) {   // narrowed, not Object
    log.warn(reason + ": " + detail);
}

public void logFailureBatch(String reason, String... skus) {   // distinct name
    log.warn(reason + ": " + String.join(", ", skus));
}
\`\`\`

The general rule: overloading a fixed-arity \`Object\`-typed method
alongside a varargs method of a more specific type invites exactly this
kind of silent overload-resolution surprise - prefer distinct method
names, or narrower, non-\`Object\` parameter types, over relying on
callers to always pass the "right shape" of argument for overload
resolution to pick the intended method.`,
};
