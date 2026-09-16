import type { Scenario } from "./types";

export const theRandomThatCollided: Scenario = {
  id: "the-random-that-collided",
  title: "The Random That Collided",
  subtitle: "two customers, checking out within the same second on different pods, occasionally receive the exact same promo voucher code",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "concurrency", "random"],
  briefing: `"voucher-generator" mints a unique 8-digit voucher code for every
completed checkout, using a shared, seeded \`Random\` instance kept as a
static field. Under heavy concurrent checkout traffic, a small but
growing number of vouchers have been issued as exact duplicates -
something the code's uniqueness constraint was supposed to make
essentially impossible.`,
  constraints: [
    "The database's uniqueness constraint on voucher codes is confirmed correctly enforced - the collisions being investigated are ones that happened to land on the exact same code *before* insertion, within the same brief window, not ones that slipped past a broken constraint.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "voucher-generator", namespace: "promotions", labels: { app: "voucher-generator" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "voucher-generator-8k9l0m1n2-o3p4q", namespace: "promotions", labels: { app: "voucher-generator" } },
        status: { phase: "Running", containerStatuses: [{ name: "voucher-generator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "voucher-generator": [
            "2026-09-15T12:00:01.114Z DEBUG c.e.promotions.VoucherGenerator - [pool-1-thread-2] generated code=48213377",
            "2026-09-15T12:00:01.114Z DEBUG c.e.promotions.VoucherGenerator - [pool-1-thread-5] generated code=48213377",
            "2026-09-15T12:00:01.120Z ERROR c.e.promotions.VoucherRepository - unique constraint violation inserting voucher 48213377",
          ],
        },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "voucher-generator-notes", namespace: "promotions" },
        spec: {
          data: {
            "VoucherGenerator.java.excerpt":
              "public class VoucherGenerator {\n    // shared across every checkout thread\n    private static final Random random = new Random(1234L);   // fixed seed,\n        // chosen originally to make generated codes reproducible in tests\n\n    public String generate() {\n        int code = 10000000 + random.nextInt(90000000);\n        return String.valueOf(code);\n    }\n}\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl logs voucher-generator-8k9l0m1n2-o3p4q -n promotions` - two different threads produce the exact same code at the exact same millisecond. `Random`'s output for a given internal state is deterministic - what determines that internal state here?",
    "`kubectl get configmap voucher-generator-notes -n promotions -o yaml` - `random` is constructed with a fixed seed (`1234L`) and shared as a `static` field across every thread. Does `java.util.Random` guarantee correct behavior when the same instance is called concurrently from multiple threads?",
    "`java.util.Random`'s internal state update (used to compute each next value) isn't atomic - concurrent calls to `nextInt()` on the *same shared instance* from multiple threads can race and, depending on timing, occasionally produce the same output on two different threads from what should be two independent draws.",
  ],
  options: [
    {
      id: "shared-random-instance-concurrent-access-collision",
      label:
        "`random` is a single `Random` instance, constructed with a fixed seed and shared as a `static` field across every concurrent checkout thread - `java.util.Random`'s internal state update isn't atomic, so concurrent calls to `nextInt()` from multiple threads on the same shared instance can race, and depending on timing, two threads can end up computing from the same (or a colliding) internal state and produce the identical output, exactly the kind of collision reported here between two threads generating a voucher within the same millisecond.",
      explanation:
        "The debug log shows two different threads (`pool-1-thread-2` and `pool-1-thread-5`) both logging `code=48213377` at the exact same timestamp, immediately followed by a real database uniqueness violation. `VoucherGenerator.java.excerpt` confirms `random` is a single, shared, `static Random` instance. `java.util.Random`'s internal seed-update algorithm reads and writes shared internal state without full atomicity guarantees for concurrent multi-threaded use - while individual calls are technically thread-safe in the sense of not corrupting the object itself, concurrent access from multiple threads can produce statistically correlated or, in rarer cases, identical output sequences across threads, especially noticeable under heavy concurrent load, which is exactly the pattern seen here: a growing number of collisions specifically under heavy concurrent checkout traffic.",
    },
    {
      id: "fixed-seed-alone-causes-collisions",
      label: "Using a fixed seed (`1234L`) at all is the entire problem, regardless of any concurrency.",
      explanation:
        "A fixed seed on a single-threaded, sequentially-called `Random` instance produces a long, non-repeating (for a very long time) deterministic sequence with no realistic collision risk over normal usage volumes - the fixed seed choice is a design decision separate from, and less directly responsible than, sharing that one instance unsafely across concurrent threads.",
    },
    {
      id: "database-connection-pool-returning-stale-results",
      label: "The database connection pool is returning stale, cached results, masking genuinely distinct codes as duplicates.",
      explanation:
        "The debug log shows the collision happening in the *generated* code itself, logged by `VoucherGenerator` independently on two different threads, before either ever reaches the database - the two threads genuinely computed the identical value; this isn't an artifact of stale reads at the database layer.",
    },
    {
      id: "voucher-code-length-too-short",
      label: "8-digit voucher codes don't provide enough keyspace to avoid collisions at current volume.",
      explanation:
        "An 8-digit code space (90 million possible values) makes a genuine, independent random collision at current checkout volumes astronomically unlikely - the observed collisions are correlated with concurrent access to a single shared generator instance, not simply a birthday-paradox consequence of the keyspace size alone.",
    },
  ],
  correctOptionId: "shared-random-instance-concurrent-access-collision",
  resolution: `The debug log shows two different threads, \`pool-1-thread-2\` and
\`pool-1-thread-5\`, both producing the identical code \`48213377\` at the
same timestamp - followed immediately by a genuine database uniqueness
violation, confirming this is a real generation collision, not a
downstream artifact. \`VoucherGenerator.java.excerpt\` shows \`random\` is a
single \`Random\` instance, constructed once with a fixed seed and shared
as a \`static\` field across every concurrent checkout thread.
\`java.util.Random\`'s internal state-update mechanism, used to compute
each successive value from the last, isn't designed with strong
guarantees for correctness under concurrent multi-threaded access to the
*same* instance - while it won't corrupt the object or throw an
exception, concurrent calls from multiple threads can interact in ways
that produce correlated or, under the right timing, identical outputs
across threads. This risk scales directly with concurrent load, which
lines up exactly with the reported pattern: collisions specifically
during heavy concurrent checkout traffic, essentially never during
lighter load.

The fix is giving each thread its own generator state, using
\`java.util.concurrent.ThreadLocalRandom\`, designed specifically for
this:

\`\`\`java
public String generate() {
    int code = 10000000 + ThreadLocalRandom.current().nextInt(90000000);
    return String.valueOf(code);
}
\`\`\`

\`ThreadLocalRandom\` maintains separate generator state per thread with
no shared mutable state at all, eliminating the collision risk entirely
without sacrificing performance (no synchronization needed). The general
rule: a single \`java.util.Random\` instance shared across multiple
threads is a correctness risk under concurrent access, not just a
performance one - use \`ThreadLocalRandom\` for concurrent code, or give
each thread (or each call) its own dedicated \`Random\` instance.`,
};
