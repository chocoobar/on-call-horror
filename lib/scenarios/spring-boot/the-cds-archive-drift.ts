import type { Scenario } from "../types";

export const theCdsArchiveDrift: Scenario = {
  id: "the-cds-archive-drift",
  title: "The CDS Archive Drift",
  subtitle: "quote-engine's startup time doubled overnight, with no code change and no obvious cause",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "cds", "startup"],
  briefing: `"quote-engine" bakes a class data sharing (CDS) archive into its container
image at build time specifically to keep cold-start latency low during
autoscaling events. Startup time has quietly crept from about 1.5 seconds
to over 3 seconds after last night's build, and nobody can find a code
change that would explain it - the CDS setup itself looks completely
unchanged.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "quote-engine", namespace: "insurance", labels: { app: "quote-engine" } },
        spec: {
          replicas: 4,
          template: {
            spec: {
              containers: [
                { name: "quote-engine", image: "registry.internal/quote-engine:5.1.0", env: [{ name: "JAVA_TOOL_OPTIONS", value: "-XX:SharedArchiveFile=/app/app-cds.jsa -Xshare:auto -Xlog:class+path=info" }] },
              ],
            },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "quote-engine-2n3o4p5q6-r7s8t", namespace: "insurance", labels: { app: "quote-engine" } },
        status: { phase: "Running", containerStatuses: [{ name: "quote-engine", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "quote-engine": [
            "2026-09-15T06:00:00.010Z INFO  [class,path] shared class paths mismatch, disabling shared archive - archive built with classpath 'app.jar:libs/rating-core-4.2.0.jar:libs/rules-common-1.8.0.jar', actual classpath 'app.jar:libs/rating-core-4.2.1.jar:libs/rules-common-1.8.0.jar'",
            "2026-09-15T06:00:03.210Z INFO  o.s.b.SpringApplication - Started QuoteEngineApplication in 3.014 seconds",
          ],
        },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "quote-engine-notes", namespace: "insurance" },
        spec: {
          data: {
            "notes.md":
              "This service's CI pipeline builds the CDS archive (`app-cds.jsa`) in a\ndedicated step that runs `-Xshare:dump` against the exact jar set present\nat that point in the build. Last night's build picked up an automatic\npatch-version bump of `rating-core` (4.2.0 -> 4.2.1) from a floating\ndependency range, but the CDS-dump step runs *before* dependency\nresolution finishes in one specific pipeline stage ordering, so the\narchive baked into the final image was built against the previous jar\nversion's classpath entry, not the one actually shipped.",
          },
        },
        age: "10h",
      },
    ],
  },
  hints: [
    "`kubectl logs quote-engine-2n3o4p5q6-r7s8t -n insurance` - `Xlog:class+path=info` is printing exactly why the shared archive got disabled. Compare the archive's own recorded classpath to the actual one.",
    "The CDS archive isn't just about class *names* - it also records the exact classpath (including jar versions/paths) it was built against, and refuses to be used at all if that doesn't match exactly.",
    "`kubectl get configmap quote-engine-notes -n insurance -o yaml` - when, in the build pipeline, does the CDS archive actually get generated relative to when dependency versions get finalized?",
  ],
  options: [
    {
      id: "cds-archive-built-against-stale-classpath-version",
      label:
        "The CDS archive was built earlier in the CI pipeline than dependency resolution finalized, so it was dumped against the previous `rating-core:4.2.0` classpath entry - when the shipped image's actual classpath ended up with `rating-core:4.2.1` (from a floating version range picking up an overnight patch bump), the JVM's own classpath-matching check at startup correctly detects the mismatch and silently disables the shared archive entirely, falling all the way back to normal, uncached class loading and roughly doubling startup time with no error, just a log line nobody was watching.",
      explanation:
        "The startup log states the mismatch explicitly: `shared class paths mismatch, disabling shared archive - archive built with classpath '...rating-core-4.2.0.jar...', actual classpath '...rating-core-4.2.1.jar...'`, followed by a 3.014-second startup - roughly double the usual ~1.5s. `quote-engine-notes` explains how the two classpaths diverged despite no application code change: the CDS-dump step in CI runs before dependency resolution fully settles in this pipeline's stage ordering, so the archive baked into the image reflects an earlier, since-superseded dependency version than what actually shipped.",
    },
    {
      id: "jvm-startup-flags-misconfigured",
      label: "The `-Xshare:auto` and `-XX:SharedArchiveFile` flags themselves are misconfigured.",
      explanation:
        "The flags are present, correctly pointed at the archive file, and being read successfully - the JVM explicitly logs its own classpath-mismatch check firing and deciding to disable the archive, which means the flags are working exactly as intended; the archive's *contents* are simply stale relative to what's actually deployed.",
    },
    {
      id: "more-beans-registered-since-last-build",
      label: "The application simply has more Spring beans to initialize than it did before, slowing startup naturally.",
      explanation:
        "No application or configuration code changed in this deploy - only a transitive dependency's patch version shifted - and the log attributes the slowdown directly to the CDS archive being disabled due to a classpath mismatch, not to any increase in the amount of work Spring's own context initialization has to do.",
    },
    {
      id: "container-cpu-throttled-during-startup",
      label: "The container is being CPU-throttled during startup, slowing class loading generally.",
      explanation:
        "There's no CPU throttling event or cgroup-related warning here - the log gives a specific, named reason for the slower startup (a classpath mismatch disabling the shared archive), which is an entirely different and more direct mechanism than generic CPU contention.",
    },
  ],
  correctOptionId: "cds-archive-built-against-stale-classpath-version",
  resolution: `The startup log states the cause in plain language: \`shared class paths
mismatch, disabling shared archive\`, naming the exact discrepancy - the
archive was built against \`rating-core-4.2.0.jar\`, but the actual
classpath at runtime has \`rating-core-4.2.1.jar\`. Startup time immediately
after is \`3.014 seconds\`, roughly double the service's normal ~1.5s cold
start.

\`quote-engine-notes\` explains how the archive and the shipped classpath
diverged without any application code changing at all: \`rating-core\` is
pulled in via a floating dependency version range, and last night's build
happened to pick up an automatic patch bump, 4.2.0 to 4.2.1. The CI
pipeline's CDS-dump step, which runs \`-Xshare:dump\` to bake the archive,
runs *before* dependency resolution fully settles in this pipeline's
particular stage ordering - so the archive reflects the classpath as it
existed at that earlier point, not the one that ultimately shipped in the
image. CDS archives validate the exact classpath they were built against
at startup, by design, and refuse to be used at all on any mismatch -
silently and safely falling back to normal class loading rather than
risking using stale or incompatible cached class data.

The fix is reordering the pipeline so the CDS-dump step runs only after
dependency resolution is fully finalized, against the exact jar set that
will actually ship:

\`\`\`
1. resolve dependencies (lock file, \`mvn dependency:resolve\`, etc.)
2. build application jar
3. run -Xshare:dump against the FINAL, resolved classpath
4. bake the resulting archive into the image
\`\`\`

Any CDS or AOT cache is only ever valid for the exact classpath it was
generated against - it's worth adding a CI check that fails the build
loudly if the archive's classpath and the shipped image's classpath ever
diverge, rather than relying on the JVM's own silent, if safe, fallback
to catch it after the fact.`,
};
