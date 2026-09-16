import type { Scenario } from "../types";

export const theThreadThatRemembered: Scenario = {
  id: "the-thread-that-remembered",
  title: "The Thread That Remembered",
  subtitle: "one customer's tax exemption status randomly applies to a completely different customer's order",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "threadlocal", "concurrency"],
  briefing: `A handful of customers - never the same ones twice - have received
orders with someone else's tax exemption applied, or missing their own.
It only happens under real production load; the request-scoped tax
context code has passed every single-request test written for it.`,
  constraints: [
    "Each request's own tax exemption lookup is confirmed correct in isolation - the value read back later in the same logical request is what's wrong.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "tax-calculator", namespace: "orders", labels: { app: "tax-calculator" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "tax-calculator-5x6y7z8a9-b0c1d", namespace: "orders", labels: { app: "tax-calculator" } },
        status: { phase: "Running", containerStatuses: [{ name: "tax-calculator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "tax-calculator": [
            "2026-09-15T14:00:01.114Z DEBUG c.e.orders.TaxContext - [pool-4-thread-2] set exempt=true for customer cust-501",
            "2026-09-15T14:00:01.118Z INFO  c.e.orders.TaxCalculator - order ord-9012 (customer cust-501) tax=0.00",
            "2026-09-15T14:00:01.204Z DEBUG c.e.orders.TaxContext - [pool-4-thread-2] read exempt=true for customer cust-830",
            "2026-09-15T14:00:01.206Z WARN  c.e.orders.TaxAudit - order ord-9013 (customer cust-830, not exempt) charged tax=0.00",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tax-calculator-notes", namespace: "orders" },
        spec: {
          data: {
            "TaxContext.java.excerpt":
              "public class TaxContext {\n    private static final ThreadLocal<Boolean> exempt = new ThreadLocal<>();\n\n    public static void setExempt(boolean value) {\n        exempt.set(value);\n    }\n\n    public static boolean isExempt() {\n        Boolean value = exempt.get();\n        return value != null && value;\n    }\n    // no clear() is ever called anywhere in this class or its callers\n}\n\n// TaxCalculator.java - runs on a pooled worker thread per request:\nTaxContext.setExempt(customer.isTaxExempt());\ncalculateTax(order);\n// request ends here - TaxContext.clear() is never called\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs tax-calculator-5x6y7z8a9-b0c1d -n orders` - both log lines happen on the exact same worker thread (`pool-4-thread-2`), for two different customers, one right after the other.",
    "`kubectl get configmap tax-calculator-notes -n orders -o yaml` - `TaxContext` uses a `static ThreadLocal<Boolean>`, set once per request. Is it ever cleared at the end of a request?",
    "A thread pool reuses the same underlying `Thread` objects across many requests over time - a `ThreadLocal` value set during one request and never cleared is still sitting there, attached to that same thread, the next time a completely different request happens to run on it.",
  ],
  options: [
    {
      id: "threadlocal-never-cleared-in-pooled-thread",
      label:
        "`TaxContext` stores exemption status in a `static ThreadLocal<Boolean>`, set at the start of each request but never cleared with `.remove()` at the end - since the application runs on a pooled executor that reuses the same underlying threads across many different requests, a value set by one customer's request stays attached to that thread and is silently read back by whatever unrelated request happens to run on that same reused thread next.",
      explanation:
        "The log shows both events on the exact same thread, `pool-4-thread-2`: exemption set `true` for `cust-501`, then, on a completely different order for `cust-830` (who is not exempt), the same thread reads back `exempt=true`. `TaxContext.java.excerpt` confirms `exempt` is a `static ThreadLocal<Boolean>` that's set at the start of a request but never cleared anywhere, and the calling code never calls `TaxContext.clear()` at the end of the request either. On a pooled executor, the same `Thread` object handles many different requests over its lifetime - a value set during one request and left uncleared is still sitting on that thread, ready to leak into whatever unrelated request happens to reuse it next.",
    },
    {
      id: "customer-tax-status-stored-incorrectly",
      label: "`cust-830`'s tax exemption status is stored incorrectly in the customer database.",
      explanation:
        "The audit log explicitly notes `cust-830` is 'not exempt' as the correct, expected status - the stored data for that customer is right; what's wrong is a stale value bleeding in from an unrelated previous request on the same reused thread.",
    },
    {
      id: "tax-calculator-caching-results-across-orders",
      label: "`TaxCalculator` is caching tax results and incorrectly reusing them across different orders.",
      explanation:
        "There's no caching layer shown anywhere in this code path - `isExempt()` reads directly from `ThreadLocal` state on every call, with no cache in between; the staleness comes from thread reuse carrying over unrelated state, not from a cache serving an old computed result.",
    },
    {
      id: "concurrent-requests-racing-on-shared-field",
      label: "Two concurrent requests are racing on a shared, non-thread-local field.",
      explanation:
        "`ThreadLocal` specifically isolates each thread's own copy of the value from every other thread running concurrently - this isn't a concurrent race between simultaneously-running requests, it's a sequential leak from one finished request's leftover state into a later, different request that happens to reuse the same thread.",
    },
  ],
  correctOptionId: "threadlocal-never-cleared-in-pooled-thread",
  resolution: `The log lines line up precisely on one detail: both events happen on the
exact same worker thread, \`pool-4-thread-2\` - exemption is set \`true\` for
\`cust-501\`'s order, and moments later, a completely different order for
\`cust-830\` (confirmed *not* exempt) reads back \`exempt=true\` on that same
thread. \`TaxContext.java.excerpt\` shows \`exempt\` is a \`static
ThreadLocal<Boolean>\`, correctly isolating each thread's own value from
every other thread - but nothing ever calls \`exempt.remove()\` (via a
\`clear()\` method that's never defined or invoked) at the end of a
request. On a production deployment, requests are handled by a pooled
executor that reuses a fixed set of underlying \`Thread\` objects across
many, many requests over time rather than creating a new thread per
request. A \`ThreadLocal\` value set during one request and never
explicitly cleared doesn't disappear when that request ends - it stays
attached to that specific thread object indefinitely, waiting to be
silently read back by whichever unrelated future request happens to be
handled by that same reused thread next. This is exactly why it never
showed up in single-request tests (a fresh thread per test run never
carries over stale state) and only appears under real, sustained
production load with thread reuse.

The fix is always clearing \`ThreadLocal\` state at the end of the
request that set it, typically in a \`finally\` block:

\`\`\`java
public static void clear() {
    exempt.remove();   // detaches the value from this thread entirely
}

// TaxCalculator.java:
try {
    TaxContext.setExempt(customer.isTaxExempt());
    calculateTax(order);
} finally {
    TaxContext.clear();   // always runs, even if calculateTax throws
}
\`\`\`

The general rule: any \`ThreadLocal\` used in code that runs on a pooled or
reused thread must be explicitly cleared at the end of every use, in a
\`finally\` block - otherwise its value silently outlives the request that
set it and leaks into whatever unrelated work happens to run on that
same thread next.`,
};
