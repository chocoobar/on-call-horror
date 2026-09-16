import type { Scenario } from "./types";

export const theTwoSchedulersRace: Scenario = {
  id: "the-two-schedulers-race",
  title: "The Two Schedulers Race",
  subtitle: "cache-warmer's in-memory warm-set ends up corrupted a few times a week, always around the same overlapping window",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "scheduling", "spring-boot"],
  briefing: `"cache-warmer" periodically refreshes an in-memory set of "hot" product
IDs used to pre-warm a downstream cache. A few times a week, the warm-set
ends up visibly corrupted - a mix of half-updated and stale entries -
right around the same time of day, then self-corrects on the next cycle.
Nobody's found a single buggy update; the update logic itself looks
correct in isolation.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "cache-warmer", namespace: "platform", labels: { app: "cache-warmer" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "cache-warmer", image: "registry.internal/cache-warmer:1.2.1" }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "25d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "cache-warmer-2x3y4z5a6-b7c8d", namespace: "platform", labels: { app: "cache-warmer" } },
        status: { phase: "Running", containerStatuses: [{ name: "cache-warmer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "cache-warmer": [
            "2026-09-15T06:00:00.010Z INFO  c.e.platform.WarmSetRefresher - [hourly] beginning warm-set refresh, clearing current set",
            "2026-09-15T06:00:00.014Z INFO  c.e.platform.WarmSetRefresher - [daily-full-rebuild] beginning warm-set refresh, clearing current set",
            "2026-09-15T06:00:02.884Z INFO  c.e.platform.WarmSetRefresher - [hourly] populated 1200 entries",
            "2026-09-15T06:00:03.110Z INFO  c.e.platform.WarmSetRefresher - [daily-full-rebuild] populated 8400 entries",
          ],
        },
        age: "25d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cache-warmer-notes", namespace: "platform" },
        spec: {
          data: {
            "WarmSetRefresher.java.excerpt":
              "private final Set<String> warmSet = ConcurrentHashMap.newKeySet();\n\n@Scheduled(fixedRate = 3600000) // every hour, on a floating schedule\n                                 // from application start time\npublic void hourlyRefresh() {\n    warmSet.clear();\n    warmSet.addAll(fetchTopProducts(1200));\n}\n\n@Scheduled(cron = \"0 0 6 * * *\") // once daily at 6am, wall-clock\npublic void dailyFullRebuild() {\n    warmSet.clear();\n    warmSet.addAll(fetchAllEligibleProducts()); // up to 8400 entries,\n                                                  // takes a couple\n                                                  // seconds to fetch\n                                                  // and populate\n}\n",
          },
        },
        age: "25d",
      },
    ],
  },
  hints: [
    "`kubectl logs cache-warmer-2x3y4z5a6-b7c8d -n platform` - two separate `[...]`-prefixed log lines both say 'beginning warm-set refresh, clearing current set,' four milliseconds apart. Are these the same scheduled method?",
    "One trigger is `fixedRate`, floating relative to when the app started. The other is a fixed daily `cron` time. On any given day, could those two ever land close enough together to overlap?",
    "`kubectl get configmap cache-warmer-notes -n platform -o yaml` - both methods call `warmSet.clear()` and then populate it over a couple of seconds. What happens to `warmSet`'s contents if both methods are clearing and repopulating it concurrently, interleaved?",
  ],
  options: [
    {
      id: "two-independent-schedules-happen-to-overlap-on-shared-mutable-set",
      label:
        "`hourlyRefresh()` (a floating `fixedRate` schedule tied to app start time) and `dailyFullRebuild()` (a fixed daily `cron` schedule) both operate on the same shared `warmSet`, each independently calling `.clear()` and then repopulating it over a couple of seconds; since the hourly schedule's timing drifts relative to wall-clock time based on when the app last started, it periodically lands close enough to the daily cron's fixed 6am trigger that both run concurrently, interleaving their clear-and-repopulate operations on the same set and producing exactly the kind of half-updated, mixed-stale corruption observed - which then self-corrects on the next cycle once the two schedules drift apart again.",
      explanation:
        "The logs show both `[hourly]` and `[daily-full-rebuild]` beginning a refresh - including a `.clear()` - within four milliseconds of each other, then both populating the set moments apart. `cache-warmer-notes` confirms both methods share one mutable `warmSet` with no coordination between them; `hourlyRefresh` runs on a `fixedRate` schedule that floats relative to application start time (drifting across restarts and redeploys) while `dailyFullRebuild` runs on a fixed wall-clock `cron` trigger - meaning the two schedules are only sometimes close together, explaining why the corruption is intermittent (a few times a week) rather than constant, exactly matching the reported pattern.",
    },
    {
      id: "concurrenthashmap-keyset-not-thread-safe",
      label: "`ConcurrentHashMap.newKeySet()` isn't actually thread-safe for concurrent modification.",
      explanation:
        "`ConcurrentHashMap`'s key set is genuinely thread-safe for individual concurrent operations - the corruption here isn't from an unsafe data structure throwing an exception or corrupting its own internal state, it's from two *independent, unsynchronized sequences* of clear-then-repopulate calls interleaving with each other, which any single thread-safe collection would still allow without an explicit coordination mechanism between the two callers.",
    },
    {
      id: "fetchtopproducts-returning-stale-data",
      label: "`fetchTopProducts()` itself is intermittently returning stale or incorrect data.",
      explanation:
        "The logs show both scheduled methods completing their own population steps with plausible entry counts (1200 and 8400) - there's no indication either fetch method itself returned bad data; the corruption comes from the two methods' clear-and-populate sequences interleaving on one shared set, not from either one individually fetching wrong data.",
    },
    {
      id: "single-replica-restarting-mid-refresh",
      label: "The single replica is restarting mid-refresh, leaving the warm-set in a partial state.",
      explanation:
        "`restartCount` is `0` and there's no restart event around the time of the corruption - both scheduled methods run to completion according to their own log lines (`populated 1200 entries`, `populated 8400 entries`), which rules out an interrupted restart as the cause.",
    },
  ],
  correctOptionId: "two-independent-schedules-happen-to-overlap-on-shared-mutable-set",
  resolution: `The logs show two distinctly-named refreshes - \`[hourly]\` and
\`[daily-full-rebuild]\` - both beginning and both calling \`.clear()\` on
the same set within four milliseconds of each other, then completing
their own population steps moments apart. Two supposedly independent
scheduled jobs, both mutating the exact same shared collection at nearly
the same moment.

\`cache-warmer-notes\` shows why this only happens intermittently rather
than constantly: \`hourlyRefresh()\` runs on \`@Scheduled(fixedRate =
3600000)\`, a schedule that fires every hour *relative to when the
application last started* - meaning its actual wall-clock trigger time
drifts across restarts and redeploys. \`dailyFullRebuild()\`, meanwhile,
runs on a fixed \`cron\` trigger, always at 6am sharp. Most days, these two
schedules land comfortably apart. But because the hourly schedule floats,
it periodically drifts close enough to 6am that both jobs' several-second
clear-and-repopulate windows overlap - and since neither method
coordinates with the other at all, their interleaved \`.clear()\` and
\`.addAll()\` calls on the same shared \`warmSet\` produce exactly the kind
of half-updated, partially-stale mix reported, which resolves itself once
the next cycle runs to completion without another overlap.

The fix is coordinating access to the shared set so the two refreshes
can never interleave, regardless of how their schedules happen to align:

\`\`\`java
private final ReentrantLock refreshLock = new ReentrantLock();

@Scheduled(fixedRate = 3600000)
public void hourlyRefresh() {
    refreshLock.lock();
    try {
        warmSet.clear();
        warmSet.addAll(fetchTopProducts(1200));
    } finally {
        refreshLock.unlock();
    }
}

@Scheduled(cron = "0 0 6 * * *")
public void dailyFullRebuild() {
    refreshLock.lock();
    try {
        warmSet.clear();
        warmSet.addAll(fetchAllEligibleProducts());
    } finally {
        refreshLock.unlock();
    }
}
\`\`\`

An even simpler fix worth considering: build each refresh into a brand
new set and atomically swap a reference, rather than clearing and
repopulating one shared mutable set in place - that removes the
interleaving window entirely, rather than just serializing around it.`,
};
