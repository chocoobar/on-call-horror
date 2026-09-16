import type { Scenario } from "../types";

export const negativeModuloSurprise: Scenario = {
  id: "negative-modulo-surprise",
  title: "Negative Modulo Surprise",
  subtitle: "the round-robin worker picker crashes with an ArrayIndexOutOfBoundsException, but only some days",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "modulo", "arithmetic"],
  briefing: `"job-dispatcher" hands each incoming job to one of eight worker threads
in a pool, chosen by a rotating counter. It's been running fine for
months, but starting a few days ago it intermittently throws
ArrayIndexOutOfBoundsException and drops the job entirely - always at
seemingly random moments, never reproducible in staging with small
job counts.`,
  constraints: [
    "The worker pool array is confirmed to always have exactly 8 entries - it is never resized or empty when this happens.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "job-dispatcher", namespace: "jobs", labels: { app: "job-dispatcher" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "job-dispatcher-6d7e8f9g0-h1i2j", namespace: "jobs", labels: { app: "job-dispatcher" } },
        status: { phase: "Running", containerStatuses: [{ name: "job-dispatcher", ready: true, restartCount: 2, state: { running: {} } }] },
        logs: {
          "job-dispatcher": [
            "2026-09-15T14:02:11.114Z ERROR c.e.jobs.RoundRobinPicker - java.lang.ArrayIndexOutOfBoundsException: Index -3 out of bounds for length 8",
            "    at app//com.example.jobs.RoundRobinPicker.next(RoundRobinPicker.java:14)",
            "2026-09-15T14:02:11.116Z WARN  c.e.jobs.RoundRobinPicker - counter value at failure: -2147483651",
          ],
        },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "job-dispatcher-notes", namespace: "jobs" },
        spec: {
          data: {
            "RoundRobinPicker.java.excerpt":
              "private final Worker[] workers = new Worker[8];\nprivate int counter = 0;   // never reset, incremented on every dispatched job\n\npublic Worker next() {\n    counter++;\n    int index = counter % workers.length;   // <-- assumes this is always >= 0\n    return workers[index];\n}\n",
          },
        },
        age: "9mo",
      },
    ],
  },
  hints: [
    "`kubectl logs job-dispatcher-6d7e8f9g0-h1i2j -n jobs` - the reported index is negative. `%` on a non-negative divisor should never produce a negative result... unless the dividend itself already was.",
    "`kubectl get configmap job-dispatcher-notes -n jobs -o yaml` - `counter` is an `int` that only ever increments, forever, for the lifetime of the process.",
    "What happens when a Java `int` counter that only ever increments passes `Integer.MAX_VALUE`? And what does Java's `%` operator return for a negative left-hand operand?",
  ],
  options: [
    {
      id: "int-overflow-then-negative-modulo",
      label:
        "`counter` is an `int` that increments forever and eventually overflows past `Integer.MAX_VALUE`, silently wrapping around to a large negative number - and Java's `%` operator, unlike some languages, preserves the sign of its left-hand operand, so `(negative number) % 8` can itself be negative, producing an out-of-range negative array index after enough jobs have been dispatched over the process's long uptime.",
      explanation:
        "The log shows `counter value at failure: -2147483651`... reported alongside an index of `-3` - `counter` has wrapped past `Integer.MIN_VALUE`/`MAX_VALUE` from continuous incrementing over 9 months of uptime with no reset. `RoundRobinPicker.java.excerpt` confirms `counter` only ever increments and is never bounded or reset. Once `counter` goes negative from overflow, `counter % workers.length` in Java returns a result with the same sign as the dividend (unlike languages guaranteeing a non-negative result), producing a negative index and the exact `ArrayIndexOutOfBoundsException` seen here - which only starts happening once uptime and job volume are high enough for the wraparound to actually occur, explaining why it was never reproducible with small job counts in staging.",
    },
    {
      id: "worker-array-resized-at-runtime",
      label: "The worker pool array is being resized to a smaller size at runtime under high load.",
      explanation:
        "The array is confirmed to always have exactly 8 entries and is never resized - the reported index itself is negative, which a too-small-but-still-non-negative array size wouldn't explain at all.",
    },
    {
      id: "multiple-threads-racing-on-counter",
      label: "Multiple threads incrementing `counter` concurrently are racing and corrupting its value.",
      explanation:
        "A simple race on a non-volatile `int` could cause lost updates or torn reads, but wouldn't reliably explain a large-magnitude negative value that exactly matches integer overflow arithmetic - the logged counter value is consistent with a clean, single sequence of increments wrapping past `Integer.MAX_VALUE`, not with corrupted concurrent writes.",
    },
    {
      id: "job-dispatcher-restarted-with-bad-state",
      label: "The pod restarted and resumed with a corrupted counter value from a previous crash.",
      explanation:
        "The counter value logged is a plausible, internally consistent result of continuous incrementing from zero far past `Integer.MAX_VALUE` - not an arbitrary or corrupted value - and the restart count reflects crashes caused by this very bug, not a cause of it.",
    },
  ],
  correctOptionId: "int-overflow-then-negative-modulo",
  resolution: `The logged counter value, \`-2147483651\`, is a dead giveaway once you
recognize \`Integer.MAX_VALUE\` is \`2147483647\` - this is well past where a
continuously incrementing \`int\` wraps around from positive to negative.
\`RoundRobinPicker.java.excerpt\` confirms \`counter\` is never reset and only
ever incremented, once per dispatched job, for the entire lifetime of the
process. After enough jobs (billions, but a busy long-lived dispatcher
gets there eventually), \`counter++\` overflows past \`Integer.MAX_VALUE\` and
wraps silently to a large negative number - Java doesn't throw on integer
overflow, it just wraps. From that point on, \`counter\` is negative, and
Java's \`%\` operator returns a result with the *same sign as the dividend*
(unlike some languages' modulo, which always returns non-negative for a
positive divisor) - so \`counter % workers.length\` can itself be negative,
producing an invalid array index and the \`ArrayIndexOutOfBoundsException\`
seen here. This is exactly why it never reproduced in staging: staging
never ran long enough, under enough load, to actually hit the overflow.

The fix is masking the sign bit before the modulo, or bounding the
counter explicitly:

\`\`\`java
public Worker next() {
    counter++;
    int index = (counter & Integer.MAX_VALUE) % workers.length;   // clears sign bit
    return workers[index];
}
\`\`\`

The general rule: any counter that increments without bound will
eventually overflow its type, and Java's \`%\` operator can return a
negative result for a negative dividend - never assume \`%\` is
non-negative unless the dividend itself is guaranteed to be.`,
};
