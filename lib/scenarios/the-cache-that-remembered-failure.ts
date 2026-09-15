import type { Scenario } from "./types";

export const theCacheThatRememberedFailure: Scenario = {
  id: "the-cache-that-remembered-failure",
  title: "The Cache That Remembered Failure",
  subtitle: "product-lookup-api keeps returning 'not found' for a product that's been live for hours",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "caching", "spring-boot"],
  briefing: `A new product went live in the catalog at 9:00am. By noon, customer
support is fielding complaints that "product-lookup-api" still returns
404 for it, even though the catalog database has had the record since
launch. Other products added around the same time are working fine.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "product-lookup-api", namespace: "catalog", labels: { app: "product-lookup-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "product-lookup-api", image: "registry.internal/product-lookup-api:2.6.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "product-lookup-api-1p2q3r4s5-t6u7v", namespace: "catalog", labels: { app: "product-lookup-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "product-lookup-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "product-lookup-api": [
            "2026-09-15T08:59:41.100Z WARN  c.e.catalog.ProductService - lookup for sku SKU-99213 returned 404 (not yet published, racing catalog rollout)",
            "2026-09-15T08:59:41.104Z INFO  c.e.catalog.ProductService - caching result for SKU-99213 (cache miss stored)",
            "2026-09-15T12:04:10.221Z INFO  c.e.catalog.ProductService - lookup for sku SKU-99213 served from cache (not found)",
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "product-lookup-api-notes", namespace: "catalog" },
        spec: {
          data: {
            "ProductService.java.excerpt":
              "@Cacheable(value = \"products\", key = \"#sku\")\npublic Product lookup(String sku) {\n    return catalogRepository.findBySku(sku)\n        .orElse(null); // caches the null result too - no TTL, no\n                        // distinction between 'not found (yet)' and\n                        // 'genuinely doesn't exist'\n}\n",
            "cache-config.yaml": "spring:\n  cache:\n    cache-names: products\n    caffeine:\n      spec: maximumSize=50000\n      # no expireAfterWrite configured\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl logs product-lookup-api-1p2q3r4s5-t6u7v -n catalog` - the very first lookup for this SKU happened one minute before the product went live. What did that lookup return, and what happened to that result?",
    "`kubectl get configmap product-lookup-api-notes -n catalog -o yaml` - what does `@Cacheable` do when the method it wraps returns `null`? Is there any expiry configured on this cache?",
    "A 404 lookup and a successful lookup for the same key would both be cached under `@Cacheable` unless the code explicitly tells it not to cache a particular outcome.",
  ],
  options: [
    {
      id: "cacheable-caches-null-forever",
      label:
        "`ProductService.lookup()` is `@Cacheable` and returns `null` when the product isn't found yet, which Spring's cache abstraction happily caches like any other result; with no `expireAfterWrite` configured, that one early 404 - from a request that raced the catalog rollout by a minute - gets stuck in the cache indefinitely, so every later request for the same SKU is served the cached 'not found' instead of ever hitting the database again.",
      explanation:
        "The logs show the exact sequence: a lookup at 08:59:41, one minute before the product went live, returns not-found and is explicitly logged as `caching result ... (cache miss stored)`. Every subsequent lookup - including one hours later at 12:04 - is `served from cache (not found)`, never touching the database again. `product-lookup-api-notes` confirms `@Cacheable` caches the `null` result from `.orElse(null)` with no distinction from a real hit, and `cache-config.yaml` has no `expireAfterWrite` set, so that one unlucky early miss never expires.",
    },
    {
      id: "database-replication-lag",
      label: "Database read-replica replication lag is causing the lookup to miss the new record.",
      explanation:
        "The logs show the app explicitly serving the result *from cache*, not making a fresh database query that could be affected by replication lag - `served from cache (not found)` at 12:04 means the database was never queried again after the initial miss hours earlier.",
    },
    {
      id: "product-not-actually-published",
      label: "The product record itself was never actually committed to the catalog database.",
      explanation:
        "Support and the catalog team confirm the record has existed since launch, and the scenario is specifically about a cached negative result masking a real record - there's no database-side evidence here suggesting the write itself failed.",
    },
    {
      id: "two-replicas-inconsistent-cache",
      label: "The two replicas have inconsistent local caches, so results depend on which pod handles the request.",
      explanation:
        "Every lookup for this SKU is failing consistently regardless of which pod serves it, which points at both instances independently caching the same early negative result under the same conditions, not at instance-to-instance inconsistency.",
    },
  ],
  correctOptionId: "cacheable-caches-null-forever",
  resolution: `The logs lay out the exact timeline: at 08:59:41 - one minute before the
product actually went live - a lookup for \`SKU-99213\` returns not-found,
and the very next log line confirms it: \`caching result for SKU-99213
(cache miss stored)\`. Every lookup afterward, including one more than
three hours later, is explicitly \`served from cache (not found)\` - the
database is never queried again.

\`product-lookup-api-notes\` shows why: \`lookup()\` is annotated
\`@Cacheable\`, and its body returns \`null\` via \`.orElse(null)\` when the
product isn't found. Spring's cache abstraction treats that \`null\` as a
perfectly valid, cacheable result, with no built-in distinction between
"genuinely doesn't exist" and "not found *yet*." \`cache-config.yaml\`
compounds the problem: there's no \`expireAfterWrite\` configured, so
whatever gets cached - including that one unlucky early miss that raced
the catalog rollout by sixty seconds - stays cached forever.

Two fixes belong together here: stop caching negative results outright
(or cache them with a short, explicit TTL), using \`unless\` to skip caching
a \`null\`:

\`\`\`java
@Cacheable(value = "products", key = "#sku", unless = "#result == null")
public Product lookup(String sku) {
    return catalogRepository.findBySku(sku).orElse(null);
}
\`\`\`

and adding a bounded expiry to the cache itself, so any result that does
get cached - positive or negative - can't outlive being wrong for more
than a few minutes:

\`\`\`yaml
spring:
  cache:
    caffeine:
      spec: maximumSize=50000,expireAfterWrite=2m
\`\`\`

Caching a "not found" result without either of these guards is a classic
trap: it's completely invisible under normal conditions, and only bites
when a lookup happens to race the very write that would have made it
succeed.`,
};
