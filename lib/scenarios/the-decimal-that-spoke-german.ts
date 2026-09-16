import type { Scenario } from "./types";

export const theDecimalThatSpokeGerman: Scenario = {
  id: "the-decimal-that-spoke-german",
  title: "The Decimal That Spoke German",
  subtitle: "the freight-cost import job rejects roughly a tenth of rows from the new European carrier feed as unparseable",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "locale", "number-formatting"],
  briefing: `"freight-cost-import" parses per-shipment cost figures from a text feed
using \`DecimalFormat\`. Since onboarding a new European carrier, a
consistent slice of rows fail to parse with a \`ParseException\`, even
though the carrier insists (and a manual check confirms) the numbers in
those rows are correctly formatted for their locale.`,
  constraints: [
    "The carrier's feed file itself is confirmed well-formed and consistent - every number in it follows one locale's formatting conventions throughout.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "freight-cost-import-28901611", namespace: "logistics", labels: { app: "freight-cost-import" } },
        spec: { completions: 1 },
        status: { failed: 1 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "freight-cost-import-28901611-y8z9a", namespace: "logistics", labels: { app: "freight-cost-import" } },
        status: { phase: "Failed", containerStatuses: [{ name: "freight-cost-import", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "freight-cost-import": [
            "2026-09-15T06:30:02.114Z ERROR c.e.logistics.CostParser - java.text.ParseException: Unparseable number: \"1.234,56\"",
            "    at java.base/java.text.DecimalFormat.parse(DecimalFormat.java:2075)",
            "    at app//com.example.logistics.CostParser.parse(CostParser.java:9)",
          ],
        },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "freight-cost-import-notes", namespace: "logistics" },
        spec: {
          data: {
            "CostParser.java.excerpt":
              "public double parse(String rawCost) throws ParseException {\n    // no explicit Locale - relies on the JVM's default Locale for\n    // grouping/decimal separator conventions\n    DecimalFormat format = new DecimalFormat();\n    return format.parse(rawCost).doubleValue();\n}\n",
            "notes.md":
              "The carrier's feed uses German-style number formatting: '.' as the\nthousands grouping separator and ',' as the decimal separator (e.g.\n\"1.234,56\" means one thousand two hundred thirty-four point fifty-six).\nThis deployment's containers run with the JVM default Locale left\nunconfigured, which resolves to whatever the base image's OS locale\nhappens to be - en-US in this case, where '.' is the decimal separator\nand ',' is the grouping separator, the opposite convention.\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl logs freight-cost-import-28901611-y8z9a -n logistics` - `\"1.234,56\"` fails to parse. Under US formatting conventions that string looks malformed - but is it, under every convention?",
    "`kubectl get configmap freight-cost-import-notes -n logistics -o yaml` - does `CostParser` specify a `Locale` anywhere when constructing its `DecimalFormat`?",
    "`new DecimalFormat()` with no arguments uses the JVM's *default* `Locale` for deciding which characters mean 'decimal point' versus 'thousands grouping' - and that default doesn't match every number format an external feed might actually use.",
  ],
  options: [
    {
      id: "decimalformat-default-locale-mismatch",
      label:
        "`CostParser` constructs `new DecimalFormat()` with no explicit `Locale`, so it parses using the JVM's default locale's number conventions - under the container's `en-US` default, `.` means decimal point and `,` means thousands grouping, the opposite of the carrier's German-style formatting (`.` for grouping, `,` for decimal), so a correctly-formatted German-style number like `\"1.234,56\"` doesn't match the pattern `DecimalFormat` expects under the wrong locale, and parsing fails.",
      explanation:
        "The exception shows `\"1.234,56\"` failing to parse - a string that's perfectly valid under German-style formatting (one thousand two hundred thirty-four point fifty-six) but doesn't match US-style formatting rules. `CostParser.java.excerpt` constructs `DecimalFormat` with no `Locale` argument, so it silently falls back to the JVM's default locale for deciding which character means what. `freight-cost-import-notes` confirms this deployment's default locale resolves to `en-US`, where the separator roles are reversed from the German-formatted feed - `DecimalFormat` under `en-US` conventions can't make sense of a `,` appearing where it expects a `.`, and throws exactly the `ParseException` seen here, for exactly the rows using the carrier's differently-formatted numbers.",
    },
    {
      id: "carrier-feed-has-encoding-issue",
      label: "The carrier's feed file has a character encoding problem corrupting the numeric values.",
      explanation:
        "The number `\"1.234,56\"` in the exception message is perfectly readable and well-formed text, using ordinary ASCII digits, periods, and commas - there's no sign of encoding corruption here, only of a number formatted under different conventions than the parser assumes.",
    },
    {
      id: "costparser-regex-validation-too-strict",
      label: "A regex-based validation step ahead of parsing is too strict and rejecting valid formats.",
      explanation:
        "The stack trace shows the failure originates directly inside `DecimalFormat.parse()` itself, called from `CostParser.parse`, with no regex validation step anywhere in this path - the number is being handed straight to `DecimalFormat`, which is what actually rejects it.",
    },
    {
      id: "double-precision-insufficient-for-large-costs",
      label: "`double` doesn't have enough precision to represent large freight cost values.",
      explanation:
        "The failure happens during *parsing*, before any value is successfully produced or stored as a `double` at all - this is a `ParseException` about the input text not matching the expected format, not a precision or rounding issue with an already-parsed numeric value.",
    },
  ],
  correctOptionId: "decimalformat-default-locale-mismatch",
  resolution: `The exception shows \`"1.234,56"\` failing to parse - a number that's
completely valid under German-style formatting conventions (\`.\` as the
thousands grouping separator, \`,\` as the decimal separator), which is
exactly how the carrier's feed formats every value. \`CostParser.java.excerpt\`
constructs \`new DecimalFormat()\` with no explicit \`Locale\` argument at
all, so it silently uses whatever the JVM's default locale happens to
be. \`freight-cost-import-notes\` confirms that default resolves to
\`en-US\` on this deployment's containers - under US conventions, the
separator roles are exactly reversed: \`.\` means decimal point, \`,\` means
thousands grouping. Handed a German-formatted number under US parsing
rules, \`DecimalFormat\` can't make sense of the \`,\` appearing where it
expects a decimal point, and throws \`ParseException\` - even though the
number is, and always was, correctly formatted according to the
carrier's own stated (and genuinely consistent) locale conventions.

The fix is parsing with the locale that actually matches the feed's
formatting, rather than whatever the JVM's default happens to be:

\`\`\`java
public double parse(String rawCost) throws ParseException {
    DecimalFormat format = (DecimalFormat) NumberFormat.getInstance(Locale.GERMANY);
    return format.parse(rawCost).doubleValue();
}
\`\`\`

The general rule: \`DecimalFormat\`/\`NumberFormat\` constructed with no
explicit \`Locale\` depend entirely on the JVM's default locale for
deciding which characters are meaningful, and that default is an
environment detail, not a property of any particular input's actual
format - always pass the locale that matches the data being parsed
explicitly, never assume the runtime environment's default will happen
to agree with an external source's formatting conventions.`,
};
