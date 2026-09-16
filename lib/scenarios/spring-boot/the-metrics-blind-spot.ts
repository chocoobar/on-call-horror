import type { Scenario } from "../types";

export const theMetricsBlindSpot: Scenario = {
  id: "the-metrics-blind-spot",
  title: "The Metrics Blind Spot",
  subtitle: "invoice-delivery-api's dashboards look perfectly calm while a real slowdown has been building for two weeks",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "micrometer", "observability"],
  briefing: `A customer escalation revealed that invoice PDF generation has been
getting slower for roughly two weeks straight - not dramatically, but
steadily, now averaging several seconds where it used to take a few
hundred milliseconds. None of "invoice-delivery-api"'s dashboards show
this at all; the latency panel for its generation endpoint has looked
completely flat the whole time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-delivery-api", namespace: "billing", labels: { app: "invoice-delivery-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "invoice-delivery-api", image: "registry.internal/invoice-delivery-api:3.5.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "14d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-delivery-api-9e0f1g2h3-i4j5k", namespace: "billing", labels: { app: "invoice-delivery-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "invoice-delivery-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "invoice-delivery-api": [
            "2026-09-15T10:00:01.114Z INFO  c.e.billing.InvoiceGenerator - generated PDF for invoice INV-90112 in 3210ms",
            "2026-09-15T10:00:05.220Z INFO  c.e.billing.InvoiceGenerator - generated PDF for invoice INV-90118 in 2980ms",
          ],
        },
        age: "14d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-delivery-api-notes", namespace: "billing" },
        spec: {
          data: {
            "InvoiceGenerator.java.excerpt":
              "@Timed(value = \"invoice.generation.time\") // uses Micrometer's\n                                              // @Timed annotation via\n                                              // TimedAspect\npublic byte[] generatePdf(Invoice invoice) { ... }\n",
            "notes.md":
              "Micrometer's `@Timed` annotation only actually records anything if a\n`TimedAspect` bean is registered in the application context - without\nregistering that bean explicitly, `@Timed` is silently a no-op annotation\nthat does nothing at all. This application never registered a\n`TimedAspect` bean. The Grafana panel showing a flat line is querying the\n`invoice_generation_time_seconds` metric, which has never once been\nemitted, and Grafana is rendering a flat zero/no-data line rather than\nany kind of error for a metric series with zero data points.",
          },
        },
        age: "14d",
      },
    ],
  },
  hints: [
    "`kubectl logs invoice-delivery-api-9e0f1g2h3-i4j5k -n billing` - the application's own logs show real generation times around 3 seconds. Is that reflected anywhere in the metric the dashboard is querying?",
    "`kubectl get configmap invoice-delivery-api-notes -n billing -o yaml` - `@Timed` is a Micrometer annotation, but does simply adding it to a method guarantee it actually records anything?",
    "A flat line on a dashboard can mean 'nothing is happening' or it can mean 'nothing is being measured at all' - those look identical on a graph, but they mean very different things.",
  ],
  options: [
    {
      id: "timed-annotation-noop-without-timedaspect-bean",
      label:
        "`@Timed` on `generatePdf()` has never actually done anything because Micrometer's `@Timed` annotation requires a `TimedAspect` bean to be explicitly registered in the application context to function at all - without it, the annotation is silently inert, no `invoice_generation_time_seconds` metric has ever been emitted, and the dashboard's 'flat' latency panel isn't showing calm, stable performance, it's showing a metric series with zero data points that Grafana renders as a flat line rather than any kind of visible error.",
      explanation:
        "The application's own logs directly contradict the dashboard: real, logged generation times of `3210ms` and `2980ms`, nowhere near flat or fast. `invoice-delivery-api-notes` explains why none of that ever reached the dashboard: `@Timed` is a passive annotation that requires a separately-registered `TimedAspect` bean to actually intercept the annotated method and record anything - and this application never registered one, meaning the annotation has been a complete no-op since it was added, silently producing a metric that simply never existed rather than one reporting misleadingly good numbers.",
    },
    {
      id: "grafana-panel-query-wrong-metric-name",
      label: "The Grafana panel's query is simply referencing the wrong metric name.",
      explanation:
        "`invoice-delivery-api-notes` confirms the panel is querying the correct, expected metric name (`invoice_generation_time_seconds`) for what `@Timed` would produce if it were actually functioning - the problem is that metric was never emitted at all, not that the dashboard is looking in the wrong place for one that does exist.",
    },
    {
      id: "invoicegenerator-logging-inflated-times",
      label: "InvoiceGenerator's own log statements are inflating the reported generation times.",
      explanation:
        "There's no reason to doubt the application's own direct, in-process timing of its own method call - the actual gap here is well-explained by a completely separate, silently-inert metrics annotation, which is a simpler and more specific explanation than assuming the straightforward application log itself is wrong.",
    },
    {
      id: "two-week-old-deploy-changed-pdf-library",
      label: "A two-week-old deploy changed the PDF generation library, and that's the real story here, unrelated to metrics.",
      explanation:
        "Whatever caused the real slowdown is a separate, legitimate investigation worth pursuing - but the specific question this scenario centers on is why the *dashboard* never showed the two weeks of steadily climbing real latency at all, which is explained by the metric never being emitted, independent of whatever ultimately caused the underlying slowdown.",
    },
  ],
  correctOptionId: "timed-annotation-noop-without-timedaspect-bean",
  resolution: `The application's own logs tell a very different story from the
dashboard: real, logged PDF generation times of \`3210ms\` and \`2980ms\` -
nowhere near flat, and nowhere near fast. Since the dashboard is built
directly from this application's own metrics, and the logs show real
slowness the metrics apparently never captured, the metric itself is the
place to look.

\`invoice-delivery-api-notes\` explains why: Micrometer's \`@Timed\`
annotation is deliberately just metadata - it does nothing on its own.
Actually recording a timer from an \`@Timed\`-annotated method requires a
\`TimedAspect\` bean to be explicitly registered in the application context,
which uses Spring AOP to intercept calls to annotated methods and record
the timing. This application added \`@Timed\` to \`generatePdf()\` but never
registered a \`TimedAspect\` bean anywhere - meaning the annotation has been
silently doing nothing since the day it was added. The
\`invoice_generation_time_seconds\` metric the dashboard panel queries has
never had a single data point. Grafana doesn't render "no data" as an
error or a gap by default in many panel configurations - it can render
as a flat line at zero, visually indistinguishable from "this endpoint is
consistently fast."

The fix is registering the missing bean so the annotation actually takes
effect:

\`\`\`java
@Bean
public TimedAspect timedAspect(MeterRegistry registry) {
    return new TimedAspect(registry);
}
\`\`\`

Any use of Micrometer's \`@Timed\` (or \`@Counted\`) needs this bean present
to do anything at all - it's worth verifying, right after adding either
annotation for the first time, that the resulting metric actually appears
in \`/actuator/prometheus\` with real data, rather than trusting the
annotation's presence in code and a calm-looking dashboard as proof it's
working.`,
};
