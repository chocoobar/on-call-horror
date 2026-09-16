import type { Scenario } from "./types";

export const theGenericArrayThatCouldntExist: Scenario = {
  id: "the-generic-array-that-couldnt-exist",
  title: "The Generic Array That Couldn't Exist",
  subtitle: "a homegrown fixed-size ring buffer of recent audit events throws a ClassCastException the moment it wraps around",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "generics", "arrays"],
  briefing: `A lightweight, generic ring buffer class keeps the last N security audit
events in memory for a live dashboard, backed internally by an array for
performance. It works perfectly until the buffer fills up and starts
wrapping around to overwrite old entries - at which point reading from
it throws a ClassCastException that makes no obvious sense given the
buffer's own generic type.`,
  constraints: [
    "Every event actually stored into the ring buffer is confirmed to be a genuine, correctly-typed `AuditEvent` at the point it's added - no wrong-typed object is ever passed to `add(...)`.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "audit-dashboard", namespace: "security", labels: { app: "audit-dashboard" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "audit-dashboard-6s7t8u9v0-w1x2y", namespace: "security", labels: { app: "audit-dashboard" } },
        status: { phase: "Running", containerStatuses: [{ name: "audit-dashboard", ready: true, restartCount: 3, state: { running: {} } }] },
        logs: {
          "audit-dashboard": [
            "2026-09-15T17:02:04.114Z ERROR c.e.security.RingBuffer - java.lang.ClassCastException: class [Ljava.lang.Object; cannot be cast to class [Lcom.example.security.AuditEvent;",
            "    at app//com.example.security.RingBuffer.<init>(RingBuffer.java:5)",
          ],
        },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ring-buffer-notes", namespace: "security" },
        spec: {
          data: {
            "RingBuffer.java.excerpt":
              "public class RingBuffer<T> {\n    private final T[] items;\n    private int index = 0;\n\n    @SuppressWarnings(\"unchecked\")\n    public RingBuffer(int capacity) {\n        items = (T[]) new Object[capacity];   // creating a genuine T[] is\n            // impossible due to type erasure - this cast is the standard\n            // (unsafe) workaround, and it does NOT create a real T[] at\n            // runtime; it's still actually an Object[] underneath\n    }\n\n    public void add(T item) {\n        items[index] = item;\n        index = (index + 1) % items.length;\n    }\n\n    public AuditEvent[] snapshot() {\n        return (AuditEvent[]) items;   // <-- throws here: items' REAL runtime\n            // type is Object[], not AuditEvent[], no matter what T was\n    }\n}\n",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap ring-buffer-notes -n security -o yaml` - `items` is created as `(T[]) new Object[capacity]`. What is the array's actual, real runtime type after that cast - genuinely `T[]`, or still `Object[]` underneath?",
    "Generic array creation (`new T[capacity]`) isn't allowed in Java at all, because of type erasure - the common workaround, casting an `Object[]` to `T[]`, compiles with a warning but doesn't change what the array object actually is at runtime; it's still an `Object[]` wearing an unchecked compile-time label.",
    "`snapshot()` casts `items` directly to `AuditEvent[]` - does casting a reference change the *actual array object's* runtime type, or does it just tell the compiler to trust a particular view of it?",
  ],
  options: [
    {
      id: "generic-array-workaround-still-object-array-at-runtime",
      label:
        "`items` is created via `(T[]) new Object[capacity]`, the standard unchecked workaround for the fact that Java doesn't allow creating a genuine generic array directly - but that cast is purely a compile-time fiction; the array object itself is, and remains, a real `Object[]` at runtime, regardless of what `T` is. `snapshot()` then casts that same `Object[]`-at-runtime reference directly to `AuditEvent[]`, which fails with `ClassCastException`, because you cannot cast an actual `Object[]` array instance to a more specific array type - unlike casting individual elements, casting an array reference to a different array component type requires the array's actual, real runtime type to already match or be compatible with the target type.",
      explanation:
        "The exception is explicit: `class [Ljava.lang.Object; cannot be cast to class [Lcom.example.security.AuditEvent;` - array type descriptors for `Object[]` and `AuditEvent[]` respectively, confirming the array's real runtime type is `Object[]`. `RingBuffer.java.excerpt`'s own comment explains why: `(T[]) new Object[capacity]` is the standard unsafe workaround for Java's prohibition on creating a genuine `new T[]` directly (due to type erasure), but it's purely a compile-time cast - it does not, and cannot, change what the array object actually is at runtime, which remains `Object[]`. `snapshot()` then tries to cast that real `Object[]` instance directly to `AuditEvent[]`, and unlike casting individual object references, casting an array reference to a more specific array component type is checked against the array's genuine runtime type, which fails here because it's still fundamentally `Object[]`, no matter that every individual element stored in it happens to be an `AuditEvent`.",
    },
    {
      id: "auditevent-objects-stored-inconsistently",
      label: "Some non-`AuditEvent` objects are being stored into the ring buffer alongside genuine `AuditEvent`s.",
      explanation:
        "The constraint confirms every stored item is a genuine, correctly-typed `AuditEvent` at the point it's added - the `ClassCastException` here is about the *array object's own* runtime type (`Object[]` vs `AuditEvent[]`), not about any individual element's type being wrong.",
    },
    {
      id: "ring-buffer-index-wraparound-off-by-one",
      label: "The ring buffer's index wraparound logic has an off-by-one error, reading uninitialized slots.",
      explanation:
        "The exception is thrown at `RingBuffer.<init>` (the constructor) per the stack trace, before any wraparound or even any `add()` call has happened at all - the failure is a fundamental, unconditional type-cast issue in how the backing array is created, not a runtime indexing bug that only appears after wraparound.",
    },
    {
      id: "concurrent-writes-to-ring-buffer-corrupting-array",
      label: "Concurrent writes to the ring buffer from multiple threads are corrupting the underlying array.",
      explanation:
        "The stack trace shows the exception thrown directly inside the constructor itself, a single, one-time, non-repeating operation - this is a deterministic type-cast failure inherent to how the array is constructed, fully reproducible with a single thread and no concurrent access involved at all.",
    },
  ],
  correctOptionId: "generic-array-workaround-still-object-array-at-runtime",
  resolution: `The exception is precise: \`class [Ljava.lang.Object; cannot be cast to
class [Lcom.example.security.AuditEvent;\` - the JVM's own array type
descriptors for \`Object[]\` and \`AuditEvent[]\`, confirming the array's
actual runtime type really is \`Object[]\`. \`RingBuffer.java.excerpt\`'s own
comment explains the root cause: Java doesn't allow creating a genuine
generic array (\`new T[capacity]\`) directly, because of type erasure -
there's no way for the JVM to know what array component type to
actually allocate at runtime. The standard, widely-used workaround is
\`(T[]) new Object[capacity]\`, an unchecked cast that satisfies the
compiler but changes nothing about the array object itself, which
remains, at runtime, a genuine \`Object[]\` for its entire lifetime,
regardless of what \`T\` happens to be at any particular call site.
\`snapshot()\` then attempts to cast that same, still-really-\`Object[]\`
reference directly to \`AuditEvent[]\` - and unlike casting an individual
object reference (which only checks the object's actual class against
the target at the point of use), casting an *array* reference to a more
specific array component type requires the array's own real runtime type
to already be compatible, which it isn't here, producing exactly this
`ClassCastException`, deterministically, the very first time
`snapshot()` is called (the "wraps around" framing in the incident
report was a red herring - it would fail on the very first snapshot,
regardless of wraparound).

The fix is either returning `Object[]` (and letting callers cast
individual elements, which *is* safe) or, better, using a properly typed
collection instead of a raw generic array workaround:

\`\`\`java
public class RingBuffer<T> {
    private final List<T> items;   // avoids generic array creation entirely
    // ... backed by a fixed-size List/ArrayDeque instead of a raw array
}
\`\`\`

If an actual array return type is required, accepting a
\`Class<T> componentType\` (or an \`IntFunction<T[]> generator\`, as
\`Stream.toArray\` does) and using \`java.lang.reflect.Array.newInstance(...)\`
to build a genuinely correctly-typed array at runtime is the standard
safe pattern. The general rule: the \`(T[]) new Object[n]\` workaround
never actually produces a real \`T[]\` at runtime - it's only safe to use
internally, through the generic-erased \`T\` reference, and casting that
same array reference to any more specific array type later will fail,
because the array's true runtime type never changed.`,
};
