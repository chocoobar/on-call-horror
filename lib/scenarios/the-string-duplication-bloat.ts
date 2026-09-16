import type { Scenario } from "./types";

export const theStringDuplicationBloat: Scenario = {
  id: "the-string-duplication-bloat",
  title: "The String Duplication Bloat",
  subtitle: "document-indexer's heap climbs steadily for days even though its object count barely changes",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "memory", "jfr"],
  briefing: `"document-indexer" parses incoming documents and tags them with metadata
extracted via a shared set of regex-based classifiers. Heap usage has
been creeping upward for days without ever coming back down, eventually
forcing a restart - but a heap histogram shows roughly the same number of
live objects the whole time. Whatever's growing isn't object count.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "document-indexer", namespace: "search", labels: { app: "document-indexer" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "document-indexer", image: "registry.internal/document-indexer:4.0.0", env: [{ name: "JAVA_TOOL_OPTIONS", value: "-Xmx3g -XX:+FlightRecorder" }] }] } },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "document-indexer-7c8d9e0f1-g2h3i", namespace: "search", labels: { app: "document-indexer" } },
        status: { phase: "Running", containerStatuses: [{ name: "document-indexer", ready: true, restartCount: 2, state: { running: {} } }] },
        logs: {
          "document-indexer": [
            "2026-09-15T08:00:01.114Z INFO  c.e.search.HeapHistogram - live object count: 4.1M (stable, 5-day trend)",
            "2026-09-15T08:00:01.220Z INFO  c.e.search.HeapHistogram - char[] instances: 38.2M, retained size: 2.1GB (up from 640MB five days ago)",
            "2026-09-15T08:00:02.884Z WARN  jdk.jfr.consumer.RecordedEvent - jdk.StringDeduplication event unavailable: -XX:+UseStringDeduplication not enabled (requires G1GC)",
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "document-indexer-notes", namespace: "search" },
        spec: {
          data: {
            "DocumentClassifier.java.excerpt":
              "public Tag classify(String documentText) {\n    for (Pattern p : classifierPatterns) {\n        Matcher m = p.matcher(documentText);\n        if (m.find()) {\n            return new Tag(m.group().toLowerCase()); // .toLowerCase()\n                            // allocates a brand NEW String every call,\n                            // even when the matched substring is\n                            // already lowercase or has been seen\n                            // (and lowercased) thousands of times before\n        }\n    }\n    return Tag.UNKNOWN;\n}\n",
            "notes.md":
              "Across millions of classified documents, the same small set of\nmatched keyword substrings (category names, common terms) recur\nconstantly - but each call to `.toLowerCase()` allocates a fresh,\ndistinct `String`/`char[]` object even when an identical string already\nexists elsewhere on the heap many times over. G1's String Deduplication\nfeature (`-XX:+UseStringDeduplication`) specifically targets this pattern\nby coalescing identical `char[]` backing arrays behind different `String`\nobjects - but it requires G1GC and is not currently enabled on this\nservice.",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl logs document-indexer-7c8d9e0f1-g2h3i -n search` - live object *count* is stable, but `char[]` retained size nearly quadrupled in five days. What kind of object grows in size without growing in count?",
    "`kubectl get configmap document-indexer-notes -n search -o yaml` - `classify()` calls `.toLowerCase()` on every match, every single time. How many distinct `String` objects could end up holding effectively the same text?",
    "String Deduplication exists specifically for this pattern - many distinct `String` objects containing identical character data. Is it enabled here, and what does it need to work at all?",
  ],
  options: [
    {
      id: "redundant-tolowercase-plus-no-string-deduplication",
      label:
        "`DocumentClassifier.classify()` calls `.toLowerCase()` on every matched substring, allocating a brand new `String`/`char[]` every time even when an identical string (same category keyword, same common term) has already been produced and discarded thousands of times before across millions of documents - and because String Deduplication (which exists specifically to coalesce identical `char[]` backing arrays across distinct `String` objects) requires G1GC and isn't currently enabled, none of that redundant character data ever gets consolidated, so heap grows steadily in *retained size* even while live object *count* stays essentially flat.",
      explanation:
        "The heap histogram shows exactly this signature: live object count stable at 4.1M over five days, but `char[]` retained size nearly quadrupling (640MB to 2.1GB) in the same period - growth in size without growth in count points at the same kinds of objects taking up more and more space, not more objects existing. `document-indexer-notes` explains the source: `.toLowerCase()` allocates fresh character data on every call regardless of whether identical text already exists elsewhere on the heap, and the JFR warning confirms String Deduplication - the feature built to consolidate exactly this kind of redundant `char[]` data - isn't enabled because this service isn't running G1GC.",
    },
    {
      id: "regex-patterns-compiled-repeatedly",
      label: "The classifier's regex `Pattern` objects are being recompiled on every call instead of reused.",
      explanation:
        "`classifierPatterns` is shown as a pre-existing collection of already-compiled `Pattern` objects being iterated and matched against, not recompiled from a string source inside the loop - the growth pattern (rising `char[]` retained size with flat object count) is specific to string data accumulation, not to `Pattern` compilation overhead, which would show up differently (rising object count for `Pattern`/`Matcher` internals, not a `char[]`-specific size increase).",
    },
    {
      id: "heap-histogram-tool-itself-unreliable",
      label: "The heap histogram tool being used is itself unreliable and undercounting objects.",
      explanation:
        "The histogram is consistently reporting a stable object count across a five-day trend while specifically flagging a large, measurable increase in one object type's retained size - that's a specific, actionable data point, not the kind of noisy or contradictory result that would suggest the measurement tool itself is untrustworthy.",
    },
    {
      id: "document-volume-simply-increased",
      label: "Document processing volume itself has simply increased over the five days, explaining the growth naturally.",
      explanation:
        "The heap histogram explicitly reports live object *count* as stable across the same five-day period that `char[]` retained size nearly quadrupled - if volume had genuinely increased proportionally, object count would be climbing too, not staying flat while only the size of existing object types grows.",
    },
  ],
  correctOptionId: "redundant-tolowercase-plus-no-string-deduplication",
  resolution: `The heap histogram gives the key signature: live object count is stable
at 4.1M across a five-day trend, but \`char[]\` instances' *retained size*
nearly quadrupled in the same window, from 640MB to 2.1GB. Growth in size
without growth in count means the same kinds of objects are taking up
more and more space over time - and \`char[]\` is the backing storage for
every \`String\`.

\`document-indexer-notes\` traces it to \`DocumentClassifier.classify()\`:
every matched substring gets \`.toLowerCase()\` called on it, and
\`.toLowerCase()\` allocates a brand-new \`String\` (and backing \`char[]\`)
every single time - even when an identical string has already been
produced, used, and discarded thousands of times before across millions
of classified documents. Because the same small set of category keywords
and common terms recur constantly, an enormous amount of the heap ends up
holding functionally identical character data spread across countless
distinct object instances. G1's String Deduplication feature exists
specifically to coalesce this pattern - identical \`char[]\` backing arrays
behind otherwise-distinct \`String\` objects - by periodically scanning the
heap and pointing duplicates at a single shared backing array. But the
JFR event confirms it's unavailable here because this service isn't
running G1GC at all.

Two complementary fixes: enable String Deduplication (which requires
switching to G1GC), and reduce the redundant allocation at the source by
caching the small, bounded set of lowercased keyword results:

\`\`\`java
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-Xmx3g -XX:+UseG1GC -XX:+UseStringDeduplication"
\`\`\`

\`\`\`java
private final Map<String, String> lowercaseCache = new ConcurrentHashMap<>();

public Tag classify(String documentText) {
    for (Pattern p : classifierPatterns) {
        Matcher m = p.matcher(documentText);
        if (m.find()) {
            String matched = m.group();
            String lower = lowercaseCache.computeIfAbsent(matched, String::toLowerCase);
            return new Tag(lower);
        }
    }
    return Tag.UNKNOWN;
}
\`\`\`

String Deduplication is a good safety net for this whole class of
problem, but caching the small, genuinely bounded set of distinct
lowercased values at the source avoids the redundant allocation
entirely, rather than relying on the garbage collector to periodically
clean up after it.`,
};
