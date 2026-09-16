import type { Scenario } from "./types";

export const theCacheKeyThatNeverMatched: Scenario = {
  id: "the-cache-key-that-never-matched",
  title: "The Cache Key That Never Matched",
  subtitle: "the product-recommendation cache has a suspiciously perfect hit rate of exactly zero percent, despite obviously repeated lookups",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "caching", "hashcode"],
  briefing: `"recommendation-cache" is meant to avoid recomputing product
recommendations for the same category combination requested repeatedly
within a short window. Metrics show it's never once served a cache hit
since it was deployed, even though the exact same category list is
visibly requested back-to-back in the access logs, seconds apart.`,
  constraints: [
    "The category list passed into the cache lookup is confirmed to contain the exact same category strings, in the exact same order, on each repeated request.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-cache", namespace: "recommendations", labels: { app: "recommendation-cache" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "recommendation-cache-2o3p4q5r6-s7t8u", namespace: "recommendations", labels: { app: "recommendation-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "recommendation-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "recommendation-cache": [
            "2026-09-15T11:30:02.114Z DEBUG c.e.recommendations.RecCache - storing entry for categories=[electronics, audio]",
            "2026-09-15T11:30:07.220Z DEBUG c.e.recommendations.RecCache - lookup for categories=[electronics, audio] -> MISS",
          ],
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "recommendation-cache-notes", namespace: "recommendations" },
        spec: {
          data: {
            "RecCache.java.excerpt":
              "private final Map<List<String>, List<Product>> cache = new HashMap<>();\n\npublic List<Product> lookup(List<String> categories) {\n    return cache.get(categories);   // categories is a fresh ArrayList\n        // built freshly per request from query parameters - never the\n        // same List object twice, but should be content-equal\n}\n\npublic void store(List<String> categories, List<Product> recs) {\n    cache.put(categories, recs);\n}\n",
              "RequestParser.java.excerpt":
              "public List<String> parseCategories(HttpRequest req) {\n    // categories are parsed into a List implementation that does NOT\n    // override equals()/hashCode() - a custom lightweight list type used\n    // elsewhere in this codebase for query-parameter parsing performance\n    return new FastQueryList<>(req.getParams(\"category\"));\n}\n",
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap recommendation-cache-notes -n recommendations -o yaml` - `cache` is a `HashMap<List<String>, ...>` keyed by a `List`. What does `RequestParser.parseCategories` actually return as that list?",
    "`FastQueryList` is described as not overriding `equals()`/`hashCode()` - what does a `HashMap` lookup depend on for a key type that uses `Object`'s default, identity-based `equals()`/`hashCode()`?",
    "Two different `FastQueryList` instances built from the exact same category strings, on two different requests, are two different objects - under identity-based `equals()`/`hashCode()`, are they ever going to be seen as the same map key?",
  ],
  options: [
    {
      id: "custom-list-type-missing-equals-hashcode-as-map-key",
      label:
        "`cache` is keyed by `List<String>`, but the actual runtime type produced by `RequestParser.parseCategories` is `FastQueryList`, a custom list implementation that never overrides `equals()`/`hashCode()` and therefore uses `Object`'s default, identity-based versions - two `FastQueryList` instances built from identical category strings on two different requests are two distinct objects, never equal under identity-based comparison, so every lookup against the `HashMap` misses, regardless of how identical the actual category content is between requests.",
      explanation:
        "The debug log shows an entry stored for `[electronics, audio]`, then a lookup for the visibly identical `[electronics, audio]` five seconds later reported as a `MISS`. `RequestParser.java.excerpt` reveals the actual key type is `FastQueryList`, explicitly noted as not overriding `equals()`/`hashCode()` - meaning it inherits `Object`'s default identity-based implementations. `RecCache.java.excerpt` confirms `categories` is a fresh list built per request, never the same object twice. Since `HashMap` relies on the key type's `equals()`/`hashCode()` for lookup, and `FastQueryList` compares by object identity rather than content, no two independently-built `FastQueryList` instances - however identical their contents - are ever considered equal keys, guaranteeing a 100% miss rate regardless of how often the exact same category combination is actually requested.",
    },
    {
      id: "cache-ttl-expiring-immediately",
      label: "The cache's time-to-live setting is misconfigured to expire entries almost immediately.",
      explanation:
        "There's no TTL or expiration logic shown anywhere in `RecCache` at all - `cache` is a plain `HashMap` with no eviction policy; the miss is happening because the lookup key never matches the stored key, not because a matching entry expired before it could be found.",
    },
    {
      id: "two-pods-splitting-cache-traffic",
      label: "Requests are being load-balanced across two separate pods, each with its own independent in-memory cache.",
      explanation:
        "While it's true each pod would have its own independent cache with only two replicas, the debug log shown is from a single pod's own logs, showing a store followed by a same-pod lookup within seconds - the miss is happening even for lookups that do land on the very pod that stored the entry.",
    },
    {
      id: "product-list-serialization-corrupting-cached-value",
      label: "The cached `List<Product>` value is being corrupted during storage, causing lookups to fail validation.",
      explanation:
        "The log reports a clean `MISS`, not a corrupted-value or deserialization error - a `HashMap.get()` that fails to find a matching key returns `null`/reports a miss cleanly regardless of what the stored value would have been; this is a key-matching problem, not a value-corruption one.",
    },
  ],
  correctOptionId: "custom-list-type-missing-equals-hashcode-as-map-key",
  resolution: `The debug log shows an entry stored for \`[electronics, audio]\`, and a
lookup for the visibly identical category list, seconds later, reported
as a clean \`MISS\` - not an error, just a straightforward failure to find
a matching key. \`RequestParser.java.excerpt\` reveals the actual key
type flowing into the cache isn't a standard \`ArrayList\` but
\`FastQueryList\`, a custom lightweight list implementation used elsewhere
for query-parameter parsing performance - and explicitly noted as never
overriding \`equals()\`/\`hashCode()\`, meaning it falls back to \`Object\`'s
default, identity-based implementations. \`RecCache\`'s \`HashMap<List<String>, ...>\`
relies entirely on the key type's \`equals()\`/\`hashCode()\` to find a
matching entry - and since \`categories\` is built fresh per request
(confirmed in \`RecCache.java.excerpt\`'s own comment), no two requests
ever produce the exact same \`FastQueryList\` object, only ever
content-identical *different* objects. Under identity-based comparison,
two different objects are never equal, no matter how identical their
actual contents are - guaranteeing every single lookup misses, forever,
regardless of how often the same category combination is genuinely
requested.

The fix is using a key type that compares by content, either a standard
`List` implementation (which correctly implements value-based
`equals()`/`hashCode()`) or an explicit override on the custom type:

\`\`\`java
public List<String> parseCategories(HttpRequest req) {
    return new ArrayList<>(req.getParams("category"));   // standard List:
        // equals()/hashCode() compare by content, correctly
}
\`\`\`

The general rule: any type used as a `HashMap`/`HashSet` key must have
`equals()`/`hashCode()` that compare by the content that actually
identifies "the same key" - a custom collection or wrapper type that
skips this (often for a narrow performance reason unrelated to its use
as a map key) will silently defeat any `HashMap`-based cache or
deduplication built on top of it, with no error, just a permanently
empty-seeming cache.`,
};
