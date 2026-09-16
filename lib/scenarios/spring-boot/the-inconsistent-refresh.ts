import type { Scenario } from "../types";

export const theInconsistentRefresh: Scenario = {
  id: "the-inconsistent-refresh",
  title: "The Inconsistent Refresh",
  subtitle: "shipping-rate-api quotes two different shipping rates for the identical package, depending on which code path you ask",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "spring-cloud-config", "configuration"],
  briefing: `Ops updated "shipping-rate-api"'s fuel surcharge percentage in config-server
this morning and confirmed the refresh succeeded. Since then, the
checkout page (which calls the quote endpoint) shows the new surcharge
correctly - but the order confirmation email (built from a separate
internal recalculation, using the same surcharge value) still shows the
old one. Same input, same moment in time, two different numbers.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-rate-api", namespace: "logistics", labels: { app: "shipping-rate-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "shipping-rate-api", image: "registry.internal/shipping-rate-api:2.7.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipping-rate-api-6b7c8d9e0-f1g2h", namespace: "logistics", labels: { app: "shipping-rate-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipping-rate-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipping-rate-api": [
            "2026-09-15T07:30:12.884Z INFO  o.s.c.e.event.RefreshEventListener - Refresh keys changed: [shipping.fuel-surcharge-pct]",
            "2026-09-15T07:31:04.110Z INFO  c.e.logistics.QuoteController - quote for ORD-90331 used fuel surcharge 9.5%",
            "2026-09-15T07:31:04.884Z INFO  c.e.logistics.ConfirmationEmailBuilder - confirmation for ORD-90331 used fuel surcharge 7.0%",
          ],
        },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipping-rate-api-notes", namespace: "logistics" },
        spec: {
          data: {
            "notes.md":
              "`QuoteController` reads the surcharge via a `@RefreshScope`-annotated\n`SurchargeConfig` bean's getter on every call, so it always sees the\ncurrent value. `ConfirmationEmailBuilder` is a separate, older component\nthat reads the same underlying property directly via its own `@Value`\nfield (not through `SurchargeConfig`), and is itself not annotated\n`@RefreshScope` - so it was correctly reading the property at the time it\nwas built, but has never picked up any change since, including this\nmorning's.",
          },
        },
        age: "12h",
      },
    ],
  },
  hints: [
    "`kubectl logs shipping-rate-api-6b7c8d9e0-f1g2h -n logistics` - the refresh event confirms `shipping.fuel-surcharge-pct` changed. Two components read that same value, moments apart, for the same order - and get two different answers. Why would that be possible?",
    "`kubectl get configmap shipping-rate-api-notes -n logistics -o yaml` - does `QuoteController` and `ConfirmationEmailBuilder` read the surcharge value the same way? Is each of them `@RefreshScope`, or wired to something that is?",
    "A refresh event updates the underlying `Environment` for the whole application - but only beans that are themselves `@RefreshScope` (or that always read through something that is) will ever observe a value changing after they were first constructed.",
  ],
  options: [
    {
      id: "one-reader-refresh-scoped-the-other-reads-own-stale-value",
      label:
        "`QuoteController` reads the surcharge on every call through a `@RefreshScope`-annotated `SurchargeConfig` bean, so it always reflects the current value - but `ConfirmationEmailBuilder` reads the same underlying property independently via its own `@Value` field, and isn't itself `@RefreshScope`, so it captured the surcharge once at construction and has never picked up any change since, including this morning's refresh; two code paths reading what's supposed to be the same configuration value, but through two different mechanisms with two different refresh behaviors.",
      explanation:
        "The refresh event confirms `shipping.fuel-surcharge-pct` genuinely changed application-wide. Yet for the exact same order, moments apart, `QuoteController` reports 9.5% (the new value) and `ConfirmationEmailBuilder` reports 7.0% (the old one). `shipping-rate-api-notes` explains the split: `QuoteController` always reads through the refresh-scoped `SurchargeConfig` bean and therefore always sees the latest value, while `ConfirmationEmailBuilder` is a separate, older component reading the same property directly via its own non-refresh-scoped `@Value` field - frozen at whatever value was current when that bean was first constructed, unaffected by any refresh since.",
    },
    {
      id: "config-server-serving-two-different-values",
      label: "config-server itself is inconsistently serving two different values for the same property.",
      explanation:
        "The refresh event confirms a single, successful change was applied application-wide - there's no indication config-server served different values to different callers; the split happens entirely within this application, between two components that read the same already-correctly-updated property in different ways.",
    },
    {
      id: "database-replication-lag-on-order-record",
      label: "Replication lag between the order database and the confirmation email service is the cause.",
      explanation:
        "Both components read the surcharge percentage directly from application configuration, not from any per-order database record - there's no database read or replication step involved in either code path that this log traces.",
    },
    {
      id: "quotecontroller-caching-a-stale-value",
      label: "QuoteController is the one caching a stale value and showing an out-of-date surcharge.",
      explanation:
        "It's the opposite: `QuoteController` shows the *new*, correctly refreshed value (9.5%), while `ConfirmationEmailBuilder` is the component still showing the old, stale one (7.0%) - `QuoteController`'s refresh-scoped read is working exactly as intended.",
    },
  ],
  correctOptionId: "one-reader-refresh-scoped-the-other-reads-own-stale-value",
  resolution: `The refresh event confirms the change genuinely propagated:
\`Refresh keys changed: [shipping.fuel-surcharge-pct]\`. And yet, for the
same order, less than a second apart, \`QuoteController\` reports the new
9.5% surcharge while \`ConfirmationEmailBuilder\` reports the old 7.0% -
two components reading what should be the same value, disagreeing with
each other in real time.

\`shipping-rate-api-notes\` explains the split: \`QuoteController\` always
reads the surcharge through \`SurchargeConfig\`, a bean explicitly annotated
\`@RefreshScope\` - so every call gets whatever value is currently in the
\`Environment\`, refresh or not. \`ConfirmationEmailBuilder\`, an older,
separately-written component, bypasses \`SurchargeConfig\` entirely and
reads the same underlying property directly through its own \`@Value\`
field - and that field was bound once, at construction time, with no
\`@RefreshScope\` on the bean to ever update it again. It was reading the
correct value right up until this morning's config-server push; from that
moment on, it's been silently stuck on the value it captured before the
change.

The fix is routing every reader of a given piece of refreshable
configuration through the same, single refresh-scoped source of truth,
rather than letting each component bind its own independent copy:

\`\`\`java
@Component
public class ConfirmationEmailBuilder {
    private final SurchargeConfig surchargeConfig; // shared, refresh-scoped

    public ConfirmationEmailBuilder(SurchargeConfig surchargeConfig) {
        this.surchargeConfig = surchargeConfig;
    }

    public String buildConfirmation(Order order) {
        double surcharge = surchargeConfig.getFuelSurchargePct(); // always current
        // ...
    }
}
\`\`\`

Whenever more than one component reads the same config-server-managed
value, it's worth checking that they all go through the same
refresh-scoped bean - two independently-bound \`@Value\` fields for the
"same" property are two independent opportunities for one of them to fall
out of sync the next time that value changes.`,
};
