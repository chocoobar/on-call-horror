import type { Scenario } from "./types";

export const theRefreshScopeOnTheWrongBean: Scenario = {
  id: "the-refresh-scope-on-the-wrong-bean",
  title: "The @RefreshScope on the Wrong Bean",
  subtitle: "surge-pricing-api ignores config-server updates despite @RefreshScope being right there in the code",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "spring-cloud-config", "configuration"],
  briefing: `Ops pushed a new surge multiplier to config-server and confirmed the
refresh event fired successfully. "surge-pricing-api" is annotated with
\`@RefreshScope\` exactly where the team expects it to matter - and yet
every quote still uses the old multiplier, five minutes later, ten
minutes later, indefinitely.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "surge-pricing-api", namespace: "rideshare", labels: { app: "surge-pricing-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "surge-pricing-api", image: "registry.internal/surge-pricing-api:2.1.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "surge-pricing-api-5q6r7s8t9-u0v1w", namespace: "rideshare", labels: { app: "surge-pricing-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "surge-pricing-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "surge-pricing-api": [
            "2026-09-15T15:00:00.110Z INFO  c.e.rideshare.SurgeMultiplierHolder - initialized with multiplier=1.8",
            "2026-09-15T15:20:12.884Z INFO  o.s.c.e.event.RefreshEventListener - Refresh keys changed: [surge.multiplier]",
            "2026-09-15T15:20:30.220Z INFO  c.e.rideshare.PricingController - quoting ride req-9012 with multiplier=1.8",
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "surge-pricing-api-notes", namespace: "rideshare" },
        spec: {
          data: {
            "SurgeMultiplierHolder.java.excerpt":
              "@RefreshScope\n@Component\npublic class SurgeMultiplierHolder {\n    @Value(\"${surge.multiplier}\")\n    private double multiplier;\n    public double get() { return multiplier; }\n}\n\n@Service\npublic class PricingController {\n    private final double cachedMultiplier; // captured once at\n                                             // construction time from\n                                             // SurgeMultiplierHolder,\n                                             // via constructor injection\n\n    public PricingController(SurgeMultiplierHolder holder) {\n        this.cachedMultiplier = holder.get(); // reads the CURRENT\n                                                // value once, at wiring\n                                                // time, into a plain\n                                                // double field on a bean\n                                                // that is NOT itself\n                                                // @RefreshScope\n    }\n}\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl logs surge-pricing-api-5q6r7s8t9-u0v1w -n rideshare` - the refresh event fires and names the right key. Which class actually holds the value used to quote a ride - `SurgeMultiplierHolder`, or something else?",
    "`kubectl get configmap surge-pricing-api-notes -n rideshare -o yaml` - `@RefreshScope` is on `SurgeMultiplierHolder`. Is `PricingController`, the class that actually quotes rides, also `@RefreshScope`? What does it do with the holder's value?",
    "`@RefreshScope` on a bean means *that bean* gets recreated on refresh - it says nothing about any *other* bean that captured a copy of its value once, at construction time, into its own separate field.",
  ],
  options: [
    {
      id: "downstream-bean-caches-value-outside-refresh-scope",
      label:
        "`@RefreshScope` is correctly applied to `SurgeMultiplierHolder`, which does get its `multiplier` field refreshed - but `PricingController`, the bean that actually uses the value to quote rides, isn't itself `@RefreshScope` and captured a copy of the multiplier once at construction time via constructor injection into a plain `double` field; refreshing `SurgeMultiplierHolder` has no effect on that already-copied value sitting in a completely separate, non-refreshable bean.",
      explanation:
        "The refresh event fires correctly (`Refresh keys changed: [surge.multiplier]`), yet the very next quote still uses the old value. `surge-pricing-api-notes` shows why: `SurgeMultiplierHolder` is genuinely `@RefreshScope` and would get a fresh `multiplier` on refresh - but `PricingController` never reads from the holder again after construction. It captured `holder.get()`'s value once, into its own `cachedMultiplier` field, at wiring time. `PricingController` itself carries no `@RefreshScope`, so it's never recreated, and its already-copied value has no way of ever changing again, no matter how many times the holder underneath it gets refreshed.",
    },
    {
      id: "surgemultiplierholder-value-annotation-missing-refresh",
      label: "`SurgeMultiplierHolder`'s own `@Value` field isn't actually being refreshed despite the `@RefreshScope` annotation.",
      explanation:
        "The scenario's evidence doesn't actually show `SurgeMultiplierHolder` failing to refresh - the real defect is one level downstream, in `PricingController`, which copies the holder's value once into its own field and never reads from the (correctly refreshing) holder again.",
    },
    {
      id: "config-server-push-didnt-propagate",
      label: "The config-server push for `surge.multiplier` never actually propagated to this application.",
      explanation:
        "The refresh event log explicitly names `surge.multiplier` as a changed key, confirming the new value did reach this application's environment - the break is downstream of that, in how `PricingController` consumes the (correctly updated) holder.",
    },
    {
      id: "two-replicas-inconsistent-multiplier",
      label: "The two replicas have inconsistent multipliers because only one received the refresh.",
      explanation:
        "This isn't a replica-to-replica consistency issue - `PricingController`'s design means *every* replica would behave identically: none of them would ever pick up a new multiplier after construction, regardless of which replica receives the refresh event.",
    },
  ],
  correctOptionId: "downstream-bean-caches-value-outside-refresh-scope",
  resolution: `The refresh mechanism itself is working - \`Refresh keys changed:
[surge.multiplier]\` fires right after the config-server push. But the
very next quote, twenty seconds later, still uses \`multiplier=1.8\`, the
old value.

\`surge-pricing-api-notes\` shows the gap is one bean downstream of where
\`@RefreshScope\` was actually applied. \`SurgeMultiplierHolder\` is correctly
annotated \`@RefreshScope\` and genuinely does get recreated - with a fresh
\`multiplier\` - on every refresh event. But \`PricingController\`, the bean
that actually quotes rides, isn't \`@RefreshScope\` itself. It takes
\`SurgeMultiplierHolder\` as a constructor dependency and calls
\`holder.get()\` exactly once, at wiring time, copying that value into its
own plain \`cachedMultiplier\` field. From that point on, \`PricingController\`
never looks at the holder again - refreshing the holder changes the
holder's own value, but has zero effect on a value some other, non-refreshed
bean already copied out of it.

The fix is either making \`PricingController\` itself \`@RefreshScope\`, or -
usually cleaner - having it read from the holder on every use instead of
caching a copy:

\`\`\`java
@Service
public class PricingController {
    private final SurgeMultiplierHolder holder;

    public PricingController(SurgeMultiplierHolder holder) {
        this.holder = holder; // keep the holder reference, not a copy
                               // of its current value
    }

    public double quote(Ride ride) {
        return basePrice(ride) * holder.get(); // reads the CURRENT
                                                  // value every time
    }
}
\`\`\`

\`@RefreshScope\` only protects the bean it's directly applied to - any
other bean that reads a refreshable value once and stores its own copy
has silently opted itself out of ever seeing that value change again,
with nothing in the framework to flag it.`,
};
