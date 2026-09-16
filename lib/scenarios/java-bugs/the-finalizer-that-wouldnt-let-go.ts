import type { Scenario } from "../types";

export const theFinalizerThatWouldntLetGo: Scenario = {
  id: "the-finalizer-that-wouldnt-let-go",
  title: "The Finalizer That Wouldn't Let Go",
  subtitle: "file-processor eventually throws \"Too many open files\" and dies, every few days, like clockwork",
  difficulty: "hard",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 25,
  tags: ["java25", "finalization", "migration"],
  briefing: `"file-processor" migrated from Java 11 to Java 25 last month, alongside a
routine dependency upgrade of an old third-party library it uses for
reading a legacy binary file format. Since the migration, it reliably
crashes with "Too many open files" every few days under normal load - it
never did this on Java 11.`,
  constraints: [
    "The application's own file-handling code explicitly closes every file it opens, in a try-with-resources block, and this is confirmed correct by code review - the leak is somewhere else.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "file-processor", namespace: "processing", labels: { app: "file-processor" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "file-processor-8k9l0m1n2-o3p4q", namespace: "processing", labels: { app: "file-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "file-processor", ready: true, restartCount: 5, state: { running: {} } }] },
        logs: {
          "file-processor": [
            "2026-09-15T11:00:01.114Z ERROR c.e.processing.FileHandler - java.io.FileNotFoundException: /data/inbound/batch-4471.dat (Too many open files)",
            "    at java.base/java.io.FileInputStream.open0(Native Method)",
          ],
        },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "file-processor-changelog", namespace: "processing" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v8.0.0 (deployed 1 month ago)\n- Migrated runtime from Java 11 to Java 25.\n- Bumped `legacy-binary-parser` (third-party library) from 2.1 to 2.3,\n  a routine transitive dependency update - no direct usage changes in\n  our own code.\n\n### Vendor note (legacy-binary-parser library, unmaintained since 2019)\n`LegacyFileReader` (inside the third-party library, not our own code)\nopens a native file descriptor in its constructor and releases it in an\noverridden `finalize()` method, relying on the garbage collector to\neventually call `finalize()` and release the handle - it does not\nimplement `Closeable`/`AutoCloseable` and provides no explicit close\nmethod at all. This pattern was already considered poor practice when\nthe library was written, but functioned adequately on JVMs where\nfinalization ran reasonably promptly.\n",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap file-processor-changelog -n processing -o yaml` - what did the migration actually change, and separately, what does the vendor note say about how the third-party library releases its file handles?",
    "Finalization (`Object.finalize()`) was deprecated for removal starting with an early Java 9 JEP, and later JDK releases went further than deprecation. What happens to code that only releases a resource inside `finalize()` on a JVM where finalization support has been reduced or disabled?",
    "The application's own file handling is confirmed correct - the leak has to be in a file handle that something else is responsible for closing, and the vendor's own library documentation says exactly how it expects that to happen.",
  ],
  options: [
    {
      id: "finalization-disabled-breaks-legacy-close-pattern",
      label:
        "The third-party `legacy-binary-parser` library only releases its native file handles inside an overridden `finalize()` method, with no explicit close method at all - a pattern that worked adequately on Java 11, but on Java 25, finalization has been deprecated for years and its support significantly reduced/disabled by default, so `finalize()` effectively never runs (or runs far too rarely) to release those handles, leaking one file descriptor per processed file until the process runs out and crashes.",
      explanation:
        "`file-processor-changelog`'s vendor note confirms `LegacyFileReader` relies entirely on `finalize()` to release its native file handle, with no `Closeable`/explicit close method the application's own (correctly-written, try-with-resources-based) code could even call if it wanted to. Finalization was deprecated for removal starting in an early JEP and modern JDKs have progressively reduced or disabled it by default - a library that depends on `finalize()` actually running promptly to free a limited OS resource like file descriptors will leak that resource steadily on a JVM where finalization is unreliable or effectively inert. This matches the timeline exactly: no such crashes on Java 11 (where finalization still ran reasonably), reliable crashes a few days into sustained use on Java 25, once enough leaked handles from `LegacyFileReader` accumulate to hit the OS's open-file-descriptor limit.",
    },
    {
      id: "legacy-binary-parser-2.3-regression",
      label: "The `legacy-binary-parser` 2.1-to-2.3 version bump introduced a new bug in file handling.",
      explanation:
        "The vendor note describes `LegacyFileReader`'s finalize()-based resource release as a long-standing design of the library, not something newly introduced in version 2.3 - and the timing correlates specifically with the JDK migration (a known, well-documented change in JVM finalization behavior across versions), not with the routine dependency bump that happened alongside it.",
    },
    {
      id: "application-not-closing-files",
      label: "file-processor's own code isn't actually closing files it opens.",
      explanation:
        "The application's own file-handling code is explicitly confirmed correct by code review, using try-with-resources throughout - the leaking resource belongs to a third-party library's internal object, one the application's own code has no handle-closing responsibility for or even visibility into.",
    },
    {
      id: "os-file-descriptor-limit-lowered",
      label: "The container's OS-level open-file-descriptor limit (`ulimit`) was lowered during the migration.",
      explanation:
        "A lower ulimit would make the crash happen sooner or under lighter load, but wouldn't explain why it happens at all on Java 25 when the exact same limit (unchanged, per the migration notes covering only the JDK and one dependency) never caused a crash on Java 11 - the actual leak, not the ceiling it eventually hits, is what changed.",
    },
  ],
  correctOptionId: "finalization-disabled-breaks-legacy-close-pattern",
  resolution: `The vendor note is unambiguous once read carefully: \`LegacyFileReader\`
inside the third-party \`legacy-binary-parser\` library opens a native file
descriptor in its constructor and only ever releases it inside an
overridden \`finalize()\` method - there's no \`close()\` method, no
\`Closeable\`/\`AutoCloseable\` interface, nothing the application's own
(genuinely correct) file-handling code could call even if it tried.
Finalization was deprecated for removal starting with an early JDK
release, on the grounds that relying on \`finalize()\` for timely resource
cleanup was always unreliable - the garbage collector has no obligation
to run finalizers promptly, or in some configurations, meaningfully run
them at all. Later JDK releases progressively reduced and disabled
finalization support by default. A library written against the
assumption that \`finalize()\` would eventually run and clean things up
"good enough" on Java 11 leaks its resource indefinitely on a JVM where
that assumption no longer reliably holds - one file descriptor per
processed file, accumulating steadily until the container hits its
open-file-descriptor limit and every subsequent file operation fails.

Since this is an internal implementation detail of an unmaintained
third-party library with no explicit close method to call, the practical
fix is JVM-level: explicitly enabling and tuning finalization behavior if
the JDK version in use still permits it, or - the more durable fix -
replacing the abandoned library entirely with a maintained alternative
that implements proper \`Closeable\` semantics:

\`\`\`java
// if a maintained replacement exists, migrate to it:
try (ModernBinaryFileReader reader = ModernBinaryFileReader.open(path)) {
    reader.process();
}   // explicit close, guaranteed, no finalizer involved
\`\`\`

As a last-resort, temporary stopgap only, some JVMs still expose a way to
request more frequent finalization passes, but that's fighting a
deprecated, unreliable mechanism rather than fixing the underlying
problem - any dependency whose resource cleanup relies on
\`finalize()\` alone should be treated as a liability on any Java version
where finalization support is being actively reduced.`,
};
