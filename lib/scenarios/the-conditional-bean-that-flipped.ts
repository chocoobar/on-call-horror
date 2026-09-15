import type { Scenario } from "./types";

export const theConditionalBeanThatFlipped: Scenario = {
  id: "the-conditional-bean-that-flipped",
  title: "The Conditional Bean That Flipped",
  subtitle: "pricing-engine has been quoting every customer the same flat test price since yesterday's deploy",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "spring-boot", "configuration"],
  briefing: `Yesterday's deploy to "pricing-engine" bumped a shared internal library
that both the real pricing calculator and its old test-double stub
happen to live in. Since then, every quote returned to customers has been
a suspiciously round $9.99 - the stub's hardcoded value - regardless of
what's actually in their cart.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-engine", namespace: "commerce", labels: { app: "pricing-engine" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "pricing-engine", image: "registry.internal/pricing-engine:7.8.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "18h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-engine-4a5b6c7d8-e9f0g", namespace: "commerce", labels: { app: "pricing-engine" } },
        status: { phase: "Running", containerStatuses: [{ name: "pricing-engine", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pricing-engine": [
            "2026-09-15T06:30:01.110Z INFO  o.s.c.a.ConditionEvaluationReport - StubPriceCalculator matched: @ConditionalOnProperty (pricing.use-stub-calculator) matched because the property was not present",
            "2026-09-15T06:30:01.112Z INFO  c.e.commerce.QuoteController - active PriceCalculator implementation: StubPriceCalculator",
          ],
        },
        age: "18h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pricing-engine-notes", namespace: "commerce" },
        spec: {
          data: {
            "notes.md":
              "`StubPriceCalculator` (always returns $9.99, used only in local dev\nand tests) and `RealPriceCalculator` both implement `PriceCalculator`.\nBefore yesterday's library bump, `RealPriceCalculator` was the\n`@Primary` bean unconditionally, and the stub had no conditional guard at\nall - it was only ever wired in test contexts via a test-specific\nconfiguration class. The bumped shared library refactored\n`StubPriceCalculator` to be conditionally registered application-wide via\n`@ConditionalOnProperty(name = \"pricing.use-stub-calculator\", matchIfMissing = true)`\n- a default of `matchIfMissing = true` that nobody in this app's own\nconfig ever needed to override before, because the stub previously\ncouldn't reach production wiring at all.",
          },
        },
        age: "18h",
      },
    ],
  },
  hints: [
    "`kubectl logs pricing-engine-4a5b6c7d8-e9f0g -n commerce` - the condition evaluation report names exactly which bean got activated and why.",
    "The message says the property `pricing.use-stub-calculator` 'was not present.' What does `matchIfMissing` decide when a property is simply never set at all?",
    "`kubectl get configmap pricing-engine-notes -n commerce -o yaml` - what changed about how `StubPriceCalculator` gets wired in, between the old version of the shared library and the one bumped yesterday?",
  ],
  options: [
    {
      id: "matchifmissing-default-silently-activates-stub",
      label:
        "The bumped shared library changed `StubPriceCalculator` from a test-only bean to one conditionally registered application-wide via `@ConditionalOnProperty(..., matchIfMissing = true)`; since `pricing.use-stub-calculator` was never set anywhere in production config (it never needed to be, under the old wiring), `matchIfMissing = true` silently activates the stub bean in prod, and its hardcoded $9.99 return value becomes every customer's quote.",
      explanation:
        "The condition evaluation report says it plainly: `StubPriceCalculator matched ... because the property was not present`, with `QuoteController` confirming `StubPriceCalculator` as the active implementation in production. `pricing-engine-notes` explains the mechanism: the library bump changed how the stub gets wired, introducing `matchIfMissing = true` as its default - a setting that was harmless before (the stub had no path into production wiring at all) but now silently wins whenever the corresponding property is absent, which it always has been in this app's production config.",
    },
    {
      id: "real-price-calculator-throwing-silently",
      label: "RealPriceCalculator is throwing an exception that's being silently swallowed, falling back to a default.",
      explanation:
        "The condition evaluation report shows `StubPriceCalculator` being selected at bean-wiring time via `@ConditionalOnProperty`, before any request is even served - this isn't a runtime fallback from a failing real calculator, it's the wrong bean being registered from the start.",
    },
    {
      id: "pricing-database-returning-test-data",
      label: "The pricing database itself has stale test data with a $9.99 default price.",
      explanation:
        "The logs show the flat price coming from an entirely different Spring bean, `StubPriceCalculator`, being the one actually wired into `QuoteController` - there's no indication the real calculator ever queries the database at all in this flow, since the wrong implementation was selected before any query would happen.",
    },
    {
      id: "cache-serving-old-quote",
      label: "A quote cache is serving one customer's old cached result to everyone.",
      explanation:
        "Every customer's quote is identically $9.99 regardless of cart contents, and the condition evaluation report explains why directly: it's the stub's hardcoded literal, not a cached real quote from any customer's actual order.",
    },
  ],
  correctOptionId: "matchifmissing-default-silently-activates-stub",
  resolution: `The application's own condition evaluation report explains exactly what
happened: \`StubPriceCalculator matched: @ConditionalOnProperty
(pricing.use-stub-calculator) matched because the property was not
present\` - and \`QuoteController\` confirms it as the actively wired
implementation. Every customer is getting $9.99 because that's the
literal, hardcoded value the stub returns.

\`pricing-engine-notes\` explains how a stub with no production footprint
suddenly gained one: before yesterday's shared-library bump,
\`StubPriceCalculator\` was only ever wired through a test-specific
configuration class, entirely separate from production bean wiring. The
new library version refactored it to be conditionally registered
application-wide, guarded by
\`@ConditionalOnProperty(name = "pricing.use-stub-calculator", matchIfMissing = true)\`.
\`matchIfMissing = true\` was a safe default under the old wiring, where
the stub had no path into production at all - but now that it's wired
application-wide, that same default means the stub silently activates
itself in *any* environment that has never set the property, which
describes every production deployment of this app.

The fix is explicitly setting the property in production config, rather
than depending on a library-chosen default to keep the stub out:

\`\`\`yaml
pricing:
  use-stub-calculator: false
\`\`\`

Whenever a shared library bump changes how a bean gets conditionally
wired - especially anything defaulting to \`matchIfMissing = true\` -
checking the condition evaluation report (\`--debug\`, or
\`/actuator/conditions\`) after the bump is the fastest way to catch a
silently flipped default before it reaches production traffic.`,
};
