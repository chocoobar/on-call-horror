import type { Scenario } from "../types";

export const theConfigRefreshThatDidntStick: Scenario = {
  id: "the-config-refresh-that-didnt-stick",
  title: "The Config Refresh That Didn't Stick",
  subtitle: "promo-code-service keeps honoring a discount code that was supposed to be disabled an hour ago",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 10,
  tags: ["java25", "spring-cloud-config", "configuration"],
  briefing: `Marketing disabled the "LAUNCHDAY25" promo code in config-server after it
was accidentally left active past its expiry. The change was confirmed
synced, and \`/actuator/refresh\` returned 200. An hour later, the code is
still being accepted at checkout, and finance wants to know why revenue
is still bleeding out through a code that's supposedly off.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "promo-code-service", namespace: "commerce", labels: { app: "promo-code-service" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "promo-code-service", image: "registry.internal/promo-code-service:3.3.3" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "promo-code-service-5h6i7j8k9-l0m1n", namespace: "commerce", labels: { app: "promo-code-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "promo-code-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "promo-code-service": [
            "2026-09-15T08:00:01.110Z INFO  c.e.commerce.PromoCodeCache - loaded 42 active promo codes into local cache at startup",
            "2026-09-15T08:50:12.884Z INFO  o.s.c.e.event.RefreshEventListener - Refresh keys changed: [promo.codes.launchday25.active]",
            "2026-09-15T09:00:33.220Z INFO  c.e.commerce.CheckoutController - applying promo LAUNCHDAY25, discount 25%",
          ],
        },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "promo-code-service-notes", namespace: "commerce" },
        spec: {
          data: {
            "PromoCodeCache.java.excerpt":
              "@Component\npublic class PromoCodeCache {\n\n    @Value(\"${promo.codes.launchday25.active}\")\n    private boolean launchday25Active; // set once from Environment at\n                                        // bean construction time\n\n    @PostConstruct\n    void load() {\n        cache.put(\"LAUNCHDAY25\", launchday25Active);\n        // cache is never invalidated or reloaded after this - a\n        // refresh event updates the Environment, but nothing here\n        // reacts to it\n    }\n}\n",
          },
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "`kubectl logs promo-code-service-5h6i7j8k9-l0m1n -n commerce` - the refresh event fired and named the right key. Is `PromoCodeCache` annotated `@RefreshScope`?",
    "`@PostConstruct` runs exactly once, at bean construction - what would have to happen for `load()` to run again after a config refresh?",
    "`kubectl get configmap promo-code-service-notes -n commerce -o yaml` - the local `cache` map is populated once from a `@Value` field and never touched again. A refresh event updating the `Environment` doesn't automatically re-run `@PostConstruct`.",
  ],
  options: [
    {
      id: "postconstruct-cache-never-reloaded-on-refresh",
      label:
        "`PromoCodeCache` reads `launchday25Active` via `@Value` and populates its local `cache` map once, in `@PostConstruct`, which runs exactly once at startup; the bean isn't `@RefreshScope`, so `/actuator/refresh` genuinely updates the underlying config `Environment` but never re-triggers `load()` - the stale, cached `true` value from startup keeps being served to every checkout indefinitely.",
      explanation:
        "The log confirms the refresh mechanism itself worked - `Refresh keys changed: [promo.codes.launchday25.active]` fired correctly - yet the very next checkout still applies the code. `promo-code-service-notes` shows why: `PromoCodeCache.load()` only ever runs once, in `@PostConstruct`, populating a local map that nothing afterward ever reloads or invalidates. Without `@RefreshScope` on the bean itself, a refresh event has no way to trigger `load()` again, so the cache keeps serving the value it captured at startup, before the code was disabled.",
    },
    {
      id: "config-server-push-never-synced",
      label: "The config-server change was never actually pushed or synced to this environment.",
      explanation:
        "The refresh event log explicitly names `promo.codes.launchday25.active` as changed - proof the new value reached this application's environment - which rules out a sync failure as the cause.",
    },
    {
      id: "checkoutcontroller-hardcoded-fallback",
      label: "CheckoutController has a hardcoded fallback that ignores the promo cache entirely.",
      explanation:
        "The log shows `CheckoutController` explicitly applying the promo based on a lookup that traces back to `PromoCodeCache`'s stale value, not a separate hardcoded path - the controller is behaving correctly given the cache it's reading from.",
    },
    {
      id: "two-replicas-only-one-refreshed",
      label: "Only one of the two replicas received the refresh event; the other is still serving the old config.",
      explanation:
        "This isn't about replica-to-replica inconsistency - `PromoCodeCache`'s own local cache-loading design means *neither* replica would ever pick up the change, since `load()` never runs again on any instance after startup, refresh event or not.",
    },
  ],
  correctOptionId: "postconstruct-cache-never-reloaded-on-refresh",
  resolution: `The refresh mechanism itself is confirmed working - the log shows
\`Refresh keys changed: [promo.codes.launchday25.active]\` firing right
after marketing's config-server change. But the very next checkout, ten
minutes later, still applies the discount.

\`promo-code-service-notes\` shows why: \`PromoCodeCache\` reads its
\`launchday25Active\` flag via \`@Value\` and copies it into a local map
inside \`@PostConstruct\` - a method that, by definition, runs exactly once,
when the bean is first constructed. The bean itself carries no
\`@RefreshScope\` annotation, so \`/actuator/refresh\` has no way to trigger
\`load()\` to run again; it can update the underlying \`Environment\` all it
wants, but nothing in this bean is listening for that. The local cache
keeps serving whatever value it captured at startup - \`true\`, from before
the code was disabled - indefinitely.

The fix is either annotating the bean \`@RefreshScope\` so the whole thing
gets recreated (and \`load()\` re-run) on refresh, or explicitly listening
for the refresh event and reloading the cache:

\`\`\`java
@Component
public class PromoCodeCache {

    @EventListener(EnvironmentChangeEvent.class)
    public void onRefresh(EnvironmentChangeEvent event) {
        if (event.getKeys().stream().anyMatch(k -> k.startsWith("promo.codes."))) {
            reload();
        }
    }
}
\`\`\`

Any bean that copies a config value into its own local, long-lived cache
at construction time needs an explicit plan for staying current - a
successful \`/actuator/refresh\` only guarantees the *Environment* updated,
never that every cache built from it did too.`,
};
