import type { Scenario } from "./types";

export const theHashmapThatForgotItsOrder: Scenario = {
  id: "the-hashmap-that-forgot-its-order",
  title: "The HashMap That Forgot Its Order",
  subtitle: "the nightly export file's column order changed overnight, breaking a downstream partner's fixed-position parser",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "hashmap", "iteration-order"],
  briefing: `A downstream partner's ingestion system, which parses the nightly product
feed by fixed column position, started rejecting every single row this
morning. Nobody changed the export code, the partner's parser, or the
underlying product data - only the JDK patch version baked into the
export job's base image was bumped as part of routine maintenance.`,
  constraints: [
    "No code change was deployed alongside the base image bump - the export logic itself is byte-for-byte identical to the previous, working version.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "product-feed-export-28901633", namespace: "catalog", labels: { app: "product-feed-export" } },
        spec: { completions: 1 },
        status: { succeeded: 1 },
        age: "9h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "product-feed-export-28901633-b1c2d", namespace: "catalog", labels: { app: "product-feed-export" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "product-feed-export", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "product-feed-export": [
            "2026-09-15T03:00:04.114Z INFO  c.e.catalog.FeedExporter - column order this run: [category, price, sku, name]",
            "2026-09-15T03:00:04.116Z INFO  c.e.catalog.FeedExporter - (previous run's column order was: [sku, name, price, category])",
          ],
        },
        age: "9h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "product-feed-export-notes", namespace: "catalog" },
        spec: {
          data: {
            "FeedExporter.java.excerpt":
              "public List<String> columnOrder(Map<String, String> fields) {\n    // fields is a plain HashMap<String, String> built from the product schema\n    List<String> order = new ArrayList<>();\n    for (String key : fields.keySet()) {   // relies on HashMap's iteration order\n        order.add(key);\n    }\n    return order;\n}\n",
          },
        },
        age: "9h",
      },
    ],
  },
  hints: [
    "`kubectl logs product-feed-export-28901633-b1c2d -n catalog` - the column order genuinely changed between runs, with no code change deployed. What did change?",
    "`kubectl get configmap product-feed-export-notes -n catalog -o yaml` - `columnOrder` builds its list by iterating a plain `HashMap`'s `keySet()`. Is `HashMap`'s iteration order part of its documented contract?",
    "`HashMap` has never guaranteed any particular iteration order - the order it happens to produce is an internal implementation detail that can (and does) change between JDK versions, or even between runs, without ever being a documented, relied-upon behavior.",
  ],
  options: [
    {
      id: "hashmap-iteration-order-undocumented-and-unstable",
      label:
        "`columnOrder` builds the export's column ordering by iterating a plain `HashMap`'s `keySet()`, but `HashMap` has never documented or guaranteed any particular iteration order - the order it happens to produce is an internal implementation detail derived from hashing and bucket layout, and a JDK version bump (part of the routine base image maintenance) changed that internal detail, silently reordering the exported columns with no code change and no data change involved at all.",
      explanation:
        "The log directly shows the column order changed between runs (`[sku, name, price, category]` to `[category, price, sku, name]`), with the export logic confirmed unchanged. `FeedExporter.java.excerpt` builds that order by iterating `fields.keySet()` on a plain `HashMap` - and `HashMap`'s iteration order has never been part of its documented API contract; it's simply whatever order the internal hash bucket layout happens to produce, which can differ across JDK versions, hash implementation changes, or even map resizing thresholds. The base image's JDK patch bump is exactly the kind of change that can alter that internal layout without touching a single line of application code.",
    },
    {
      id: "partner-parser-changed-expectations",
      label: "The downstream partner's parser silently changed which column position it expects each field in.",
      explanation:
        "The partner's parser is described as unchanged and expecting the same fixed positions it always has - the export side is what's producing a different column order than before, not the receiving side changing its expectations.",
    },
    {
      id: "product-schema-fields-reordered-in-database",
      label: "The underlying product schema's field definitions were reordered in the database.",
      explanation:
        "The underlying product data itself is confirmed unchanged - what changed is purely the *order* fields are enumerated when iterating an unordered `HashMap` in application code, an implementation detail unrelated to how fields are actually defined or stored.",
    },
    {
      id: "export-job-race-condition-between-runs",
      label: "Two concurrent runs of the export job raced and interleaved their output.",
      explanation:
        "Both logged column orderings are complete, internally consistent, valid orderings of all four fields, from what's confirmed to be a single, successful, non-overlapping job run - there's no sign of interleaved or corrupted output from concurrent execution here.",
    },
  ],
  correctOptionId: "hashmap-iteration-order-undocumented-and-unstable",
  resolution: `The log shows the column order genuinely changed between runs -
\`[sku, name, price, category]\` before, \`[category, price, sku, name]\`
after - with the export code itself confirmed byte-for-byte unchanged.
\`FeedExporter.java.excerpt\` builds that ordering by iterating a plain
\`HashMap<String, String>\`'s \`keySet()\`. \`HashMap\` has never documented
or guaranteed any particular iteration order as part of its API contract
- the order it happens to produce falls out of internal implementation
details like each key's hash code and how entries are distributed across
internal buckets, none of which the class promises to keep stable across
versions, or even necessarily across separate runs with different
insertion histories. The only change alongside this incident was a
routine JDK patch bump to the base image - exactly the kind of change
that can alter \`HashMap\`'s internal hashing or bucket-sizing behavior
without touching a single line of application code, because nothing
about that internal behavior was ever a promise to begin with.

The fix is using a map type that actually guarantees the ordering the
export needs, rather than depending on \`HashMap\`'s incidental behavior:

\`\`\`java
public List<String> columnOrder(Map<String, String> fields) {
    // LinkedHashMap preserves insertion order; or hardcode the fixed
    // column order explicitly, since a downstream parser depends on it
    List<String> order = new ArrayList<>(new LinkedHashMap<>(fields).keySet());
    return order;
}
\`\`\`

For a fixed-position downstream contract like this, hardcoding the exact
column order explicitly (rather than deriving it from any map at all) is
even more robust. The general rule: never rely on \`HashMap\`'s iteration
order for anything that needs to be stable or predictable - it is
explicitly unspecified, and code that happens to observe a consistent
order today is one internal JDK change away from silently observing a
different one.`,
};
