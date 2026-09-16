import type { Scenario } from "../types";

export const theCacheStampedeAtMidnight: Scenario = {
  id: "the-cache-stampede-at-midnight",
  title: "The Cache Stampede at Midnight",
  subtitle: "menu-pricing-api spikes to 100% CPU across the entire fleet for thirty seconds, every night at the same time",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "caching", "spring-boot"],
  briefing: `"menu-pricing-api" caches computed menu prices with a fixed TTL to avoid
recalculating them on every request. Every night at almost exactly the
same time, every pod in the fleet spikes to full CPU simultaneously for
about thirty seconds, request latency spikes right along with it, and
then everything goes back to normal until the next night.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "menu-pricing-api", namespace: "restaurants", labels: { app: "menu-pricing-api" } },
        spec: { replicas: 6, template: { spec: { containers: [{ name: "menu-pricing-api", image: "registry.internal/menu-pricing-api:3.0.0" }] } } },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "menu-pricing-api-4z5a6b7c8-d9e0f", namespace: "restaurants", labels: { app: "menu-pricing-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "menu-pricing-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "menu-pricing-api": [
            "2026-09-15T00:00:00.110Z INFO  c.e.restaurants.PriceCache - cache entry expired for 8400 menu items simultaneously (all loaded at deploy time with the same TTL)",
            "2026-09-15T00:00:00.220Z INFO  c.e.restaurants.PriceCache - recomputing price for menu-item-2291 (cache miss, sync = true)",
            "2026-09-15T00:00:00.221Z INFO  c.e.restaurants.PriceCache - recomputing price for menu-item-2291 (cache miss, sync = true)",
            "2026-09-15T00:00:00.222Z WARN  c.e.restaurants.PriceCache - 340 concurrent requests blocked waiting on the same cache key recomputation",
          ],
        },
        age: "40d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "menu-pricing-api-notes", namespace: "restaurants" },
        spec: {
          data: {
            "PriceCache.java.excerpt":
              "@Cacheable(value = \"menuPrices\", key = \"#itemId\", sync = true)\npublic Price getPrice(String itemId) {\n    return recompute(itemId); // real work: a few DB queries + a pricing\n                                // rule evaluation, ~150ms per item\n}\n",
            "cache-config.yaml": "spring:\n  cache:\n    caffeine:\n      spec: maximumSize=10000,expireAfterWrite=24h\n",
          },
        },
        age: "40d",
      },
    ],
  },
  hints: [
    "`kubectl logs menu-pricing-api-4z5a6b7c8-d9e0f -n restaurants` - '8400 menu items simultaneously' expiring at once. When were they all originally cached, and with what TTL?",
    "`sync = true` on `@Cacheable` prevents multiple threads from recomputing the *same* key at once (a thundering herd on one key) - but does it do anything to spread out when thousands of *different* keys all expire?",
    "`kubectl get configmap menu-pricing-api-notes -n restaurants -o yaml` - `expireAfterWrite=24h` with every entry originally written at roughly the same moment (deploy time, or the last time the whole cache was cold) means they all expire together, roughly 24 hours later, at the same moment, every day.",
  ],
  options: [
    {
      id: "uniform-ttl-causes-synchronized-mass-expiry",
      label:
        "`expireAfterWrite=24h` combined with every one of the 8,400 cached menu prices having originally been written at roughly the same moment (when the cache was last cold, e.g. after a deploy) means they all expire together, at the same moment, every single day; `sync = true` prevents a thundering herd on any *one* key, but does nothing to spread out thousands of *different* keys expiring simultaneously, so every request across the whole fleet in that window triggers its own real, ~150ms recomputation at once, saturating CPU fleet-wide for as long as it takes the herd to clear.",
      explanation:
        "The log shows the exact mechanism: `cache entry expired for 8400 menu items simultaneously` followed immediately by concurrent recomputation and `340 concurrent requests blocked waiting on the same cache key recomputation`. `menu-pricing-api-notes` confirms `expireAfterWrite=24h` with no jitter or staggering - since the cache was last fully populated at roughly the same wall-clock moment (deploy time), every entry's 24-hour TTL lands at the same moment the next day, and every day after that, producing a synchronized mass-expiry and recomputation spike across the whole fleet at a consistent time each night.",
    },
    {
      id: "sync-true-itself-causing-cpu-spike",
      label: "`sync = true` on `@Cacheable` is itself the cause of the CPU spike by forcing serialized recomputation.",
      explanation:
        "`sync = true` only serializes concurrent recomputation of the *same* cache key - it doesn't force different keys to recompute one at a time, and with 8,400 different menu items expiring together, the CPU spike comes from thousands of genuinely concurrent, independent recomputations happening at once, not from `sync` forcing anything to serialize across different keys.",
    },
    {
      id: "database-nightly-maintenance-job-conflict",
      label: "A nightly database maintenance job is coincidentally running at the same time, slowing recomputation queries.",
      explanation:
        "The log attributes the spike directly to a specific, identifiable cause inside the application - 8,400 simultaneously expiring cache entries - with no indication of unusually slow individual queries; the CPU cost here is from the sheer *volume* of concurrent recomputation work, not from any one query running slower than normal.",
    },
    {
      id: "caffeine-cache-maximumsize-too-small",
      label: "Caffeine's `maximumSize=10000` is too small, causing frequent evictions under normal load.",
      explanation:
        "10,000 as a maximum size comfortably exceeds the 8,400 actual menu items being cached - there's no indication of size-based eviction pressure here; the entries are expiring due to their TTL all landing at the same moment, not being evicted early due to the cache running out of capacity.",
    },
  ],
  correctOptionId: "uniform-ttl-causes-synchronized-mass-expiry",
  resolution: `The log names the trigger explicitly: \`cache entry expired for 8400 menu
items simultaneously\`, immediately followed by a burst of concurrent
recomputations and a warning about hundreds of requests blocked waiting
on a single key's recomputation. \`menu-pricing-api-notes\` explains why
thousands of entries would ever expire at the exact same instant:
\`expireAfterWrite=24h\` with no jitter, combined with every entry having
originally been written to the cache at roughly the same wall-clock
moment - most likely when the cache was last cold, such as right after a
deploy. A uniform TTL applied to entries all written together means they
all expire together, and since nothing ever staggers that, the same
synchronized expiry - and the same CPU spike as thousands of independent,
real ~150ms recomputations fire off within the same second - repeats
every single night at essentially the same time.

\`sync = true\` is doing exactly what it's meant to (preventing multiple
threads from redundantly recomputing the *same* key concurrently), but
it has no effect on the much larger problem: thousands of *different*
keys all needing recomputation in the same narrow window, each one a
real, independent chunk of CPU work.

The fix is adding jitter to each entry's effective TTL so expirations
spread out over time instead of landing in lockstep:

\`\`\`java
@Cacheable(value = "menuPrices", key = "#itemId", sync = true)
public Price getPrice(String itemId) {
    return recompute(itemId);
}

// custom Caffeine expiry with per-entry jitter instead of a uniform
// expireAfterWrite, spreading expirations across a window rather than
// a single instant
Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfter(new Expiry<String, Price>() {
        public long expireAfterCreate(String key, Price price, long currentTime) {
            long baseNanos = Duration.ofHours(24).toNanos();
            long jitterNanos = Duration.ofMinutes(ThreadLocalRandom.current().nextInt(0, 120)).toNanos();
            return baseNanos + jitterNanos;
        }
        // expireAfterUpdate / expireAfterRead delegate similarly
    });
\`\`\`

Any cache whose entries were all populated together and share one uniform
TTL is at risk of exactly this pattern - a small amount of randomized
jitter added to each entry's expiry is enough to turn one sharp,
synchronized spike into a smooth, unnoticeable trickle of background
recomputation.`,
};
