import type { Scenario } from "../types";

export const offTheCharsetPath: Scenario = {
  id: "off-the-charset-path",
  title: "Off the Charset Path",
  subtitle: "customer names with accented characters started showing up corrupted, right after the base image upgrade",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "charset", "migration"],
  briefing: `"customer-import" reads a nightly CSV file of new customer records from a
partner and loads them into the database. Since last week's container
base image upgrade (bundled with a newer JDK), customer names containing
accented characters - "Müller," "José," "François" - are being stored
with garbled, incorrect characters. Plain ASCII names are unaffected.`,
  constraints: [
    "The CSV file itself is confirmed correctly encoded in UTF-8 by the partner, unchanged in format for years - this isn't a bad input file.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "customer-import-28901300", namespace: "customers", labels: { app: "customer-import" } },
        spec: { completions: 1 },
        status: { succeeded: 1 },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "customer-import-28901300-f6g7h", namespace: "customers", labels: { app: "customer-import" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "customer-import", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "customer-import": [
            "2026-09-15T02:00:01.114Z INFO  c.e.customers.CsvImporter - importing customers.csv (2104 records)",
            "2026-09-15T02:00:03.884Z INFO  c.e.customers.CsvImporter - imported customer: name=M\\uFFFDller",
            "2026-09-15T02:00:03.910Z INFO  c.e.customers.CsvImporter - import complete",
          ],
        },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "customer-import-notes", namespace: "customers" },
        spec: {
          data: {
            "CsvImporter.java.excerpt":
              "public void importFile(Path csvPath) throws IOException {\n    // no Charset specified - relies on the JVM's default charset\n    try (BufferedReader reader = Files.newBufferedReader(csvPath)) {\n        reader.lines().forEach(this::importLine);\n    }\n}\n",
            "notes.md":
              "Since JDK 18 (JEP 400), the JVM's default charset is UTF-8 everywhere,\nregardless of the underlying OS locale - a deliberate, welcome\nsimplification, since the default used to vary by platform/locale (often\na single-byte, Latin-1-family charset on many Linux locale\nconfigurations prior to that change). This container's *previous* base\nimage was built on a JDK older than 18, running in a locale where the\nplatform default charset happened to be a single-byte, non-UTF-8\ncharset, and the application has always unintentionally depended on that specific\nplatform default matching the file's actual encoding, rather than\nexplicitly specifying UTF-8 itself.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs customer-import-28901300-f6g7h -n customers` - the garbled name shows a replacement character. That's usually a sign of a byte sequence being decoded under the wrong assumed charset.",
    "`kubectl get configmap customer-import-notes -n customers -o yaml` - does `CsvImporter` explicitly specify a charset anywhere when reading the file?",
    "The JDK's own default charset changed as of a specific, well-known JEP - what happens to code that never specified a charset explicitly and was unintentionally relying on the *old* default matching its input files?",
  ],
  options: [
    {
      id: "jdk-default-charset-changed-but-file-encoding-didnt",
      label:
        "`CsvImporter` never specifies a `Charset` when reading the file, relying entirely on the JVM's platform default - the previous base image's older JDK happened to default to a charset that (by luck, not by any explicit configuration) matched the UTF-8-encoded file well enough for plain ASCII, but the new base image's JDK now defaults to real UTF-8 everywhere per a JDK 18+ change; when file reading and decoding didn't line up correctly under whatever the old assumed default actually was, multi-byte UTF-8 sequences for accented characters get misinterpreted, producing garbled output for names outside plain ASCII while pure-ASCII names (which decode identically under almost any charset) stay unaffected.",
      explanation:
        "\`customer-import-notes\` confirms the code never specifies a charset explicitly, and that the application has always implicitly depended on whatever the platform default charset happened to be - true for JDK 18+ (UTF-8 everywhere, by JEP 400), but not guaranteed on older JDKs, where the default could vary by OS locale configuration and, in this case, differed from the file's real UTF-8 encoding. Multi-byte UTF-8 sequences (used specifically for non-ASCII characters like accented letters) get corrupted when decoded under a mismatched single-byte or differently-configured charset, while plain ASCII bytes happen to decode identically under nearly every common charset - exactly matching the observed pattern of accented names breaking while plain-ASCII names stay fine, right after the base image (and its bundled JDK's default charset behavior) changed.",
    },
    {
      id: "partner-csv-encoding-changed",
      label: "The partner silently changed the CSV file's encoding.",
      explanation:
        "The file's encoding is independently confirmed correct, consistent UTF-8 from the partner, unchanged for years - the only thing that changed on the timeline that matches this bug is the container's own base image and bundled JDK, not anything about the input file.",
    },
    {
      id: "database-column-collation-wrong",
      label: "The database column's character set/collation doesn't support accented characters.",
      explanation:
        "The corruption is already visible in the application's own log output immediately after reading the file (before anything is written to the database at all) - the bytes are already wrong by the time they're read into memory, which rules out anything happening later at the database storage layer.",
    },
    {
      id: "csv-parsing-library-bug",
      label: "A bug in the CSV parsing library is misaligning columns for non-ASCII rows.",
      explanation:
        "The garbling shown is a classic single-character replacement artifact (a `\\uFFFD` replacement character) within one field's value, consistent with a charset decoding mismatch at the byte level - not a column-misalignment symptom, which would typically shift or duplicate entire field values rather than corrupting individual characters within one field.",
    },
  ],
  correctOptionId: "jdk-default-charset-changed-but-file-encoding-didnt",
  resolution: `The garbled output - a Unicode replacement character (\`\\uFFFD\`) in place of
the "ü" in "Müller" - is the textbook signature of bytes being decoded
under a charset that doesn't match how they were actually encoded.
\`CsvImporter.java.excerpt\` shows \`Files.newBufferedReader(csvPath)\` called
with no explicit \`Charset\` argument at all, which means it always used
whatever the JVM's *platform default charset* happened to be - a detail
that's easy to never notice as long as that default quietly matches the
file's real encoding. \`customer-import-notes\` explains what changed: as
of JDK 18 (JEP 400), the JVM's default charset became UTF-8
unconditionally, everywhere, replacing the older behavior where the
default could vary based on the underlying OS locale configuration. The
previous base image's older JDK had been implicitly relying on a
platform-default charset that - by locale configuration, not by any
explicit intention in the code - didn't perfectly align with genuine
UTF-8 decoding for the full character range, while still happening to
handle plain ASCII correctly (ASCII bytes decode identically under
almost every common single- and multi-byte charset, which is exactly why
non-accented names were never affected).

The fix is making the charset explicit, so behavior no longer depends on
whatever the JVM's platform default happens to be on any given base
image:

\`\`\`java
try (BufferedReader reader = Files.newBufferedReader(csvPath, StandardCharsets.UTF_8)) {
    reader.lines().forEach(this::importLine);
}
\`\`\`

Any code reading or writing text without an explicit \`Charset\` is
implicitly coupled to whatever the JVM's platform default happens to be -
and that default has both changed across JDK versions (JEP 400) and,
before that change, varied across different OS/locale configurations
entirely outside the application's control. Explicitly specifying
\`UTF-8\` (or whatever charset a given file is actually known to use) makes
that behavior stable and portable across any JDK version or base image,
rather than accidentally correct only as long as nobody changes the
environment underneath it.`,
};
