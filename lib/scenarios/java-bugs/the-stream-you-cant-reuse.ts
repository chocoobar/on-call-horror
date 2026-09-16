import type { Scenario } from "../types";

export const theStreamYouCantReuse: Scenario = {
  id: "the-stream-you-cant-reuse",
  title: "The Stream You Can't Reuse",
  subtitle: "generating a summary PDF works fine, but generating both the summary and the detail PDF from one request always crashes on the second one",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 18,
  tags: ["java25", "streams", "reuse"],
  briefing: `"report-builder" produces two different PDF views - a short summary and
a detailed breakdown - from the same filtered set of transactions for a
given report request. Generating just the summary works every time.
Generating both in the same request, as most users actually do,
reliably crashes while building the detail PDF.`,
  constraints: [
    "The transaction data itself, and the filtering logic that selects which transactions belong in the report, are both confirmed correct - the crash happens strictly after filtering, while building the second output.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "report-builder", namespace: "reporting", labels: { app: "report-builder" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "5w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-builder-8u9v0w1x2-y3z4a", namespace: "reporting", labels: { app: "report-builder" } },
        status: { phase: "Running", containerStatuses: [{ name: "report-builder", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "report-builder": [
            "2026-09-15T14:18:02.114Z INFO  c.e.reporting.ReportBuilder - summary PDF generated successfully (312 transactions)",
            "2026-09-15T14:18:02.204Z ERROR c.e.reporting.ReportBuilder - java.lang.IllegalStateException: stream has already been operated upon or closed",
            "    at app//com.example.reporting.ReportBuilder.buildDetailPdf(ReportBuilder.java:15)",
          ],
        },
        age: "5w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "report-builder-notes", namespace: "reporting" },
        spec: {
          data: {
            "ReportBuilder.java.excerpt":
              "public ReportResult build(List<Transaction> all, ReportFilter filter) {\n    Stream<Transaction> filtered = all.stream().filter(filter::matches);\n        // one Stream object built once, referenced by field/local variable\n\n    byte[] summary = buildSummaryPdf(filtered);   // consumes (terminates) the stream\n    byte[] detail = buildDetailPdf(filtered);      // re-uses the SAME stream reference\n\n    return new ReportResult(summary, detail);\n}\n",
          },
        },
        age: "5w",
      },
    ],
  },
  hints: [
    "`kubectl logs report-builder-8u9v0w1x2-y3z4a -n reporting` - the summary PDF builds successfully first, and only the *second* PDF build fails, with `IllegalStateException: stream has already been operated upon or closed`.",
    "`kubectl get configmap report-builder-notes -n reporting -o yaml` - `filtered` is one single `Stream` object, and both `buildSummaryPdf` and `buildDetailPdf` are called with that same reference. Can a Java `Stream` be consumed more than once?",
    "A `Stream`'s terminal operation (whatever `buildSummaryPdf` does with it internally) consumes the stream - once a terminal operation has run, that stream object is permanently closed and unusable, and any further operation on it throws, regardless of what operation it is.",
  ],
  options: [
    {
      id: "stream-reused-after-terminal-operation",
      label:
        "`filtered` is built once as a single `Stream<Transaction>` object, and both `buildSummaryPdf(filtered)` and `buildDetailPdf(filtered)` are called with that same reference - `buildSummaryPdf` runs a terminal operation on it internally to produce the summary, which permanently consumes and closes the stream, so the later call to `buildDetailPdf` with that same now-closed stream reference throws `IllegalStateException`, since a Java `Stream` can only ever be traversed by a terminal operation exactly once.",
      explanation:
        "The log shows the summary PDF building successfully first, and the very next operation - building the detail PDF - failing with exactly `IllegalStateException: stream has already been operated upon or closed`, the JDK's own specific message for reusing a consumed stream. `ReportBuilder.java.excerpt` confirms `filtered` is a single `Stream` object built once and passed by reference into both `buildSummaryPdf` and `buildDetailPdf` in sequence. Java's `Stream` API is explicitly documented as single-use: once a terminal operation has consumed a stream (whatever `buildSummaryPdf` does internally to produce PDF bytes), that stream instance is permanently closed, and any further operation attempted on it - even a completely different one, like whatever `buildDetailPdf` needs - throws this exact exception.",
    },
    {
      id: "detail-pdf-template-missing-data",
      label: "The detail PDF's template is missing data fields that the summary template doesn't need.",
      explanation:
        "The exception is `IllegalStateException` about stream reuse, thrown before any PDF template rendering logic is reached at all - `buildDetailPdf` fails at the point of trying to operate on the stream itself, not partway through rendering a template with incomplete data.",
    },
    {
      id: "transaction-filter-matches-method-has-side-effects",
      label: "`filter.matches(...)` has a side effect that corrupts state between the two PDF builds.",
      explanation:
        "The exception is thrown specifically because the stream itself was already fully consumed and closed by the first PDF build - this is a documented, absolute constraint of the `Stream` API's single-use design, unrelated to whether the filter predicate itself has any side effects.",
    },
    {
      id: "two-concurrent-requests-sharing-report-builder-state",
      label: "Two concurrent requests are racing on shared state inside `ReportBuilder`.",
      explanation:
        "`filtered` is a local variable, freshly created within a single call to `build`, with no sharing across requests or threads at all - the failure is fully deterministic and reproducible on a single request in isolation, with no concurrency involved.",
    },
  ],
  correctOptionId: "stream-reused-after-terminal-operation",
  resolution: `The log shows the summary PDF succeeding first, immediately followed by
the detail PDF failing with the JDK's own specific, unambiguous message:
\`IllegalStateException: stream has already been operated upon or
closed\`. \`ReportBuilder.java.excerpt\` shows exactly why: \`filtered\` is
built once, as a single \`Stream<Transaction>\` object, and that same
object reference is passed into both \`buildSummaryPdf\` and
\`buildDetailPdf\` in sequence. Java's \`Stream\` API is explicitly,
deliberately designed for single use: whatever terminal operation
\`buildSummaryPdf\` performs internally (collecting, iterating, reducing -
anything that actually pulls elements through the pipeline) permanently
consumes and closes that stream object. This isn't a bug or a
limitation that's ever meant to be worked around by careful sequencing -
attempting *any* further operation on an already-consumed stream, even
one built by a completely different downstream consumer like
\`buildDetailPdf\`, always throws this same exception, unconditionally.

The fix is building a fresh stream (or, more simply, a reusable
collection) for each independent consumer:

\`\`\`java
public ReportResult build(List<Transaction> all, ReportFilter filter) {
    List<Transaction> filtered = all.stream()
        .filter(filter::matches)
        .toList();   // materialize once into a reusable List

    byte[] summary = buildSummaryPdf(filtered.stream());   // fresh stream each time
    byte[] detail = buildDetailPdf(filtered.stream());

    return new ReportResult(summary, detail);
}
\`\`\`

Materializing the filtered result into a \`List\` once, and calling
\`.stream()\` fresh for each consumer (or having each consumer just accept
a \`List\` directly, if streaming isn't actually needed), avoids the reuse
problem entirely and also avoids re-running the filter predicate
multiple times. The general rule: a \`Stream\` reference must never be
stored and reused across multiple terminal operations - each \`Stream\`
pipeline is consumed exactly once; build a new one (or work from a
materialized collection) for each independent operation that needs the
data.`,
};
