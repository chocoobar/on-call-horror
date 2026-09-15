import type { Scenario } from "./types";

export const theSilentTruncation: Scenario = {
  id: "the-silent-truncation",
  title: "The Silent Truncation",
  subtitle: "two completely unrelated orders somehow got the same order number",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "integer-overflow", "production-bug"],
  briefing: `A customer complaint led to the discovery that two different orders,
placed hours apart by two different customers, were both assigned order
number "-2147483638". The order-numbering service has been running
without a single restart for over two years.`,
  constraints: [
    "The order numbering logic itself hasn't been touched in years - nobody deployed a change around when this started happening.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "order-numbering", namespace: "orders", labels: { app: "order-numbering" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "order-numbering-6w7x8y9z0-a1b2c", namespace: "orders", labels: { app: "order-numbering" } },
        status: { phase: "Running", containerStatuses: [{ name: "order-numbering", ready: true, restartCount: 0, state: { running: { startedAt: "2024-09-01T00:00:00Z" } } }] },
        logs: {
          "order-numbering": [
            "2026-09-15T08:00:00.114Z INFO  c.e.orders.OrderNumberGenerator - issued order number 2147483645",
            "2026-09-15T08:00:00.980Z INFO  c.e.orders.OrderNumberGenerator - issued order number 2147483646",
            "2026-09-15T08:00:01.410Z INFO  c.e.orders.OrderNumberGenerator - issued order number 2147483647",
            "2026-09-15T08:00:01.884Z INFO  c.e.orders.OrderNumberGenerator - issued order number -2147483648",
            "2026-09-15T08:00:02.204Z INFO  c.e.orders.OrderNumberGenerator - issued order number -2147483647",
          ],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "order-numbering-notes", namespace: "orders" },
        spec: {
          data: {
            "OrderNumberGenerator.java.excerpt":
              "public class OrderNumberGenerator {\n    private int counter = 0;   // in-memory, incremented once per order\n\n    public synchronized int next() {\n        counter = counter + 1;\n        return counter;\n    }\n}\n",
            "notes.md":
              "This service has been running continuously, without a restart, for\nover two years. At roughly 3,000-4,000 orders processed per day\nsustained over that period, the counter has now issued somewhere north\nof 2.1 billion order numbers in total.\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl logs order-numbering-6w7x8y9z0-a1b2c -n orders` - look closely at the exact sequence of numbers issued right around 2147483647.",
    "`kubectl get configmap order-numbering-notes -n orders -o yaml` - what type is `counter`, and what is Java's `int` type's maximum representable value?",
    "`kubectl get configmap order-numbering-notes -n orders -o yaml` again - roughly how many orders has this counter issued over its lifetime, and how does that compare to `Integer.MAX_VALUE`?",
  ],
  options: [
    {
      id: "int-counter-overflow",
      label:
        "`counter` is a Java `int`, whose maximum value is 2,147,483,647 - after two years of continuous uptime and roughly 2.1+ billion orders issued, the counter overflowed and silently wrapped around to `Integer.MIN_VALUE` (-2147483648) and started counting up from there again, which is exactly why two unrelated orders, hours apart, both ended up with the same (now-recycled) order number.",
      explanation:
        "The log sequence shows it directly: 2147483645, 2147483646, 2147483647 (exactly `Integer.MAX_VALUE`), then -2147483648 (exactly `Integer.MIN_VALUE`) - a silent wraparound with no exception, no crash, and no warning of any kind, because integer overflow in Java doesn't throw by default, it just wraps using two's-complement arithmetic. `order-numbering-notes` confirms the service has run continuously for over two years, long enough at its real order volume to issue more than 2.1 billion numbers - comfortably past `int`'s ~2.1 billion capacity. Once it wraps, it starts reissuing the exact same sequence of \"new\" numbers it already handed out the first time it passed through that range, guaranteeing eventual collisions with earlier orders.",
    },
    {
      id: "database-sequence-reset",
      label: "A database sequence used for order numbers got manually reset by someone.",
      explanation:
        "The order number generation shown here is a plain in-memory counter inside the application itself, with no database sequence involved at all - and the exact, precise transition at `Integer.MAX_VALUE`/`Integer.MIN_VALUE` in the logs is a specific numeric signature that a manual reset to some arbitrary value wouldn't reliably reproduce.",
    },
    {
      id: "concurrent-requests-race-condition",
      label: "Two concurrent requests both read the counter before either one incremented it.",
      explanation:
        "The `next()` method is `synchronized`, which fully serializes access to `counter` across concurrent callers - there's no window for two callers to both read the same pre-increment value. The actual collision shown here follows a real, deterministic overflow boundary, not a race between concurrent calls.",
    },
    {
      id: "log-line-duplication-bug",
      label: "A logging bug is printing duplicate log lines, making it look like the same number was issued twice.",
      explanation:
        "This isn't just a logging artifact - the collision was discovered independently, via two real customer orders in the actual order data itself both carrying the same order number, not merely two suspicious-looking log lines.",
    },
  ],
  correctOptionId: "int-counter-overflow",
  resolution: `The log sequence is the smoking gun, in order: ...2147483645,
2147483646, 2147483647 - exactly \`Integer.MAX_VALUE\` - immediately
followed by -2147483648 - exactly \`Integer.MIN_VALUE\`. That's not a bug
in the counter's logic; it's Java's \`int\` type doing precisely what it's
specified to do on overflow: wrap around using two's-complement
arithmetic, silently, with no exception thrown and no warning logged.
\`order-numbering-notes\` confirms the service has run continuously for
over two years at a sustained volume that adds up to somewhere past 2.1
billion orders - comfortably beyond \`int\`'s maximum of 2,147,483,647.
Once the counter wraps past that ceiling, it starts counting back up from
\`Integer.MIN_VALUE\`, reissuing exactly the same sequence of numbers it
already handed out the first time through - guaranteeing that eventually,
some new order gets assigned a number that already belongs to an order
from roughly two years ago.

The fix is switching the counter to a type with enough headroom that this
kind of realistic long-term volume can never overflow it in practice:

\`\`\`java
public class OrderNumberGenerator {
    private long counter = 0;   // long: max ~9.2 * 10^18

    public synchronized long next() {
        counter = counter + 1;
        return counter;
    }
}
\`\`\`

A \`long\` counter at the same order volume would take roughly 8 million
years to overflow - a comfortable enough margin that this specific bug
never resurfaces. More broadly, any long-lived counter, ID generator, or
sequence that's expected to keep running indefinitely deserves a type
audit against its actual, realistic lifetime volume: \`int\`'s ~2.1 billion
ceiling sounds enormous until a service has actually been running long
enough, at real production volume, to get there.`,
};
