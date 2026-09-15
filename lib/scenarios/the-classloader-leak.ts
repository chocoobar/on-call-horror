import type { Scenario } from "./types";

export const theClassloaderLeak: Scenario = {
  id: "the-classloader-leak",
  title: "The ClassLoader Leak",
  subtitle: "rules-engine's Metaspace usage only ever goes up, one plugin reload at a time",
  difficulty: "hard",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 25,
  tags: ["java25", "classloader", "metaspace"],
  briefing: `"rules-engine" lets business analysts hot-reload pricing rule plugins
without restarting the service - a plugin JAR gets swapped and reloaded
in place, several times a day. Pods have started getting OOMKilled every
few days, always after a long string of plugin reloads, never right after
a fresh restart.`,
  constraints: [
    "Heap usage is confirmed normal and stable throughout - whatever's growing isn't heap.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "rules-engine", namespace: "pricing", labels: { app: "rules-engine" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "rules-engine",
                  image: "registry.internal/rules-engine:3.5.0",
                  resources: { limits: { memory: "2Gi" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "rules-engine-1b2c3d4e5-f6g7h", namespace: "pricing", labels: { app: "rules-engine" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "rules-engine",
              ready: true,
              restartCount: 4,
              state: { running: { startedAt: "2026-09-15T02:00:00Z" } },
              lastState: { terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-11T09:00:00Z", finishedAt: "2026-09-15T01:59:50Z" } },
            },
          ],
        },
        logs: {
          "rules-engine": [
            "2026-09-14T18:02:01.114Z INFO  c.e.rules.PluginLoader - reloading plugin 'eu-discount-rules.jar' (reload #212 since startup)",
            "2026-09-14T18:02:01.980Z INFO  c.e.rules.PluginLoader - plugin 'eu-discount-rules.jar' reloaded successfully",
          ],
        },
        age: "4d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rules-engine-notes", namespace: "pricing" },
        spec: {
          data: {
            "PluginLoader.java.excerpt":
              "public void reload(String pluginName, Path jarPath) {\n    URLClassLoader newLoader = new URLClassLoader(\n        new URL[] { jarPath.toUri().toURL() },\n        getClass().getClassLoader()\n    );\n    RuleSet rules = loadRuleSet(newLoader, pluginName);\n    activeRuleSets.put(pluginName, rules);   // old ClassLoader reference\n    // is dropped here, but is still reachable via `rules`' own\n    // objects, which keep a reference back to the ClassLoader that\n    // defined their classes for as long as they're cached elsewhere.\n}\n",
            "notes.md":
              "A metrics cache elsewhere in the app keeps historical `RuleSet`\ninstances around (for an audit trail of 'what rule was active when'),\nkeyed by timestamp, with no expiry - each cached `RuleSet` instance keeps\nits originating `URLClassLoader` (and every class it ever loaded)\nreachable for as long as that cache entry exists, which today is\nforever.\n",
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get pod rules-engine-1b2c3d4e5-f6g7h -n pricing -o yaml` - `lastState.terminated.reason` is `OOMKilled`, and heap is confirmed fine. What else lives outside the heap and grows with the number of classes ever loaded?",
    "`kubectl get configmap rules-engine-notes -n pricing -o yaml` - each plugin reload creates a brand-new `URLClassLoader`. What has to happen for the JVM to actually reclaim a ClassLoader (and every class it loaded) once it's no longer needed?",
    "A ClassLoader (and its classes) can only be garbage collected once *nothing* still references it - directly, or indirectly through any object whose class it loaded. Read `notes.md` for where such a reference might be quietly surviving.",
  ],
  options: [
    {
      id: "old-classloaders-retained-by-audit-cache",
      label:
        "Every plugin reload creates a new `URLClassLoader`, but a separate, unbounded audit cache elsewhere in the app keeps old `RuleSet` instances around forever - and each of those instances keeps its originating ClassLoader (and every class it loaded) reachable, so Metaspace only ever grows, one plugin reload's worth of classes at a time, until the container is OOMKilled.",
      explanation:
        "`rules-engine-notes` shows the mechanism directly: `PluginLoader` creates a fresh `URLClassLoader` on every reload, and while the reference in `activeRuleSets` gets overwritten each time, the audit cache elsewhere keeps old `RuleSet` instances - and therefore their ClassLoaders and every class those ClassLoaders defined - reachable indefinitely, with no expiry. A ClassLoader can only be garbage collected once it's completely unreachable; as long as one old `RuleSet` instance survives anywhere, its entire ClassLoader (Metaspace metadata included) survives with it. Heap being fine while OOMKills keep happening after long strings of reloads, never right after a fresh restart, matches exactly - this is Metaspace growth tied to a reload count, not heap growth tied to request volume.",
    },
    {
      id: "plugin-jars-too-large",
      label: "The plugin JAR files themselves are simply too large to load repeatedly.",
      explanation:
        "A single plugin JAR being large would cost roughly the same fixed amount of Metaspace on every reload if old ClassLoaders were being properly collected - it wouldn't explain unbounded growth that only shows up after many reloads accumulate, which points at old ClassLoaders never being released rather than any one load being too expensive.",
    },
    {
      id: "heap-fragmentation",
      label: "Heap fragmentation from repeated plugin loading is reducing usable memory over time.",
      explanation:
        "Heap usage is confirmed normal and stable the entire time - fragmentation would show up as heap-related symptoms (higher heap usage or more frequent GC), not as an OOMKill with heap reported fine, which is exactly the discrepancy pointing at non-heap (Metaspace) growth instead.",
    },
    {
      id: "too-many-plugin-reloads-per-day",
      label: "Reloading plugins several times a day is simply too frequent for the JVM to keep up with.",
      explanation:
        "There's nothing inherently unsustainable about reloading classes multiple times a day *if* the old classes and their ClassLoaders are actually released afterward - the problem isn't reload frequency itself, it's that old ClassLoaders are being kept alive indefinitely by an unrelated cache, so every reload adds to a total that never shrinks.",
    },
  ],
  correctOptionId: "old-classloaders-retained-by-audit-cache",
  resolution: `\`lastState.terminated.reason: OOMKilled\` with heap confirmed normal
points straight at non-heap memory - and for an app that dynamically
loads classes, that almost always means Metaspace. \`rules-engine-notes\`
shows exactly how: every plugin reload creates a fresh \`URLClassLoader\`
to isolate the new plugin's classes, which is the right pattern for hot
reloading - but a separate audit cache elsewhere in the app keeps old
\`RuleSet\` instances around indefinitely for historical tracking, with no
expiry. Each cached \`RuleSet\` instance keeps a live reference back to the
ClassLoader that defined its classes, and a ClassLoader can only be
garbage collected once absolutely nothing - no instance, no class, no
static field - still references it or anything it loaded. As long as one
old \`RuleSet\` survives in that cache, its entire ClassLoader, and every
class it ever loaded, survives in Metaspace right alongside it. 212
reloads since startup means roughly 212 ClassLoaders' worth of class
metadata accumulated, one at a time, until the container ran out of room.

The fix is breaking the reference chain - either bound and expire the
audit cache, or store a lightweight, ClassLoader-independent summary
instead of the live \`RuleSet\` object itself:

\`\`\`java
// before: keeps the whole RuleSet (and its ClassLoader) alive forever
auditCache.put(timestamp, ruleSet);

// after: store what's actually needed for an audit trail, nothing more
auditCache.put(timestamp, RuleSetSummary.from(ruleSet));  // plain data,
                                                            // no back-reference
                                                            // to the ClassLoader
\`\`\`

Any hot-reloading design built around per-reload ClassLoaders needs to
audit every place a loaded object or its class might get cached
elsewhere - a single unbounded cache holding one instance from an old
ClassLoader is enough to keep that entire ClassLoader, and everything it
loaded, permanently unreclaimable.`,
};
