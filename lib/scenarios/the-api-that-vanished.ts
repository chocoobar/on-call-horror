import type { Scenario } from "./types";

export const theApiThatVanished: Scenario = {
  id: "the-api-that-vanished",
  title: "The API That Vanished",
  subtitle: "the plugin loader that dynamically instantiates report generators broke completely after a routine JDK patch update",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "jdk-upgrade", "reflection"],
  briefing: `"report-plugin-loader" dynamically instantiates report generator classes
by name, discovered from a config file, so new report types can be
added without redeploying the core service. After a routine JDK patch
bump on the base image, every plugin fails to load with a
NoSuchMethodError, even though none of the plugin classes themselves
were touched.`,
  constraints: [
    "The plugin `.jar` files and their class definitions are confirmed byte-for-byte unchanged - only the base image's JDK version changed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "report-plugin-loader", namespace: "reporting", labels: { app: "report-plugin-loader" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-plugin-loader-0c1d2e3f4-g5h6i", namespace: "reporting", labels: { app: "report-plugin-loader" } },
        status: { phase: "Running", containerStatuses: [{ name: "report-plugin-loader", ready: false, restartCount: 4, state: { running: {} } }] },
        logs: {
          "report-plugin-loader": [
            "2026-09-15T09:20:03.114Z ERROR c.e.reporting.PluginLoader - java.lang.NoSuchMethodError: 'java.lang.Object java.lang.Class.newInstance()'",
            "    at app//com.example.reporting.PluginLoader.instantiate(PluginLoader.java:12)",
          ],
        },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "report-plugin-loader-notes", namespace: "reporting" },
        spec: {
          data: {
            "PluginLoader.java.excerpt":
              "public ReportGenerator instantiate(String className) throws Exception {\n    Class<?> clazz = Class.forName(className);\n    return (ReportGenerator) clazz.newInstance();   // Class.newInstance() -\n        // deprecated since Java 9, removed entirely in a later release\n}\n",
            "notes.md":
              "`Class.newInstance()` was deprecated in Java 9 (JEP note: it bypasses\nconstructor-declared checked exception wrapping and access checks in\nsurprising ways) in favor of\n`clazz.getDeclaredConstructor().newInstance()`. This release's base\nimage JDK patch bump happened to cross the version boundary where the\nmethod, having been deprecated for years, was finally removed from the\nplatform entirely.\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl logs report-plugin-loader-0c1d2e3f4-g5h6i -n reporting` - `NoSuchMethodError` for `Class.newInstance()` specifically - a JDK class's own method, not an application or plugin class.",
    "`kubectl get configmap report-plugin-loader-notes -n reporting -o yaml` - `Class.newInstance()` has a long deprecation history. What actually changed about its availability in the JDK version this base image bump crossed into?",
    "A `NoSuchMethodError` thrown for a *JDK platform class's own method* almost always means code was compiled against an older JDK API surface than the one it's now running on - the method genuinely no longer exists in the runtime being used, regardless of what plugin code itself contains.",
  ],
  options: [
    {
      id: "class-newinstance-removed-in-jdk-upgrade",
      label:
        "`PluginLoader.instantiate` calls the long-deprecated `Class.newInstance()`, and the routine base image JDK patch bump happened to cross the version boundary where that method - deprecated since Java 9 - was finally removed from the platform entirely; the plugin `.jar` files themselves are unchanged, but the core application code calling a now-nonexistent JDK method throws `NoSuchMethodError` for every single plugin load attempt, regardless of which plugin class is being instantiated.",
      explanation:
        "The exception is explicit: `NoSuchMethodError: 'java.lang.Object java.lang.Class.newInstance()'` - a method on the JDK's own `Class` type, not on any plugin or application class. `PluginLoader.java.excerpt` confirms `instantiate` calls exactly this method. `report-plugin-loader-notes` confirms `Class.newInstance()` was deprecated in Java 9 and was removed outright in a later release that this routine base image patch bump happened to cross into. Since the plugin `.jar` files and their classes are confirmed unchanged, and the failure occurs inside `PluginLoader`'s own instantiation call (before any plugin-specific code even runs), this is a core application code path calling a JDK method that genuinely no longer exists in the runtime now hosting it - affecting every single plugin uniformly, exactly as observed.",
    },
    {
      id: "plugin-jars-compiled-against-different-jdk",
      label: "The plugin `.jar` files were compiled against a different, incompatible JDK version.",
      explanation:
        "The plugin jars are confirmed byte-for-byte unchanged, and the failing call - `Class.newInstance()` - is a JDK platform method invoked by the core `PluginLoader` code itself, before it ever reaches any plugin-specific class bytecode - this failure has nothing to do with how the plugin jars were compiled.",
    },
    {
      id: "report-generator-interface-changed",
      label: "The `ReportGenerator` interface that plugins implement changed incompatibly.",
      explanation:
        "The exception occurs during object instantiation itself, via a JDK reflection method, before the resulting object is ever cast to or used as a `ReportGenerator` - an interface mismatch would surface as a `ClassCastException` or `NoSuchMethodError` referencing the interface, not the JDK's own `Class.newInstance()` method.",
    },
    {
      id: "plugin-config-file-pointing-to-wrong-classes",
      label: "The plugin configuration file is pointing to class names that no longer exist.",
      explanation:
        "`Class.forName(className)` runs first and would throw `ClassNotFoundException` if the class name itself were invalid - the exception is instead thrown by the very next line, on the JDK's own `newInstance()` method, meaning the target class was found successfully and the failure is in the instantiation mechanism itself.",
    },
  ],
  correctOptionId: "class-newinstance-removed-in-jdk-upgrade",
  resolution: `The exception message is specific and points directly at a JDK platform
method, not application or plugin code: \`NoSuchMethodError:
'java.lang.Object java.lang.Class.newInstance()'\`.
\`PluginLoader.java.excerpt\` shows \`instantiate\` calling exactly this
method. \`report-plugin-loader-notes\` explains the history: \`Class.newInstance()\`
was deprecated back in Java 9, specifically because it has surprising
behavior around checked exceptions and access checks compared to
reflective constructor invocation - and after years of deprecation, a
later JDK release removed it from the platform entirely. This routine
base image patch bump happened to cross exactly that version boundary.
Since the plugin \`.jar\` files themselves are confirmed unchanged, and
the failure happens inside \`PluginLoader\`'s own instantiation logic
before any plugin-specific class code runs at all, this affects every
single plugin uniformly - the core loader itself is calling a method
that simply no longer exists in the JDK now running it, regardless of
which plugin it was trying to load.

The fix is switching to the long-recommended replacement, which has been
available and stable since the same JDK version that deprecated the old
method:

\`\`\`java
public ReportGenerator instantiate(String className) throws Exception {
    Class<?> clazz = Class.forName(className);
    return (ReportGenerator) clazz.getDeclaredConstructor().newInstance();
}
\`\`\`

The general rule: a routine JDK/base-image version bump can remove APIs
that have been deprecated for a long time - deprecation warnings are
worth acting on well before an upgrade forces the issue, and any
\`NoSuchMethodError\`/\`NoSuchFieldError\` referencing a JDK platform class
after an upgrade is a strong signal to check that class's deprecation
and removal history for the version being upgraded to.`,
};
