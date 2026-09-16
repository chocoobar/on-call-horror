import type { Scenario } from "../types";

export const theSandboxThatWasnt: Scenario = {
  id: "the-sandbox-that-wasnt",
  title: "The Sandbox That Wasn't",
  subtitle: "every plugin load has failed since the Java 25 migration finished",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "migration", "security-manager"],
  briefing: `"reports-engine" lets customers upload small plugins (custom report
formatters) that run inside a sandbox so a bad plugin can't touch the
filesystem or network. The migration from Java 17 to Java 25 finished
last night - everything else about the service works. Every single
plugin load since then fails immediately.`,
  constraints: [
    "This isn't about a specific plugin being broken - literally every plugin, including ones that have run in production for years without issue, fails the exact same way immediately after the migration.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "reports-engine", namespace: "reports", labels: { app: "reports-engine" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "reports-engine", image: "registry.internal/reports-engine:9.0.0" }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "reports-engine-1p2q3r4s5-t6u7v", namespace: "reports", labels: { app: "reports-engine" } },
        status: { phase: "Running", containerStatuses: [{ name: "reports-engine", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "reports-engine": [
            "2026-09-15T07:00:01.204Z INFO  c.e.reports.PluginLoader - loading plugin 'quarterly-summary-formatter' v3.2.0",
            "2026-09-15T07:00:01.209Z ERROR c.e.reports.PluginSandbox - failed to install sandbox for plugin execution",
            "java.lang.UnsupportedOperationException: The Security Manager is deprecated and will be removed in a future release",
            "    at java.base/java.lang.System.setSecurityManager(System.java:429)",
            "    at app//com.example.reports.PluginSandbox.enter(PluginSandbox.java:31)",
            "    at app//com.example.reports.PluginLoader.load(PluginLoader.java:58)",
            "2026-09-15T07:00:01.210Z ERROR c.e.reports.PluginLoader - plugin 'quarterly-summary-formatter' failed to load, rejecting",
          ],
        },
        age: "12h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "reports-engine-changelog", namespace: "reports" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v9.0.0 (deployed last night)\n- Migrated runtime from Java 17 to Java 25.\n- No application-level changes to plugin handling in this release -\n  PluginSandbox.java is unchanged from v8.x.\n",
            "PluginSandbox.java.excerpt":
              "public void enter() {\n    System.setSecurityManager(new PluginSecurityManager());\n    try {\n        runUntrustedCode();\n    } finally {\n        System.setSecurityManager(null);\n    }\n}\n",
          },
        },
        age: "12h",
      },
    ],
  },
  hints: [
    "`kubectl logs reports-engine-1p2q3r4s5-t6u7v -n reports` - read the exception's message and its exact type, not just which class throws it.",
    "`kubectl get configmap reports-engine-changelog -n reports -o yaml` - `PluginSandbox.java` didn't change in this release. What did?",
    "The Security Manager API (`System.setSecurityManager`) has been deprecated for years, with warnings, on older JDKs. Recent JDKs went further than a warning.",
  ],
  options: [
    {
      id: "security-manager-permanently-disabled",
      label:
        "The Security Manager was permanently disabled starting with a recent JDK release - calling `System.setSecurityManager(...)` now always throws `UnsupportedOperationException` instead of installing anything, which is exactly what's rejecting every plugin load right after the Java 25 migration.",
      explanation:
        "`PluginSandbox.java` is unchanged between v8.x and v9.0.0 per the changelog - the only thing that changed is the JDK version underneath it. `System.setSecurityManager()` used to work (with deprecation warnings) on Java 17. On the JDK version this service now runs, the Security Manager mechanism has been permanently disabled at the JVM level, so that same call now unconditionally throws `UnsupportedOperationException` - which matches the exact exception and call site in the logs. No plugin-specific bug could explain literally every plugin, including previously-stable ones, failing identically the moment the JDK changed.",
    },
    {
      id: "plugin-jar-corrupted",
      label: "The plugin JAR files got corrupted during the migration and can no longer be loaded.",
      explanation:
        "The failure happens before the plugin's own code ever runs - it's thrown from `PluginSandbox.enter()` trying to install a security sandbox, not from anything related to reading, verifying, or executing the plugin JAR itself.",
    },
    {
      id: "classpath-changed",
      label: "The Java 25 migration changed the application's classpath and the plugin classes can no longer be found.",
      explanation:
        "A classpath problem would surface as `ClassNotFoundException` or `NoClassDefFoundError` for the plugin's own classes - the actual exception here is `UnsupportedOperationException` thrown from inside `System.setSecurityManager`, which is a JVM-level rejection of the sandboxing call itself, unrelated to class loading.",
    },
    {
      id: "heap-too-small-for-sandbox",
      label: "The new JVM's default heap size is too small to allocate the sandbox's security context.",
      explanation:
        "There's no memory-related exception anywhere in the logs, and the failure is instantaneous and identical on every attempt - this is a hard API rejection (`UnsupportedOperationException`), not something that would vary with available memory.",
    },
  ],
  correctOptionId: "security-manager-permanently-disabled",
  resolution: `\`reports-engine-changelog\` rules out a code change: \`PluginSandbox.java\` is
byte-for-byte the same as v8.x. The only variable that moved is the JDK
itself, from 17 to 25. The stack trace confirms exactly where things break
- \`System.setSecurityManager\`, called from \`PluginSandbox.enter()\`, throws
\`UnsupportedOperationException: The Security Manager is deprecated and
will be removed in a future release\`.

The Security Manager API was deprecated for removal all the way back in
Java 17 (with a runtime warning, but it still worked). Recent JDK releases
went further and permanently disabled the mechanism at the JVM level - any
call to \`System.setSecurityManager(...)\` with a non-null argument now
always throws, on every JVM, with no flag to bring the old behavior back.
Any code relying on \`SecurityManager\`-based sandboxing - like
\`PluginSandbox\` here - breaks the instant it runs on a JDK where that
happened, regardless of how stable the plugin code itself is.

There's no JVM flag or configuration fix for this one - the Security
Manager isn't coming back. \`reports-engine\` needs a real replacement
sandboxing strategy for untrusted plugin code, such as running plugins in
a separate, resource-constrained OS process (a container, or a subprocess
with its own restricted permissions) rather than in-process with the host
application:

\`\`\`java
// before: relied on a permanently-removed JVM feature
System.setSecurityManager(new PluginSecurityManager());

// after: isolate untrusted code at the process boundary instead
ProcessBuilder pb = new ProcessBuilder("plugin-runner", pluginJarPath)
    .redirectErrorStream(true);
// ...run with OS-level resource/permission limits (seccomp, a
// restricted container, or a language-level sandbox library)
\`\`\`

Any migration across a large Java version gap is worth grepping for
\`setSecurityManager\`, \`SecurityManager\`, and other APIs marked
"deprecated for removal" in release notes along the way - by the time
they're finalized, there's no compatibility flag left to fall back on.`,
};
