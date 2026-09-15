import type { Scenario } from "./types";

export const theKeyThatChangedItsMind: Scenario = {
  id: "the-key-that-changed-its-mind",
  title: "The Key That Changed Its Mind",
  subtitle: "a customer's session cache entry becomes permanently unreachable the moment their cart total updates",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "hashmap", "mutable-keys"],
  briefing: `"session-cache" keeps an in-memory `HashMap` keyed by a `CartKey` object
built from a customer's session and current cart total, used to quickly
look up cached pricing calculations. Once a customer adds an item and
their cart total changes, the previously cached entry for that same
session becomes permanently unreachable - not evicted, just silently
un-findable - leaking memory slowly over the day.`,
  constraints: [
    "The cache is confirmed to never explicitly call `.remove(...)` on these entries anywhere - they're meant to either be found and reused, or naturally expire, never silently orphaned.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-cache", namespace: "cart", labels: { app: "session-cache" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "session-cache-2t3u4v5w6-x7y8z", namespace: "cart", labels: { app: "session-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "session-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "session-cache": [
            "2026-09-15T11:00:01.114Z DEBUG c.e.cart.SessionCache - cached pricing for key=CartKey(session=sess-771, total=42.00) hash=118201",
            "2026-09-15T11:00:19.220Z DEBUG c.e.cart.SessionCache - cart total updated in place: sess-771 total 42.00 -> 55.00",
            "2026-09-15T11:00:19.224Z WARN  c.e.cart.SessionCache - lookup for key=CartKey(session=sess-771, total=42.00) hash=161904 miss (map size unaffected, entry presumed orphaned)",
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "session-cache-notes", namespace: "cart" },
        spec: {
          data: {
            "CartKey.java.excerpt":
              "public class CartKey {\n    private final String session;\n    private double total;   // mutable - updated in place as the cart changes\n\n    public void updateTotal(double newTotal) {\n        this.total = newTotal;\n    }\n\n    @Override\n    public boolean equals(Object o) {\n        if (!(o instanceof CartKey k)) return false;\n        return session.equals(k.session) && total == k.total;\n    }\n\n    @Override\n    public int hashCode() {\n        return Objects.hash(session, total);   // depends on the same mutable field\n    }\n}\n\n// this same CartKey instance is stored as a HashMap key, then later\n// mutated in place via updateTotal() rather than replaced\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl logs session-cache-2t3u4v5w6-x7y8z -n cart` - the same logical key's `hash` value changes between when it was inserted and when it's looked up. Same object, or same field values?",
    "`kubectl get configmap session-cache-notes -n cart -o yaml` - `CartKey`'s `hashCode()` (and `equals()`) both depend on the mutable `total` field. What happens when that field changes *after* the object is already a `HashMap` key?",
    "A `HashMap` places an entry into an internal bucket based on the key's `hashCode()` *at the time of insertion* - if a key object is later mutated such that its `hashCode()` would now be different, the entry stays in its original bucket, but a `get()` with an equal-valued key computes a new hash and looks in a different bucket entirely.",
  ],
  options: [
    {
      id: "mutable-hashmap-key-hashcode-changed-after-insertion",
      label:
        "`CartKey` is mutable - its `total` field is updated in place via `updateTotal()` after the object has already been used as a `HashMap` key - and both `hashCode()` and `equals()` depend on that same mutable field; once `total` changes, the key's hash code changes too, but the map entry stays sitting in the bucket determined by its *original* hash, so any later lookup (which computes a fresh hash from the key's current field values) looks in the wrong bucket entirely and never finds the entry, even though it's still sitting in the map, permanently orphaned.",
      explanation:
        "The log shows the exact mechanism: the entry is inserted with `hash=118201`, the cart total is then updated in place, and a subsequent lookup for what's logically 'the same' key computes `hash=161904` - a different hash entirely - and misses. `CartKey.java.excerpt` confirms both `hashCode()` and `equals()` depend on the mutable `total` field, and that the same `CartKey` instance is mutated via `updateTotal()` after being stored as a map key rather than being replaced with a new key object. `HashMap` places entries into buckets based on hash code at insertion time and never re-buckets them if a key's hash code changes later - so the orphaned entry is still physically present in the map (explaining why map size is unaffected), just permanently unreachable by any correctly-computed lookup from that point forward.",
    },
    {
      id: "concurrent-cart-updates-racing",
      label: "Multiple threads updating the same session's cart concurrently are racing on the cache.",
      explanation:
        "The sequence shown is a single, deterministic, single-threaded flow - insert, then an in-place field mutation, then a miss - fully explained by mutable-key hashing behavior with no concurrency involved, and reproducible every single time regardless of timing.",
    },
    {
      id: "cache-eviction-policy-too-aggressive",
      label: "The cache's eviction policy is too aggressive and is removing entries prematurely.",
      explanation:
        "The warning log explicitly notes 'map size unaffected' - the entry was never evicted or removed at all, it's still physically present in the map; it's simply unreachable by lookup because of where it ended up bucketed versus where a fresh hash computation looks for it.",
    },
    {
      id: "objects-hash-method-unstable-across-jvm-restarts",
      label: "`Objects.hash(...)`'s output is unstable across JVM restarts, invalidating cached keys.",
      explanation:
        "This entire sequence - insertion, mutation, and failed lookup - happens within a single, continuously running process with no restart involved; `Objects.hash`'s output for a given set of field values is stable within one running JVM, and the problem here is that the field values themselves changed after insertion, not that the hashing algorithm's output varied for unchanged inputs.",
    },
  ],
  correctOptionId: "mutable-hashmap-key-hashcode-changed-after-insertion",
  resolution: `The debug log shows the hash values directly: the entry is inserted with
\`hash=118201\`, then - after the cart total is updated *in place* on the
same key object via \`updateTotal()\` - a lookup for what's logically the
same session computes \`hash=161904\`, a completely different bucket, and
misses. \`CartKey.java.excerpt\` explains why: both \`hashCode()\` and
\`equals()\` are computed from the mutable \`total\` field, and the same
\`CartKey\` object is mutated after already being used as a \`HashMap\` key,
rather than being discarded and replaced with a fresh key object.
\`HashMap\` places every entry into an internal bucket chosen by the key's
\`hashCode()\` *at the moment of insertion*, and never revisits that
placement later - it has no way to know a key object sitting inside it
has since changed. Once \`total\` changes, the stored entry is still
sitting in its original bucket, but a lookup computing \`equals()\`/
\`hashCode()\` from the key's *current* field values searches in the
bucket that current hash points to instead - a different bucket - and
never finds it. The entry isn't evicted or removed; it's simply
permanently orphaned, unreachable and leaking memory for the rest of the
map's lifetime.

The fix is never mutating an object already in use as a map key - build
a new key (or make `CartKey` immutable) instead of updating one in
place:

\`\`\`java
public class CartKey {
    private final String session;
    private final double total;   // final - no updateTotal() method at all

    public CartKey(String session, double total) {
        this.session = session;
        this.total = total;
    }
    // equals()/hashCode() unchanged - now genuinely stable for the
    // object's entire lifetime
}

// callers replace the map entry instead of mutating the key in place:
cache.remove(oldKey);
cache.put(new CartKey(session, newTotal), cachedValue);
\`\`\`

The general rule: any object used as a `HashMap`/`HashSet` key must be
effectively immutable, at minimum in every field `equals()`/`hashCode()`
depend on - mutating a key after insertion breaks the map's internal
bucket invariant and produces entries that are still present but
permanently unfindable.`,
};
