import type { Scenario } from "../types";

export const thePathThatWorkedOnMyMachine: Scenario = {
  id: "the-path-that-worked-on-my-machine",
  title: "The Path That Worked on My Machine",
  subtitle: "report generation fails in every environment except the developer's own laptop, on the exact same code",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 14,
  tags: ["java25", "nio", "portability"],
  briefing: `"report-generator" writes nightly PDF reports to a configured output
directory, using a path built by joining a few configuration values
together in code. It works flawlessly on every developer's local
Windows machine, but has never once succeeded in the Linux-based
container it actually runs in production.`,
  constraints: [
    "The output directory itself is confirmed to exist, and is confirmed writable by the container's process user, in production.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "report-generator", namespace: "reporting", labels: { app: "report-generator" } },
        spec: { schedule: "0 4 * * *" },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-generator-28901522-u4v5w", namespace: "reporting", labels: { app: "report-generator" } },
        status: { phase: "Failed", containerStatuses: [{ name: "report-generator", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "report-generator": [
            "2026-09-15T04:00:02.114Z ERROR c.e.reporting.ReportWriter - java.nio.file.NoSuchFileException: /data/reports\\2026-09-15\\daily.pdf",
            "    at java.base/sun.nio.fs.UnixException.translateToIOException(UnixException.java:92)",
          ],
        },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "report-generator-notes", namespace: "reporting" },
        spec: {
          data: {
            "ReportWriter.java.excerpt":
              "public Path outputPathFor(String date) {\n    String base = config.getOutputDir();   // e.g. \"/data/reports\"\n    // built as a plain string concatenation using a hardcoded\n    // Windows-style separator, instead of Path's own join method\n    return Path.of(base + \"\\\\\" + date + \"\\\\daily.pdf\");\n}\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl logs report-generator-28901522-u4v5w -n reporting` - look closely at the exact path in the exception message. What kind of slash separates its segments?",
    "`kubectl get configmap report-generator-notes -n reporting -o yaml` - how is the path actually being assembled - through `Path`'s own join methods, or by hand with a hardcoded separator character?",
    "A backslash is a valid path separator on Windows, but on Linux it's just an ordinary character with no special meaning - a path built with hardcoded backslashes becomes a single long, invalid filename on any Unix-like filesystem.",
  ],
  options: [
    {
      id: "hardcoded-windows-separator-on-linux",
      label:
        "`outputPathFor` builds the path with a hardcoded backslash (`\\\\`) as the separator instead of using `Path`'s own join methods (like `resolve`) - on Windows, backslash is a genuine path separator, so it worked on every developer's laptop, but on Linux (where the production container runs), backslash has no special meaning at all, so the whole string is interpreted as one literal directory/file name that was never actually created, producing `NoSuchFileException` on every run.",
      explanation:
        "The exception message shows the literal path `/data/reports\\2026-09-15\\daily.pdf` - a mix of a correct leading forward-slash-based base directory and then hardcoded backslashes for the rest. `ReportWriter.java.excerpt` confirms the path is built by string concatenation using a hardcoded `\\\\` separator. On Windows, that's a genuine directory separator, which is exactly why this worked on every developer's local machine; on Linux, backslash is just an ordinary character with no filesystem meaning, so the whole tail (`2026-09-15\\daily.pdf`) is treated as one single literal filename inside `/data/reports`, a file (and the directory structure implied by treating backslashes as separators) that never actually exists.",
    },
    {
      id: "output-directory-permissions-wrong-in-prod",
      label: "The output directory's file permissions in production don't allow the container's process user to write to it.",
      explanation:
        "The constraint confirms the output directory is verified to exist and be writable by the container's process user - the exception is `NoSuchFileException`, about a path that doesn't resolve to any existing structure at all, not a permissions-denied error.",
    },
    {
      id: "date-format-producing-invalid-characters",
      label: "The date string formatting is producing characters that are invalid in a file path.",
      explanation:
        "The date portion of the path (`2026-09-15`) is a completely standard, valid date string containing only digits and hyphens - there's nothing invalid about its characters; the problem is entirely in how the path segments around it are joined together.",
    },
    {
      id: "cronjob-mounting-wrong-volume",
      label: "The CronJob's pod spec is mounting the wrong volume for `/data/reports`.",
      explanation:
        "The base directory portion of the path (`/data/reports`) is correctly resolved and present at the start of the failing path - the volume mount itself is fine; it's everything appended after it, using the wrong separator character, that breaks.",
    },
  ],
  correctOptionId: "hardcoded-windows-separator-on-linux",
  resolution: `The exception message shows the exact path Java tried to resolve:
\`/data/reports\\2026-09-15\\daily.pdf\` - a correctly-formed base directory
followed by segments joined with a literal backslash character.
\`ReportWriter.java.excerpt\` confirms the path is assembled through plain
string concatenation, with \`"\\\\\\\\"\` hardcoded as the separator between
segments, instead of using \`Path\`'s own \`resolve(...)\` method (or any
other OS-aware join mechanism). On Windows, a backslash genuinely is a
valid, meaningful path separator, which is exactly why this worked on
every developer's local Windows laptop without anyone noticing a
problem. On Linux - where the production container actually runs - a
backslash has no special meaning to the filesystem at all; it's just an
ordinary character, like any letter or digit. The entire string after
the base directory is interpreted as one single, long, literal file or
directory name, which of course was never actually created anywhere,
producing \`NoSuchFileException\` on every single run in production.

The fix is building the path with \`Path\`'s own OS-aware join method
instead of hardcoding a separator character:

\`\`\`java
public Path outputPathFor(String date) {
    Path base = Path.of(config.getOutputDir());
    return base.resolve(date).resolve("daily.pdf");   // uses the correct
                                                        // separator for the
                                                        // OS actually running it
}
\`\`\`

The general rule: never hardcode a path separator character (\`/\` or
\`\\\\\`) in application code - use \`Path.resolve(...)\`,
\`Paths.get(a, b, c)\`, or \`File.separator\` if a raw separator is
genuinely unavoidable, so the same code produces a valid path on
whatever OS it actually runs on, not just the one it was written on.`,
};
