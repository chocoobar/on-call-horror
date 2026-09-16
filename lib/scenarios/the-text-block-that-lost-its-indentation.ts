import type { Scenario } from "./types";

export const theTextBlockThatLostItsIndentation: Scenario = {
  id: "the-text-block-that-lost-its-indentation",
  title: "The Text Block That Lost Its Indentation",
  subtitle: "the fixed-width shipping manifest printed for the warehouse scanner is suddenly unreadable by the scanner",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "text-blocks", "formatting"],
  briefing: `The warehouse's barcode scanner reads a fixed-width manifest template
where every field must start at an exact column. After a refactor moved
the template literal into a nicely-indented text block for readability,
the scanner started rejecting nearly every manifest as "malformed" -
even though nobody touched the actual field values or their order.`,
  constraints: [
    "The values being substituted into the template (item codes, quantities) are confirmed correct - the printed template's own structure is what changed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "manifest-printer", namespace: "warehouse", labels: { app: "manifest-printer" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "manifest-printer-6n7o8p9q0-r1s2t", namespace: "warehouse", labels: { app: "manifest-printer" } },
        status: { phase: "Running", containerStatuses: [{ name: "manifest-printer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "manifest-printer": [
            "2026-09-15T06:10:02.114Z INFO  c.e.warehouse.ManifestPrinter - printed manifest for shipment shp-2291",
            "2026-09-15T06:10:03.008Z ERROR c.e.warehouse.ScannerBridge - manifest rejected: field 'SKU' expected at column 0, found at column 4",
          ],
        },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "manifest-printer-notes", namespace: "warehouse" },
        spec: {
          data: {
            "ManifestPrinter.java.excerpt":
              "public String template() {\n    // refactored into a text block during a recent cleanup, indented to\n    // match the surrounding method body for readability\n    return \"\"\"\n            SKU:%s\n            QTY:%d\n            BIN:%s\n            \"\"\".formatted(sku, qty, bin);\n}\n",
            "notes.md":
              "Text blocks strip *incidental* leading whitespace based on the\nleast-indented non-blank line (including the position of the closing\ndelimiter) across the whole block, at compile time - but the amount\nstripped is determined structurally by the block's own indentation, not\nby the surrounding code's indentation being 'intended' as purely\ncosmetic.\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl logs manifest-printer-6n7o8p9q0-r1s2t -n warehouse` - the scanner expects the `SKU` field at column 0, but it's arriving at column 4.",
    "`kubectl get configmap manifest-printer-notes -n warehouse -o yaml` - text blocks strip leading whitespace common to every line, based on the *closing* `\"\"\"` delimiter's own position too. Where does this text block's closing delimiter actually sit?",
    "If every line inside the text block - including the closing `\"\"\"` line - is indented by the same 12 spaces to match the surrounding Java code, is there any 'incidental' whitespace left for the compiler to strip at all?",
  ],
  options: [
    {
      id: "text-block-indentation-not-actually-stripped",
      label:
        "The text block's content lines and its closing `\"\"\"` delimiter are all indented equally (to match the surrounding method body, for source readability), which means the compiler finds no *incidental* leading whitespace to strip - every line keeps its full leading indentation as literal content, so the printed manifest's fields all start several columns to the right of where the fixed-width-reading scanner expects them.",
      explanation:
        "The `ScannerBridge` error shows `SKU` arriving at column 4 instead of the expected column 0 - a 4-space indentation surviving into the actual printed output. `manifest-printer-notes` explains why: a text block strips leading whitespace common to every line, including the line holding the closing `\"\"\"`, treating only whitespace *beyond* that shared minimum as incidental and removable. Because `ManifestPrinter.java.excerpt`'s text block indents both its content lines and its closing `\"\"\"\"\"\"` identically, to match the surrounding code's indentation for readability, the shared minimum indentation *is* that full indentation - none of it counts as 'extra' to strip, so it survives into the literal string exactly as written, four columns further right than the fixed-width scanner requires.",
    },
    {
      id: "formatted-method-inserting-extra-spaces",
      label: "`.formatted(sku, qty, bin)` is inserting extra padding spaces around the substituted values.",
      explanation:
        "The error is about the `SKU` *label* itself starting at the wrong column, before any substituted value even appears - `%s`/`%d` format specifiers don't add surrounding whitespace on their own, and the misalignment is consistent with the entire template's leading indentation, not with padding around individual values.",
    },
    {
      id: "scanner-firmware-changed-expected-format",
      label: "The barcode scanner's firmware was updated and now expects a different manifest format.",
      explanation:
        "The error is specifically about column alignment (`expected at column 0, found at column 4`), which lines up precisely with the printer-side template's own indentation being carried into the output - there's no indication the scanner's expected format itself changed, only that what's being sent no longer matches it.",
    },
    {
      id: "shipment-data-includes-leading-whitespace",
      label: "The shipment data (`sku`, `qty`, `bin` values) themselves contain leading whitespace.",
      explanation:
        "The error points at the fixed field *label* (`SKU`) being misaligned, not at a value substituted into the template - and the constraint confirms the substituted values themselves are correct; the structural indentation of the template itself is what shifted.",
    },
  ],
  correctOptionId: "text-block-indentation-not-actually-stripped",
  resolution: `\`ScannerBridge\`'s error is precise: the \`SKU\` field arrives at column 4
instead of the expected column 0 - a 4-space indentation making it into
the literal output. \`manifest-printer-notes\` explains the rule Java text
blocks actually follow: the compiler strips only *incidental* leading
whitespace, determined by finding the least-indented non-blank line
across the entire block - and critically, the line holding the closing
\`"""\` delimiter counts toward that calculation too. \`ManifestPrinter.java.excerpt\`'s
text block was refactored so every content line *and* the closing
delimiter line are indented identically, matching the surrounding
method body for source readability. That means the "least indented"
line among all of them is still indented by that full amount - there's
no whitespace narrower than the rest for the compiler to treat as
incidental, so none of it gets stripped. The indentation that looks
purely cosmetic in the source is, structurally, part of the literal
string value.

The fix is dedenting the closing delimiter (and, typically, the content
lines) to the desired final indentation level, independent of the
surrounding code's own indentation:

\`\`\`java
public String template() {
    return """
        SKU:%s
        QTY:%d
        BIN:%s
        """.formatted(sku, qty, bin);   // closing delimiter's column controls
                                        // exactly how much gets stripped
}
\`\`\`

Placing the closing \`"""\` at column 0 (or wherever the desired left
margin of the actual content should be) strips exactly that much
whitespace from every line. The general rule: a text block's stripped
whitespace is determined by the position of its *least-indented* line,
closing delimiter included - matching a text block's indentation to
"however deeply nested the surrounding code happens to be" is not the
same thing as producing unindented output.`,
};
