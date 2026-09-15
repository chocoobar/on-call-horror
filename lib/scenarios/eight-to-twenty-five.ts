import type { Scenario } from "./types";

export const eightToTwentyFive: Scenario = {
  id: "eight-to-twenty-five",
  title: "Eight to Twenty-Five",
  subtitle: "invoice-export has been on Java 8 for six years - now it's on Java 25, and exports are down",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "migration", "jaxb"],
  briefing: `"invoice-export" has quietly run on Java 8 since it was written, long
enough that nobody currently on the team wrote it. This week it finally
got migrated straight to Java 25, skipping every LTS release in between.
Most of the service works fine. The one feature that's completely
broken: exporting an invoice as XML, which is used by exactly one legacy
enterprise customer's billing integration - and it's the first thing that
customer tried this morning.`,
  constraints: [
    "This isn't a general startup failure - the service starts fine and every other endpoint responds normally. It only breaks on the XML export code path specifically.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-export", namespace: "invoicing", labels: { app: "invoice-export" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "invoice-export", image: "registry.internal/invoice-export:2.0.0" }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "5h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-export-2w3x4y5z6-a7b8c", namespace: "invoicing", labels: { app: "invoice-export" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoice-export", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoice-export": [
            "2026-09-15T09:12:01.004Z INFO  c.e.invoicing.ExportController - GET /invoices/inv-5521/export?format=xml",
            "2026-09-15T09:12:01.011Z ERROR c.e.invoicing.XmlInvoiceWriter - failed to write XML export for inv-5521",
            "java.lang.NoClassDefFoundError: javax/xml/bind/DatatypeConverter",
            "    at app//com.example.invoicing.XmlInvoiceWriter.formatAmount(XmlInvoiceWriter.java:44)",
            "    at app//com.example.invoicing.XmlInvoiceWriter.write(XmlInvoiceWriter.java:22)",
            "    at app//com.example.invoicing.ExportController.export(ExportController.java:38)",
            "Caused by: java.lang.ClassNotFoundException: javax.xml.bind.DatatypeConverter",
            "    ... 6 more",
          ],
        },
        age: "5h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-export-changelog", namespace: "invoicing" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v2.0.0 (deployed this morning)\n- Migrated runtime directly from Java 8 to Java 25 (JDK image bump\n  only - no dependency or code changes in this release).\n- JSON/CSV export paths verified working post-migration.\n- XML export path not covered by the migration test suite - it's\n  used by one customer and wasn't in the smoke-test checklist.\n",
          },
        },
        age: "5h",
      },
    ],
  },
  hints: [
    "`kubectl logs invoice-export-2w3x4y5z6-a7b8c -n invoicing` - read the exact package name in the exception: `javax.xml.bind.DatatypeConverter`.",
    "`kubectl get configmap invoice-export-changelog -n invoicing -o yaml` - this was a pure JDK version bump, no dependency changes. What used to ship *inside* the JDK itself on Java 8 that might not anymore?",
    "Java 8 bundled the full Java EE API set (JAXB, JAX-WS, and others) as part of the JDK itself, with no separate dependency required. A later JDK release removed those modules from the runtime entirely.",
  ],
  options: [
    {
      id: "jaxb-removed-from-jdk",
      label:
        "`javax.xml.bind` (JAXB) shipped as part of the Java 8 runtime itself, with no separate dependency needed - it was removed from the JDK starting with Java 11. Jumping straight from Java 8 to Java 25 means that package simply isn't on the classpath anymore, so any code that was silently relying on the JDK-bundled version now fails with `NoClassDefFoundError` at runtime.",
      explanation:
        "The changelog confirms this was a pure JDK bump with no dependency changes - which is exactly the trap. On Java 8, `javax.xml.bind.DatatypeConverter` was available for free as part of the JDK; nobody needed to add it as a project dependency because it was always just *there*. Every JDK from 11 onward removed the Java EE modules (JAXB included) from the runtime entirely. Since invoice-export skipped every LTS release in between and went straight from 8 to 25, this class disappeared out from under it in one jump, and the one code path that used it - the rarely-exercised XML export - is the only place it shows up.",
    },
    {
      id: "xml-invoice-writer-bug",
      label: "XmlInvoiceWriter.java has a pre-existing logic bug in `formatAmount()` that was already broken on Java 8.",
      explanation:
        "The exception is `NoClassDefFoundError` - a class that used to be loadable can no longer be found at all - not a logic error inside a method that runs successfully. This is a missing-dependency problem introduced by the runtime change, not a bug in the method's own code.",
    },
    {
      id: "container-image-corrupted",
      label: "The new container image is missing files due to a broken build.",
      explanation:
        "Every other endpoint (JSON/CSV export, per the changelog, plus normal request handling) works correctly on the new image - a broken or incomplete image build would affect the whole application, not one specific class used by one code path.",
    },
    {
      id: "customer-sending-bad-xml",
      label: "The legacy customer's integration is sending a malformed request that the XML export can't handle.",
      explanation:
        "The failure happens on the server before any response is written, thrown from a `NoClassDefFoundError` while trying to load a class needed to format the output - it has nothing to do with what the customer sent in their request, and would fail identically for any request that reaches this code path.",
    },
  ],
  correctOptionId: "jaxb-removed-from-jdk",
  resolution: `The exception is a giveaway once the JDK history is known:
\`java.lang.NoClassDefFoundError: javax/xml/bind/DatatypeConverter\`. On
Java 8, the entire Java EE API surface - JAXB (\`javax.xml.bind\`), JAX-WS,
and a few others - shipped bundled inside the JDK itself. No project ever
needed to declare it as a dependency; it was simply always on the
classpath. Starting with Java 11, those modules were removed from the JDK
runtime entirely, on the theory that they were separately maintained,
Java EE-specific technologies that didn't belong bundled with the core
platform anymore.

invoice-export skipped Java 9 through 24 entirely and jumped straight from
8 to 25, per \`invoice-export-changelog\`. Every LTS release in between
would have surfaced this same failure the moment someone tried it - but
because the jump happened in one shot, with no dependency changes (the
changelog explicitly notes this was a pure JDK bump) and no code changes,
the class just silently stopped existing on the classpath the moment the
new image shipped. It only shows up on the one code path that used it:
the XML export, exercised by exactly one customer, which is why it wasn't
caught by the JSON/CSV-focused smoke tests.

The fix is adding JAXB back as an explicit project dependency, since it's
no longer free from the JDK:

\`\`\`xml
<dependency>
    <groupId>jakarta.xml.bind</groupId>
    <artifactId>jakarta.xml.bind-api</artifactId>
    <version>4.0.2</version>
</dependency>
<dependency>
    <groupId>org.glassfish.jaxb</groupId>
    <artifactId>jaxb-runtime</artifactId>
    <version>4.0.5</version>
</dependency>
\`\`\`

(The package namespace also moved from \`javax.xml.bind\` to
\`jakarta.xml.bind\` in the versions still being maintained, so
\`XmlInvoiceWriter\`'s imports need updating too, not just the classpath.)
Any migration that skips multiple LTS releases at once is worth an
explicit audit for JDK-bundled-then-removed APIs - JAXB, JAX-WS, CORBA,
and the Activation Framework are the classic ones that go missing exactly
like this.`,
};
