import type { Scenario } from "../types";

export const theAotCacheMismatch: Scenario = {
  id: "the-aot-cache-mismatch",
  title: "The AOT Cache Mismatch",
  subtitle: "the fast-startup optimization that was supposed to help just crashed every pod",
  difficulty: "hard",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 25,
  tags: ["java25", "aot-cache", "startup"],
  briefing: `"pricing-engine" adopted Java 25's AOT cache a month ago to cut cold-start
time roughly in half - it's been working great. This morning's routine
deploy crash-looped every single pod immediately on startup.`,
  constraints: [
    "The application's own code compiles and passes tests fine - this failure only happens when the container actually starts.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-engine", namespace: "pricing", labels: { app: "pricing-engine" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "pricing-engine",
                  image: "registry.internal/pricing-engine:12.4.0",
                  args: ["-XX:AOTCache=/app/pricing-engine.aot", "-jar", "/app/app.jar"],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 3, availableReplicas: 0 },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-engine-2n3o4p5q6-r7s8t", namespace: "pricing", labels: { app: "pricing-engine" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "pricing-engine", ready: false, restartCount: 5, state: { waiting: { reason: "CrashLoopBackOff" } } }],
        },
        logs: {
          "pricing-engine": [
            "Error occurred during initialization of VM",
            "AOTCache /app/pricing-engine.aot is not compatible with this JVM (application classpath mismatch)",
          ],
        },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pricing-engine-changelog", namespace: "pricing" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v12.4.0 (deployed this morning)\n- Bumped `jackson-databind` from 2.17.1 to 2.18.0 (routine dependency\n  update, picked up automatically by dependency management).\n- No other changes.\n\n### AOT cache process\n`pricing-engine.aot` is generated once, during a dedicated training run\nagainst a specific build, and baked into the image at that point. It is\nnot regenerated automatically when the application's dependencies or\ncode change - regenerating it is a separate, manual step in the release\nprocess that was documented but not automated.\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "`kubectl logs pricing-engine-2n3o4p5q6-r7s8t -n pricing` - read the JVM's own error message carefully, before any application code even gets a chance to run.",
    "`kubectl get configmap pricing-engine-changelog -n pricing -o yaml` - what changed in this release, and separately, how is the AOT cache file itself normally kept up to date?",
    "An AOT cache is generated once, against one exact classpath, and baked into the image. What happens if the classpath it was trained against and the classpath actually being loaded at startup are no longer the same?",
  ],
  options: [
    {
      id: "aot-cache-not-regenerated-after-dependency-bump",
      label:
        "The image's classpath changed (a routine `jackson-databind` version bump) but the baked-in AOT cache file wasn't regenerated to match, since that's a separate manual step in the release process - the JVM detects the classpath mismatch at startup and refuses to use an AOT cache that no longer corresponds to reality, crashing before the application ever gets a chance to run.",
      explanation:
        "The JVM's own error - \"AOTCache is not compatible with this JVM (application classpath mismatch)\" - is a direct, explicit statement of the problem, thrown during VM initialization, before any application code executes. `pricing-engine-changelog` confirms this release only changed a dependency version (jackson-databind), and separately confirms the AOT cache is a one-time training artifact that has to be manually regenerated to match a new classpath - a step this release skipped. The AOT cache baked into the image was trained against the previous jackson-databind version; the JVM correctly refuses to load an inconsistent cache rather than risk using stale, unsafe pre-computed class data.",
    },
    {
      id: "jackson-databind-incompatible",
      label: "jackson-databind 2.18.0 has a breaking API change that pricing-engine's code doesn't handle.",
      explanation:
        "The failure happens during JVM initialization itself, before any application or library code runs at all - a jackson-databind API incompatibility would surface as an application-level error (a `NoSuchMethodError` or similar) once the app actually starts running, not as a VM-level AOT cache rejection.",
    },
    {
      id: "container-image-corrupted",
      label: "This morning's image build is corrupted or incomplete.",
      explanation:
        "The specific, well-formed error about AOT cache classpath compatibility is a normal, expected JVM safety check working exactly as designed - it isn't the kind of generic or garbled failure a corrupted image build would typically produce.",
    },
    {
      id: "not-enough-memory-for-aot-cache",
      label: "The container doesn't have enough memory to load the AOT cache.",
      explanation:
        "There's no memory-related error anywhere in the logs - the JVM's message is specifically about the AOT cache being incompatible with the current classpath, a correctness check that has nothing to do with how much memory is available to load it.",
    },
  ],
  correctOptionId: "aot-cache-not-regenerated-after-dependency-bump",
  resolution: `The JVM says exactly what happened, before the application ever gets a
chance to run: \`AOTCache ... is not compatible with this JVM (application
classpath mismatch)\`. \`pricing-engine-changelog\` fills in why - this
release bumped \`jackson-databind\`, a routine dependency update that
nonetheless changes the exact set of classes on the classpath, and the
AOT cache baked into the image is a one-time snapshot trained against a
*specific* classpath during a dedicated training run. Regenerating that
snapshot to match a new classpath is a separate, manual release step,
documented but not automated - and this release's dependency bump went
out without it. The JVM's own safety check refuses to load an AOT cache
that no longer matches reality rather than risk using inconsistent
pre-computed class data, which is exactly the right thing for it to do -
it just means every pod crashes identically and immediately on startup
until the mismatch is fixed.

The fix is regenerating the AOT cache as part of this release, not
skipping straight to deploying the new jar:

\`\`\`bash
# training run against the new build, producing an updated cache
java -XX:AOTMode=record -XX:AOTConfiguration=pricing-engine.aotconf \\
     -jar app.jar
java -XX:AOTMode=create -XX:AOTConfiguration=pricing-engine.aotconf \\
     -XX:AOTCache=pricing-engine.aot -jar app.jar
\`\`\`

then rebuilding the image with the freshly-generated cache included.
Longer-term, this training step belongs in CI, triggered by the same
build that produces the jar - a manual, easy-to-forget step is exactly
how an unrelated dependency bump ends up looking like a mysterious
startup crash months later.`,
};
