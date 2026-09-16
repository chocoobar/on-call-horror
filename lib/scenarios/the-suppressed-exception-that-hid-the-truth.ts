import type { Scenario } from "./types";

export const theSuppressedExceptionThatHidTheTruth: Scenario = {
  id: "the-suppressed-exception-that-hid-the-truth",
  title: "The Suppressed Exception That Hid the Truth",
  subtitle: "a batch import job reports a confusing \"stream closed\" error, while the actual reason it failed never appears anywhere",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "exceptions", "try-with-resources"],
  briefing: `"vendor-file-import" reads a vendor's price-list file with two
try-with-resources declarations chained together - a file stream wrapped
by a parsing reader. Every time the underlying file has a genuine
encoding problem partway through, the error surfaced to on-call is a
confusing, generic "Stream closed" exception with no indication of what
actually went wrong with the file's content.`,
  constraints: [
    "The vendor file in the reported incident is confirmed to contain a genuine mid-file encoding problem - the underlying `MalformedInputException` a correct diagnosis would need to see is confirmed to have actually been thrown during parsing.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "vendor-file-import-28901788", namespace: "catalog", labels: { app: "vendor-file-import" } },
        spec: { completions: 1 },
        status: { failed: 1 },
        age: "35m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "vendor-file-import-28901788-p4q5r", namespace: "catalog", labels: { app: "vendor-file-import" } },
        status: { phase: "Failed", containerStatuses: [{ name: "vendor-file-import", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "vendor-file-import": [
            "2026-09-15T06:05:03.114Z ERROR c.e.catalog.VendorFileImport - java.io.IOException: Stream closed",
            "    at app//com.example.catalog.VendorFileImport.readAll(VendorFileImport.java:16)",
          ],
        },
        age: "35m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "vendor-file-import-notes", namespace: "catalog" },
        spec: {
          data: {
            "VendorFileImport.java.excerpt":
              "public List<String> readAll(Path file) throws IOException {\n    List<String> lines = new ArrayList<>();\n    try (InputStream raw = Files.newInputStream(file);\n         CustomVendorReader reader = new CustomVendorReader(raw)) {\n        // CustomVendorReader wraps `raw` and, on encountering a genuine\n        // MalformedInputException while parsing, its own close() method\n        // (called automatically, since it's also a resource here) throws\n        // its OWN IOException (\"Stream closed\") while cleaning up -\n        // and try-with-resources only propagates ONE of the two\n        while (reader.hasNext()) {\n            lines.add(reader.next());   // MalformedInputException thrown here first\n        }\n    }\n    return lines;\n}\n",

          },
        },
        age: "35m",
      },
    ],
  },
  hints: [
    "`kubectl get configmap vendor-file-import-notes -n catalog -o yaml` - two resources are declared in this try-with-resources: `raw` and `reader`. What happens when the try block's body throws, and then closing one of the resources *also* throws, during cleanup?",
    "When a `try` block throws, and then closing a resource during automatic cleanup *also* throws, Java doesn't discard either exception - the first (original) exception propagates as the primary one, and the close-time exception is attached to it as a *suppressed* exception, not the other way around... but only if the code catching it actually looks.",
    "The logged stack trace only shows the top-level exception's own message and frames - does it show anything about `getSuppressed()`, or any nested/suppressed exception details, anywhere?",
  ],
  options: [
    {
      id: "suppressed-exception-never-logged",
      label:
        "When `reader.next()` throws `MalformedInputException` partway through parsing, try-with-resources still automatically closes both resources during cleanup - and `CustomVendorReader.close()` itself throws its own `IOException(\"Stream closed\")` during that cleanup; Java's try-with-resources correctly makes the *original* `MalformedInputException` the primary propagated exception and attaches the close-time exception to it as a suppressed exception, but the logging code here only logs the top-level exception's own message, never checking or printing `getSuppressed()`, so the actually-useful original error is silently discarded from visibility even though it was technically preserved.",
      explanation:
        "The error log shows only `IOException: Stream closed` - but the constraint confirms a genuine `MalformedInputException` from the encoding problem really was thrown first, during parsing. `VendorFileImport.java.excerpt` explains the mechanism: when the try block's body throws, try-with-resources still closes both resources, and `CustomVendorReader.close()` throws its own `IOException` during that cleanup. Java's specification is precise about this exact situation: the *original* exception (the `MalformedInputException`) becomes the one that propagates, and the close-time exception becomes a suppressed exception attached to it via `addSuppressed()`/`getSuppressed()` - it's the close-time exception's message (`\"Stream closed\"`) that's misleadingly visible as the top-level exception's own message here specifically because `readAll`'s own throws clause and whatever's catching it never re-throws with the original exception type preserved as primary in a way visible to the logger; either way, the logging code only prints the caught exception's own message, never inspecting `getSuppressed()`, so the genuinely useful root cause is technically present on the exception object but invisible in every log anyone actually reads.",
    },
    {
      id: "customvendorreader-buggy-close-implementation",
      label: "`CustomVendorReader.close()` has a bug causing it to throw even when nothing went wrong during parsing.",
      explanation:
        "The constraint confirms a genuine encoding problem did trigger a real `MalformedInputException` during parsing in this incident - `close()` throwing here isn't a bug in isolation, it's a secondary exception during cleanup that's obscuring the primary, more useful exception from ever being visible in the logs.",
    },
    {
      id: "file-stream-closed-prematurely-by-another-thread",
      label: "Another thread is closing the underlying file stream prematurely while it's still being read.",
      explanation:
        "This is a single-threaded, sequential batch import with no concurrent access to the file stream - the 'Stream closed' message is the close-time exception's own text, part of a normal (if poorly surfaced) try-with-resources cleanup sequence, not evidence of an external thread interfering.",
    },
    {
      id: "vendor-file-permissions-changed-mid-read",
      label: "The vendor file's permissions changed while it was being read, closing the stream unexpectedly.",
      explanation:
        "The constraint confirms the actual root cause is a genuine encoding/content problem partway through the file (a real `MalformedInputException`), not a permissions or access issue - the 'Stream closed' text is a red herring from a secondary, suppressed close-time exception, not a description of an external permissions change.",
    },
  ],
  correctOptionId: "suppressed-exception-never-logged",
  resolution: `The logged exception's message, \`"Stream closed"\`, tells almost nothing
about the actual problem - but the constraint confirms a real
\`MalformedInputException\`, the genuinely useful diagnosis, was thrown
during parsing before that. \`VendorFileImport.java.excerpt\` explains the
mechanism precisely: when \`reader.next()\` throws
\`MalformedInputException\` inside the \`try\` block, try-with-resources
still proceeds to automatically close both declared resources during
cleanup - and \`CustomVendorReader.close()\` itself throws its own
\`IOException("Stream closed")\` in the process. Java's try-with-resources
specification handles exactly this double-exception situation
correctly: the *original* exception (from the try block's body) becomes
the primary exception that propagates to the caller, and the exception
thrown during cleanup is attached to it as a *suppressed* exception via
\`Throwable.addSuppressed()\`, retrievable later via \`getSuppressed()\` -
nothing is silently lost at the language level. The actual bug is
further up the call chain: whatever logging code eventually catches and
reports this exception only prints the top-level exception's own
message, never calling \`getSuppressed()\` to surface what's attached to
it - so the genuinely diagnostic \`MalformedInputException\`, while
technically preserved on the exception object the whole time, never
appears anywhere a human actually reads.

The fix is logging suppressed exceptions explicitly wherever exceptions
are reported:

\`\`\`java
catch (IOException e) {
    log.error("import failed: {}", e.getMessage(), e);
    for (Throwable suppressed : e.getSuppressed()) {
        log.error("  suppressed during cleanup: {}", suppressed.getMessage());
    }
}
\`\`\`

Most structured logging frameworks, when passed the exception object
itself (not just its message string), print suppressed exceptions
automatically as part of the full stack trace - the underlying bug here
is often just logging \`e.getMessage()\` alone instead of the exception
object. The general rule: try-with-resources correctly preserves both
exceptions when a resource's \`close()\` throws during cleanup after the
try block itself already threw - but that information is only useful if
whatever catches and logs the exception actually surfaces
\`getSuppressed()\`, rather than only the primary exception's own message.`,
};
