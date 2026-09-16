import type { Scenario } from "../types";

export const theStaticFieldThatLoadedTooEarly: Scenario = {
  id: "the-static-field-that-loaded-too-early",
  title: "The Static Field That Loaded Too Early",
  subtitle: "the very first request handled by any freshly started pod throws a NullPointerException, and only ever the first one",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "static-initialization", "class-loading"],
  briefing: `Every time "region-pricing-service" scales up or restarts, the very
first pricing request handled by the new pod throws a
NullPointerException. Every request after that first one succeeds
normally, on the same pod, with no code change or retry logic involved.`,
  constraints: [
    "The pricing table data itself is confirmed correct and fully loaded successfully by the time any request actually needs it - the failure is specifically about the order things happen in during class loading.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "region-pricing-service", namespace: "pricing", labels: { app: "region-pricing-service" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "7mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "region-pricing-service-0m1n2o3p4-q5r6s", namespace: "pricing", labels: { app: "region-pricing-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "region-pricing-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "region-pricing-service": [
            "2026-09-15T07:00:03.114Z ERROR c.e.pricing.PriceLookup - java.lang.NullPointerException: Cannot invoke \"java.util.Map.get(Object)\" because \"com.example.pricing.RegionTable.PRICES\" is null",
            "    at app//com.example.pricing.PriceLookup.lookup(PriceLookup.java:6)",
          ],
        },
        age: "7mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "region-pricing-notes", namespace: "pricing" },
        spec: {
          data: {
            "RegionTable.java.excerpt":
              "public class RegionTable {\n    public static final Map<String, BigDecimal> PRICES;\n\n    static {\n        PRICES = PriceLookup.buildInitialTable();   // calls INTO PriceLookup\n            // during RegionTable's own static initialization\n    }\n}\n\n// PriceLookup.java:\npublic class PriceLookup {\n    private static final Map<String, BigDecimal> CACHE = new HashMap<>(RegionTable.PRICES);\n        // reads RegionTable.PRICES during PriceLookup's OWN static\n        // initialization - triggered transitively by RegionTable's static\n        // block calling PriceLookup.buildInitialTable() first\n\n    public static Map<String, BigDecimal> buildInitialTable() {\n        return loadFromConfig();\n    }\n\n    public static BigDecimal lookup(String region) {\n        return CACHE.get(region);   // NPE if CACHE itself failed to build correctly\n    }\n}\n",
          },
        },
        age: "7mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap region-pricing-notes -n pricing -o yaml` - `RegionTable`'s static initializer calls `PriceLookup.buildInitialTable()`, which is a static method on `PriceLookup` - does calling a static method trigger that class's own static initialization?",
    "Referencing `PriceLookup` (even just to call one of its static methods) triggers `PriceLookup`'s own static initializer to run, if it hasn't already - and that initializer reads `RegionTable.PRICES`. Has `RegionTable.PRICES` finished being assigned yet, at that exact moment?",
    "Java guarantees a class is only initialized once, and guards against infinite re-entrant initialization by allowing a class already 'in the middle of initializing' to be referenced again without re-running its static block - but any static field it hasn't gotten around to assigning yet is still at its default value (`null` for a reference type) during that window.",
  ],
  options: [
    {
      id: "circular-static-initialization-partial-null",
      label:
        "`RegionTable`'s static initializer calls `PriceLookup.buildInitialTable()`, which - because this is the first time anything references `PriceLookup` - triggers `PriceLookup`'s own static initialization to run, and that initializer immediately reads `RegionTable.PRICES`; but `RegionTable` is still in the middle of its own static initialization at that point (it hasn't finished assigning `PRICES` yet), so Java's class-initialization guard against infinite recursion lets the reference through anyway, returning `PRICES`'s current, not-yet-assigned value: `null` - so `PriceLookup.CACHE` gets built from a `null` map, and every lookup against it throws until the *next* pod restart re-triggers this exact same sequence.",
      explanation:
        "The exception message is unusually explicit: `\"com.example.pricing.RegionTable.PRICES\" is null`. `RegionTable.java.excerpt` shows a circular static dependency: `RegionTable`'s static block calls `PriceLookup.buildInitialTable()`, which - as the first reference to `PriceLookup` in the pod's lifetime - triggers `PriceLookup`'s own static initializer, which reads `RegionTable.PRICES` back. Since `RegionTable` is still actively in the middle of its own static initialization at that moment (it called out to `PriceLookup` before finishing its own assignment), Java's class-loading spec allows the re-entrant reference to proceed without re-running `RegionTable`'s static block again (which would infinite-loop) - but `PRICES` hasn't been assigned yet at that point, so it's still at its default value, `null`. `PriceLookup.CACHE` ends up built from that `null` map, and every `lookup()` call against the resulting broken `CACHE` throws `NullPointerException` - for the entire lifetime of that pod, since static initialization runs exactly once; this only manifests as 'the very first request' because static initialization is triggered lazily, by whichever request happens to be the first to touch either class after the pod starts.",
    },
    {
      id: "priceloookup-buildinitialtable-flaky-under-startup-load",
      label: "`PriceLookup.buildInitialTable()`'s config-loading logic is flaky specifically during pod startup.",
      explanation:
        "The constraint confirms the pricing table data itself loads correctly and completely by the time any request actually needs it - the problem isn't that loading fails, it's that a circular reference between two classes' static initializers causes one to read the other's field before it's been assigned, independent of whether the underlying data loading itself succeeds.",
    },
    {
      id: "kubernetes-readiness-probe-too-early",
      label: "The pod's readiness probe marks it ready before its static initialization has actually finished.",
      explanation:
        "This is a pure JVM class-loading and static-initialization-ordering issue, entirely internal to the application - readiness probes gate traffic at the container/orchestration level and have no visibility into, or influence over, the order Java resolves a circular dependency between two classes' static initializers.",
    },
    {
      id: "region-table-cache-invalidated-after-first-request",
      label: "`RegionTable.PRICES` is being invalidated or cleared immediately after the first request completes.",
      explanation:
        "There's no invalidation logic anywhere in this code - `PRICES` and `CACHE` are both declared `static final`, assigned exactly once during class initialization; the failure and its immediate resolution are both explained by the timing of that one-time initialization, not by anything being cleared afterward.",
    },
  ],
  correctOptionId: "circular-static-initialization-partial-null",
  resolution: `The exception message is unusually specific and worth reading closely:
\`"com.example.pricing.RegionTable.PRICES" is null\` - a \`static final\`
field that should have been assigned during class initialization,
apparently still holding its default value. \`RegionTable.java.excerpt\`
reveals a circular dependency between two classes' static initializers:
\`RegionTable\`'s static block calls \`PriceLookup.buildInitialTable()\` -
and referencing \`PriceLookup\` for the first time in the pod's lifetime
triggers *its* static initializer to run, which immediately reads
\`RegionTable.PRICES\` back. At that exact moment, \`RegionTable\` is still
in the middle of its own static initialization (it hasn't returned from
its own static block yet, having called out into \`PriceLookup\` before
finishing). Java's class-loading specification guards against infinite
recursive re-initialization by permitting this re-entrant reference to
proceed without re-running \`RegionTable\`'s static block again - but it
does nothing to wait for that block to finish first. \`PRICES\` is still
at its default, unassigned value (\`null\` for a reference type) at that
point, so \`PriceLookup.CACHE\` gets built from a \`null\` map, and every
subsequent \`lookup()\` call against that broken, empty cache throws.
Since static initialization runs exactly once per class per JVM, this
happens exactly once per pod - on whichever request happens to be the
first to trigger it - and never again for the rest of that pod's
lifetime, matching the reported pattern precisely.

The fix is breaking the circular dependency between the two classes'
static initialization:

\`\`\`java
public class RegionTable {
    public static final Map<String, BigDecimal> PRICES = ConfigLoader.loadPricingTable();
    // loads directly, with no dependency on PriceLookup's own static state
}

public class PriceLookup {
    private static final Map<String, BigDecimal> CACHE = new HashMap<>(RegionTable.PRICES);
    // still depends on RegionTable, but RegionTable no longer depends back on PriceLookup
}
\`\`\`

The general rule: a circular dependency between two classes' static
initializers is resolved by the JVM in a specific, well-defined but
easy-to-get-wrong way - whichever class's initializer is still running
when the cycle is entered back into will expose its not-yet-assigned
fields as their default values (\`null\`, \`0\`, \`false\`) to the other class,
rather than blocking until initialization completes. Avoid static
initializers that depend on each other across classes; if one is truly
unavoidable, make sure neither side reads a field the other hasn't
assigned yet.`,
};
