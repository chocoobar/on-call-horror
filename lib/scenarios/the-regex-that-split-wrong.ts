import type { Scenario } from "./types";

export const theRegexThatSplitWrong: Scenario = {
  id: "the-regex-that-split-wrong",
  title: "The Regex That Split Wrong",
  subtitle: "SKUs with a version suffix are getting stored as empty strings in the inventory sync",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "regex", "string-split"],
  briefing: `"inventory-sync" parses vendor SKU strings like "WIDGET-42.v2" by
splitting on the version suffix. Since a batch of new vendor SKUs
started using a literal period as the separator, an alarming number of
imported items are landing in the catalog with a blank SKU field.`,
  constraints: [
    "The vendor's SKU format is confirmed correct and consistent - every affected SKU genuinely does contain exactly one period followed by a version suffix.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "inventory-sync-28901412", namespace: "catalog", labels: { app: "inventory-sync" } },
        spec: { completions: 1 },
        status: { succeeded: 1 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "inventory-sync-28901412-n6o7p", namespace: "catalog", labels: { app: "inventory-sync" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "inventory-sync", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "inventory-sync": [
            "2026-09-15T05:00:02.114Z INFO  c.e.catalog.SkuParser - raw sku=\"WIDGET-42.v2\"",
            "2026-09-15T05:00:02.116Z WARN  c.e.catalog.SkuParser - parsed base sku=\"\" from \"WIDGET-42.v2\"",
          ],
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sku-parser-notes", namespace: "catalog" },
        spec: {
          data: {
            "SkuParser.java.excerpt":
              "public String baseSku(String rawSku) {\n    // intended to split on a literal '.' character\n    String[] parts = rawSku.split(\".\");\n    return parts.length > 0 ? parts[0] : rawSku;\n}\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl logs inventory-sync-28901412-n6o7p -n catalog` - `\"WIDGET-42.v2\"` parses to an empty base SKU. Look closely at the argument passed to `.split(...)`.",
    "`kubectl get configmap sku-parser-notes -n catalog -o yaml` - `String.split(String)` treats its argument as a *regular expression*, not a literal string.",
    "In regex, an unescaped `.` matches *any single character* - what does splitting a string on 'any single character' at every position produce?",
  ],
  options: [
    {
      id: "unescaped-dot-regex-splits-every-character",
      label:
        "`rawSku.split(\".\")` passes `\".\"` as a regular expression, where an unescaped `.` matches any single character - `String.split` treats its argument as regex, not a literal, so this splits the input on *every character*, producing an array of empty strings (since every character is itself a delimiter), and `parts[0]` is always the empty string before the first delimiter, regardless of the SKU's actual content.",
      explanation:
        "`SkuParser.java.excerpt` calls `rawSku.split(\".\")`. `String.split` interprets its argument as a regular expression, and an unescaped `.` in regex matches any single character - so this doesn't split on the literal period in `\"WIDGET-42.v2\"`, it splits the string apart at every single character position, since every character 'matches' the delimiter pattern. The resulting array's first element (`parts[0]`), the content before the very first delimiter match, is always an empty string, which is exactly the empty `baseSku` result logged for every SKU processed.",
    },
    {
      id: "vendor-sku-format-inconsistent",
      label: "The vendor's SKU format is inconsistent for the new batch, missing the expected period separator.",
      explanation:
        "The log shows the raw SKU is `\"WIDGET-42.v2\"`, which does contain a period in the expected position, and the vendor's format is confirmed consistent - the parsing logic itself is what's misbehaving on a correctly formatted input.",
    },
    {
      id: "database-column-truncating-sku",
      label: "The database column storing the base SKU is truncating the value on insert.",
      explanation:
        "The warning log shows `baseSku` already resolves to an empty string *before* anything is written to the database - the value is wrong at the point it's computed in application code, well before any storage layer is involved.",
    },
    {
      id: "sku-parser-using-wrong-array-index",
      label: "`baseSku` is reading the wrong index out of the split result array.",
      explanation:
        "`parts[0]` is a reasonable choice for 'everything before the first delimiter' *if* the split pattern only matched the intended single period - the actual problem is that the split pattern matches every character, not that the wrong index of an otherwise-correct split result is being read.",
    },
  ],
  correctOptionId: "unescaped-dot-regex-splits-every-character",
  resolution: `\`SkuParser.java.excerpt\` calls \`rawSku.split(".")\`, intending to split on
a literal period character. But \`String.split(String)\` interprets its
argument as a *regular expression*, not a plain literal string - and an
unescaped \`.\` in regex syntax is a metacharacter meaning "match any
single character," not "match a literal period." So instead of splitting
\`"WIDGET-42.v2"\` at the one intended period, this splits the string apart
at every single character in it, since every character satisfies "any
single character." The resulting array's first element - everything
before the very first delimiter match - is always the empty string,
which is exactly the blank \`baseSku\` value logged for every processed
SKU, regardless of that SKU's actual content.

The fix is escaping the period so it's treated as a literal character,
either with a backslash-escaped regex or, more simply, \`Pattern.quote\`
or a literal-string API:

\`\`\`java
public String baseSku(String rawSku) {
    String[] parts = rawSku.split("\\\\.", 2);   // escaped '.', literal split
    return parts.length > 0 ? parts[0] : rawSku;
}
\`\`\`

The general rule: \`String.split\`, along with \`replaceAll\`, \`matches\`, and
every other regex-based \`String\` method, always treats its argument as a
regular expression - any of the regex metacharacters (\`.\`, \`|\`, \`*\`, \`+\`,
\`?\`, \`(\`, \`)\`, \`[\`, \`]\`, \`\\\\\`, and others) needs escaping if it's meant
to be matched literally, even when the intent looks obviously literal to
a human reader.`,
};
