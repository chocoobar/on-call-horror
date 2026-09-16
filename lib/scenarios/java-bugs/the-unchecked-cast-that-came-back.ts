import type { Scenario } from "../types";

export const theUncheckedCastThatCameBack: Scenario = {
  id: "the-unchecked-cast-that-came-back",
  title: "The Unchecked Cast That Came Back",
  subtitle: "the analytics export job dies hours into a run, on data that looked perfectly fine when it was written",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "generics", "type-safety"],
  briefing: `"analytics-exporter" reads a generic, reusable \`MetricBucket<T>\` cache
that different upstream jobs populate with different metric types. A
few hours into the nightly export, it crashes with a
ClassCastException on a bucket that was populated hours earlier by a
completely different upstream job than the one the exporter expected.`,
  constraints: [
    "Every upstream job writing into a `MetricBucket` writes internally-consistent, correctly-typed data for its own purposes - no individual writer is corrupting its own data.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "analytics-exporter-28901744", namespace: "analytics", labels: { app: "analytics-exporter" } },
        spec: { completions: 1 },
        status: { failed: 1 },
        age: "50m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "analytics-exporter-28901744-o1p2q", namespace: "analytics", labels: { app: "analytics-exporter" } },
        status: { phase: "Failed", containerStatuses: [{ name: "analytics-exporter", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "analytics-exporter": [
            "2026-09-15T04:40:11.114Z ERROR c.e.analytics.MetricExporter - java.lang.ClassCastException: class java.lang.Long cannot be cast to class java.lang.Double",
            "    at app//com.example.analytics.MetricExporter.export(MetricExporter.java:10)",
          ],
        },
        age: "50m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "metric-bucket-notes", namespace: "analytics" },
        spec: {
          data: {
            "MetricBucket.java.excerpt":
              "public class MetricBucket<T> {\n    private List<Object> values = new ArrayList<>();   // raw Object storage internally\n\n    @SuppressWarnings(\"unchecked\")\n    public void add(T value) {\n        values.add(value);\n    }\n\n    @SuppressWarnings(\"unchecked\")\n    public T get(int i) {\n        return (T) values.get(i);   // unchecked cast, trusted at every call site\n    }\n}\n\n// registry shared across all upstream jobs, keyed by metric name:\nMap<String, MetricBucket<?>> registry = ...;\n\n// LatencyJob.java writes:\nMetricBucket<Long> latencyBucket = (MetricBucket<Long>) (MetricBucket<?>) registry.get(\"page_load\");\nlatencyBucket.add(220L);\n\n// MetricExporter.java reads, assuming a different type for the same key:\nMetricBucket<Double> bucket = (MetricBucket<Double>) (MetricBucket<?>) registry.get(\"page_load\");\ndouble value = bucket.get(0);   // ClassCastException here, at the point\n    // of actual use, not at either of the casts above\n",
          },
        },
        age: "50m",
      },
    ],
  },
  hints: [
    "`kubectl get configmap metric-bucket-notes -n analytics -o yaml` - `LatencyJob` and `MetricExporter` both access `registry.get(\"page_load\")`, but cast the result to two different generic types. Who's actually right about what type that bucket holds?",
    "`MetricBucket.get(int)` uses an unchecked cast internally, suppressed with `@SuppressWarnings(\"unchecked\")` - the compiler trusts the caller's type argument completely, with zero runtime verification, at every single call site.",
    "Type erasure means there's no way, at runtime, for `MetricBucket<Long>` and `MetricBucket<Double>` to know they actually refer to the *same* underlying bucket populated with the wrong type for one of the two readers' assumptions - the mismatch is only discovered the moment a value is actually read and used as the assumed type.",
  ],
  options: [
    {
      id: "unchecked-generic-cast-key-collision",
      label:
        "`MetricBucket<T>.get(int)` performs an unchecked cast to `T`, trusted completely at every call site with no runtime verification - `LatencyJob` populates the `\"page_load\"` bucket assuming `MetricBucket<Long>`, while `MetricExporter` reads the exact same shared bucket assuming `MetricBucket<Double>`, and because of type erasure, nothing catches this mismatched assumption about the same registry key at compile time; the mismatch only surfaces as a `ClassCastException` at the moment `MetricExporter` actually reads a value and tries to use it as a `Double`.",
      explanation:
        "The stack trace shows `ClassCastException: class java.lang.Long cannot be cast to class java.lang.Double`, thrown from inside `MetricExporter.export` at the point a value is actually read and used. `MetricBucket.java.excerpt` shows both `LatencyJob` and `MetricExporter` accessing the same shared `registry` entry under the key `\"page_load\"`, but casting the raw `MetricBucket<?>` to two different, incompatible generic types - `MetricBucket<Long>` and `MetricBucket<Double>` respectively - and `MetricBucket.get(int)`'s internal unchecked cast trusts whichever type argument each caller supplies, with no runtime check at all. The mismatch is invisible at both write time and at the moment of either cast; it only becomes an actual `ClassCastException` the instant `MetricExporter` reads a value out of a bucket that was actually populated as `Long`s and tries to treat it as a `Double`.",
    },
    {
      id: "latencyjob-writing-wrong-metric-type",
      label: "`LatencyJob` itself has a bug, writing `Long` values when it should be writing `Double` values.",
      explanation:
        "`LatencyJob` is confirmed to write internally-consistent, correctly-typed data for its own purposes (`Long` millisecond latency values, a perfectly reasonable type for that job) - the actual problem is a second, unrelated job (`MetricExporter`) assuming a completely different type for the same shared registry key, not that `LatencyJob`'s own chosen type is wrong.",
    },
    {
      id: "registry-map-corrupted-by-concurrent-writes",
      label: "The shared `registry` map is being corrupted by concurrent writes from multiple upstream jobs.",
      explanation:
        "There's no indication of map corruption here - `registry.get(\"page_load\")` correctly and consistently returns the same, intact `MetricBucket` object both jobs are accessing; the problem is a mismatched *assumption* about that bucket's generic type parameter between two independently-written callers, not corrupted map state.",
    },
    {
      id: "double-to-long-autoboxing-precision-loss",
      label: "An autoboxing conversion between `double` and `Long` is losing precision somewhere in the pipeline.",
      explanation:
        "The exception is a `ClassCastException`, not a numeric precision or rounding issue - `Long` and `Double` are entirely distinct, non-convertible wrapper types with no autoboxing relationship to each other at all; this is a type mismatch, not a precision loss.",
    },
  ],
  correctOptionId: "unchecked-generic-cast-key-collision",
  resolution: `The stack trace shows \`ClassCastException: class java.lang.Long cannot
be cast to class java.lang.Double\`, thrown from inside
\`MetricExporter.export\`, right at the point a value is finally read out
and used - not at either of the earlier casts to \`MetricBucket<Long>\` or
\`MetricBucket<Double>\`. \`MetricBucket.java.excerpt\` explains why those
earlier casts didn't catch anything: \`get(int)\` performs an unchecked
cast to \`T\` internally, suppressed with \`@SuppressWarnings("unchecked")\`,
which trusts whatever type argument each individual call site supplies
with zero runtime verification - because of type erasure, there's no
way for the JVM to check "is this actually a bucket of \`Long\`s or
\`Double\`s" at that point; the generic type parameter simply doesn't
exist anymore at runtime. \`LatencyJob\` and \`MetricExporter\` both access
the *same* shared \`registry\` entry under the key \`"page_load"\`, but each
was written independently, assuming a different (and, for one of them,
wrong) generic type for that shared bucket. The mismatch is invisible
the entire time - at write, at either cast - and only becomes a real,
crash-causing problem the moment a value is actually read and used as
the assumed (but incorrect) type.

The fix is eliminating the shared, loosely-typed registry keyed only by
a string, in favor of type-safe, distinct storage per metric:

\`\`\`java
// each metric gets its own strongly-typed, non-colliding bucket reference,
// resolved once at compile time rather than through a shared string-keyed map
private final MetricBucket<Long> pageLoadLatency = new MetricBucket<>();
\`\`\`

If a shared, dynamically-keyed registry is genuinely required, a
type-safe heterogeneous container pattern (using \`Class<T>\` tokens as
keys instead of plain strings) at least ties the stored type to the
lookup key explicitly, catching mismatches earlier. The general rule: a
shared, string-keyed registry of generically-typed objects relies
entirely on every caller manually agreeing on what type each key holds -
type erasure gives the compiler no way to verify that agreement, and a
mismatch surfaces only as a runtime \`ClassCastException\`, often far from
where the actual mistaken assumption was made.`,
};
