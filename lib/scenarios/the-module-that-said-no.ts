import type { Scenario } from "./types";

export const theModuleThatSaidNo: Scenario = {
  id: "the-module-that-said-no",
  title: "The Module That Said No",
  subtitle: "the legacy XML-to-object mapper worked flawlessly for years, then started throwing on every single record right after a JDK upgrade",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 22,
  tags: ["java25", "jpms", "reflection"],
  briefing: `"legacy-catalog-importer" relies on an older third-party XML binding
library that populates private fields directly via reflection, bypassing
constructors entirely for performance. It's worked without incident for
years. A routine JDK upgrade this week made every single import fail
immediately, with every field access throwing the same kind of
exception.`,
  constraints: [
    "The XML files being imported are confirmed well-formed and unchanged in structure - this is not a data or schema problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "legacy-catalog-importer-28901688", namespace: "catalog", labels: { app: "legacy-catalog-importer" } },
        spec: { completions: 1 },
        status: { failed: 1 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "legacy-catalog-importer-28901688-h6i7j", namespace: "catalog", labels: { app: "legacy-catalog-importer" } },
        status: { phase: "Failed", containerStatuses: [{ name: "legacy-catalog-importer", ready: false, restartCount: 0, state: { terminated: { reason: "Error", exitCode: 1 } } }] },
        logs: {
          "legacy-catalog-importer": [
            "2026-09-15T05:00:03.114Z ERROR c.e.catalog.LegacyXmlBinder - java.lang.reflect.InaccessibleObjectException: Unable to make field private java.lang.String com.example.catalog.Product.sku accessible: module com.example.catalog does not \"opens com.example.catalog\" to unnamed module",
            "    at java.base/java.lang.reflect.AccessibleObject.checkCanSetAccessible(AccessibleObject.java:363)",
          ],
        },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "legacy-catalog-importer-notes", namespace: "catalog" },
        spec: {
          data: {
            "notes.md":
              "The base image bump this week moved from a JDK build that had been\nrunning with the application on the classpath (no module system\ninvolved at all) to one where the build tooling now packages the\napplication as an explicit Java module (via a module-info.java added in\na recent, unrelated build-tooling change). `legacy-xml-binder`'s\nreflection-based field population calls `Field.setAccessible(true)` on\nprivate fields of `com.example.catalog.Product` at runtime - which the\nmodule system now blocks unless the owning module explicitly `opens`\nthat package for reflective access.\n",
          },
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "`kubectl logs legacy-catalog-importer-28901688-h6i7j -n catalog` - `InaccessibleObjectException` mentions a module (`com.example.catalog`) not opening a package to an 'unnamed module'. That phrase only comes up once the Java Platform Module System is actually in play.",
    "`kubectl get configmap legacy-catalog-importer-notes -n catalog -o yaml` - what changed about how the application itself is packaged and run, separately from the JDK version bump?",
    "Deep reflection - calling `setAccessible(true)` on a private field or method from outside its own module - has always required the owning module's `module-info.java` to explicitly `opens` that package, ever since the module system was introduced; code running unmodularized on the classpath was never subject to this check at all.",
  ],
  options: [
    {
      id: "jpms-opens-required-for-deep-reflection",
      label:
        "Alongside the JDK bump, an unrelated build-tooling change started packaging the application as an explicit Java module (adding a `module-info.java`) instead of running unmodularized on the classpath - `legacy-xml-binder`'s reflection-based field population, which calls `Field.setAccessible(true)` on private fields, now runs under full module system enforcement, and since the application's module doesn't declare `opens com.example.catalog` to allow reflective access from outside the module, every such call throws `InaccessibleObjectException`, for every field, on every import.",
      explanation:
        "The exception message states the exact rule being enforced: module `com.example.catalog` does not `opens com.example.catalog` to the unnamed module (where the reflection call originates from, in `legacy-xml-binder`). `legacy-catalog-importer-notes` confirms the real change wasn't just the JDK version - it's that the application started being packaged as an explicit module for the first time, via a `module-info.java` added by an unrelated build-tooling update. Deep reflection (`setAccessible(true)` on a private member from outside its own module) has always required the owning module to explicitly `opens` that package - code running unmodularized on the classpath was never subject to this restriction at all, which is exactly why this worked without incident for years right up until the packaging itself changed.",
    },
    {
      id: "legacy-xml-binder-library-abandoned-incompatible",
      label: "The `legacy-xml-binder` library itself is fundamentally incompatible with any recent JDK version.",
      explanation:
        "The exception is a specific, well-defined module-system access check, not a general incompatibility failure (like a `NoSuchMethodError` from a removed API) - the library's reflection mechanism itself still works exactly as designed; it's being blocked by a permission boundary that didn't exist for its unmodularized classpath execution before.",
    },
    {
      id: "product-class-fields-renamed",
      label: "The `Product` class's field names were changed, and the XML binder can't find them anymore.",
      explanation:
        "The exception explicitly confirms the field (`sku`) was found and identified correctly (`Unable to make field ... Product.sku accessible`) - the failure is about *access permission* to a field the reflection code has already correctly located, not about failing to find a renamed or missing field.",
    },
    {
      id: "xml-files-malformed-after-schema-update",
      label: "The XML files being imported no longer match the expected schema.",
      explanation:
        "The constraint confirms the XML files are well-formed and unchanged in structure - and the exception occurs during Java reflection setup, on the application's own `Product` class, before any XML content is actually being mapped into fields at all.",
    },
  ],
  correctOptionId: "jpms-opens-required-for-deep-reflection",
  resolution: `The exception message states the exact rule being violated: module
\`com.example.catalog\` doesn't \`opens com.example.catalog\` to the unnamed
module, which is where \`legacy-xml-binder\`'s reflective field access
originates from. \`legacy-catalog-importer-notes\` reveals the real change
behind this incident wasn't only the JDK version bump - an unrelated,
concurrent build-tooling update started packaging the application as an
explicit named Java module, adding a \`module-info.java\` for the first
time. \`legacy-xml-binder\`'s field-population mechanism calls
\`Field.setAccessible(true)\` on private fields of \`Product\` at runtime -
this kind of "deep reflection" has *always* required the target's owning
module to explicitly grant reflective access via an \`opens\` directive in
its \`module-info.java\`, ever since the module system was introduced.
Code running unmodularized, directly on the classpath (the application's
situation for years, right up until this build-tooling change), was
never subject to this check at all - there was no module boundary to
enforce it against. The JDK upgrade landing in the same release is
mostly coincidental timing; the actual trigger is that the application
itself only just became a real module.

The fix is explicitly opening the package that needs reflective access,
either narrowly (to the specific library) or, as a pragmatic stopgap,
more broadly:

\`\`\`java
// module-info.java
module com.example.catalog {
    opens com.example.catalog to legacy.xml.binder;   // narrow: only to that library
    // or, more broadly, if the library's own module name isn't known/stable:
    // opens com.example.catalog;
}
\`\`\`

The general rule: any library that relies on deep reflection into
private members requires the target's module to explicitly \`opens\` the
relevant package once that target starts running as a named module -
this is invisible and irrelevant on the unnamed classpath, but becomes a
hard requirement the moment a project adopts the module system, even
years into a codebase's life, with no other code change involved.`,
};
