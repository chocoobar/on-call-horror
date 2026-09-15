import type { Scenario } from "./types";

export const theIteratorThatSkippedARecord: Scenario = {
  id: "the-iterator-that-skipped-a-record",
  title: "The Iterator That Skipped a Record",
  subtitle: "the expired-coupon cleanup job always leaves exactly one expired coupon behind, right after a removed one",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "collections", "iteration"],
  briefing: `The nightly job that purges expired coupons from the in-memory promo
cache reports success every night, but support keeps finding expired
coupons that still redeem successfully. It's always the coupon
immediately following one that legitimately got removed.`,
  constraints: [
    "The expiration check itself is confirmed correct - every coupon the job examines is correctly classified as expired or not.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "coupon-cleanup", namespace: "promotions", labels: { app: "coupon-cleanup" } },
        spec: { schedule: "0 3 * * *" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "coupon-cleanup-28901398-r0s1t", namespace: "promotions", labels: { app: "coupon-cleanup" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "coupon-cleanup", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "coupon-cleanup": [
            "2026-09-15T03:00:01.114Z INFO  c.e.promotions.CouponCleanup - starting cleanup, 3 candidates: [SAVE10(expired), SAVE20(expired), SAVE30(active)]",
            "2026-09-15T03:00:01.118Z INFO  c.e.promotions.CouponCleanup - removed SAVE10",
            "2026-09-15T03:00:01.119Z INFO  c.e.promotions.CouponCleanup - cleanup complete, 2 coupons remain: [SAVE20(expired), SAVE30(active)]",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "coupon-cleanup-notes", namespace: "promotions" },
        spec: {
          data: {
            "CouponCleanup.java.excerpt":
              "public void cleanup(List<Coupon> coupons) {\n    for (int i = 0; i < coupons.size(); i++) {\n        Coupon coupon = coupons.get(i);\n        if (coupon.isExpired()) {\n            coupons.remove(i);   // shifts every subsequent element left by one,\n                                  // but `i` still advances by one next iteration\n        }\n    }\n}\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs coupon-cleanup-28901398-r0s1t -n promotions` - `SAVE10` and `SAVE20` were both expired, but only `SAVE10` was removed. Walk through the loop by hand with these three coupons.",
    "`kubectl get configmap coupon-cleanup-notes -n promotions -o yaml` - when `coupons.remove(i)` removes an element, every element after it shifts down one index. What does the loop's index variable do on the very next iteration?",
    "After removing index `i`, the element that used to be at `i + 1` is now sitting at index `i` - but the `for` loop increments `i` regardless, jumping straight past it without ever examining it.",
  ],
  options: [
    {
      id: "list-remove-during-indexed-loop-skips-next-element",
      label:
        "`cleanup` removes elements by index while iterating forward with a plain indexed `for` loop - removing the element at index `i` shifts every later element down by one position, so the element that used to follow the removed one now sits at index `i`, but the loop's `i++` advances past it anyway on the next iteration without ever checking it, silently skipping evaluation of exactly the coupon right after any one that gets removed.",
      explanation:
        "The log shows `SAVE10` and `SAVE20` both classified as expired, but only `SAVE10` actually gets removed - `SAVE20` survives cleanup. `CouponCleanup.java.excerpt` removes by index inside a forward `for` loop: removing index `0` (`SAVE10`) shifts `SAVE20` down from index `1` to index `0`, but the loop then increments `i` to `1` and reads whatever is *now* at index `1` (`SAVE30`), skipping over `SAVE20` (now sitting at the index the loop just left behind) entirely - it's never even examined a second time.",
    },
    {
      id: "coupon-expiration-check-flaky",
      label: "`isExpired()` is intermittently returning the wrong result for some coupons.",
      explanation:
        "The log explicitly shows `SAVE20` correctly classified as `(expired)` in the initial candidate listing - the expiration check itself correctly identifies it; it's just never actually reached again after the list shifts underneath the loop.",
    },
    {
      id: "cronjob-running-with-stale-coupon-list",
      label: "The CronJob is running against a stale, cached snapshot of the coupon list.",
      explanation:
        "The log shows the job correctly seeing all three current coupons, including the correct expiration status for each - the data going into the job is accurate and current; what happens to it during the removal loop is where the bug lives.",
    },
    {
      id: "concurrent-coupon-redemption-during-cleanup",
      label: "Coupons are being redeemed concurrently by customers while cleanup runs, racing with the removal.",
      explanation:
        "This is a single-threaded batch job with a completely deterministic, reproducible outcome every single run given the same input order - no concurrent access is needed to explain a coupon being skipped; the indexed removal loop alone fully accounts for it.",
    },
  ],
  correctOptionId: "list-remove-during-indexed-loop-skips-next-element",
  resolution: `Walking the log by hand shows it precisely: starting candidates are
\`[SAVE10(expired), SAVE20(expired), SAVE30(active)]\` at indices \`0\`, \`1\`,
\`2\`. \`CouponCleanup.java.excerpt\` removes \`SAVE10\` at index \`0\` -
\`List.remove(int)\` shifts every later element down by one, so \`SAVE20\`
moves from index \`1\` to index \`0\`, and \`SAVE30\` moves from index \`2\` to
index \`1\`. But the \`for\` loop doesn't know this happened - it blindly
increments \`i\` from \`0\` to \`1\` and reads whatever is now sitting at index
\`1\`, which is \`SAVE30\`, not \`SAVE20\`. \`SAVE20\`, now at index \`0\`, is never
looked at again for the rest of this loop's execution, so it survives
cleanup despite being correctly identified as expired - exactly matching
the reported pattern of the coupon right after any removed one surviving.

The fix is either iterating backward (so removals never shift
not-yet-visited indices) or using an explicit `Iterator` and its own
`remove()` method, which is specifically designed to handle this
correctly:

\`\`\`java
public void cleanup(List<Coupon> coupons) {
    Iterator<Coupon> it = coupons.iterator();
    while (it.hasNext()) {
        if (it.next().isExpired()) {
            it.remove();   // safe - the iterator tracks its own position correctly
        }
    }
}
\`\`\`

The general rule: removing elements from a `List` by index while
iterating it forward with a plain indexed loop silently skips the
element immediately following each removal - use `Iterator.remove()`,
iterate backward, or build a new filtered list instead of mutating one
in place while walking it forward.`,
};
