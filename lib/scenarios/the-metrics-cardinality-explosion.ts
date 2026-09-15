import type { Scenario } from "./types";

export const theMetricsCardinalityExplosion: Scenario = {
  id: "the-metrics-cardinality-explosion",
  title: "The Metrics Cardinality Explosion",
  subtitle: "gift-card-api's dashboards went blank right as its Prometheus scrape started taking forever",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "micrometer", "observability"],
  briefing: `Since last week's release, "gift-card-api"'s Grafana dashboards have been
mostly blank, and the shared Prometheus instance is complaining about
memory pressure and slow scrapes across the whole team's namespace, not
just this one service. Nobody touched dashboard config - the only recent
change was a new endpoint for looking up a gift card by its code.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "gift-card-api", namespace: "commerce", labels: { app: "gift-card-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "gift-card-api", image: "registry.internal/gift-card-api:2.4.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "6d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "gift-card-api-1x2y3z4a5-b6c7d", namespace: "commerce", labels: { app: "gift-card-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "gift-card-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "gift-card-api": [
            "2026-09-15T10:00:01.114Z WARN  i.m.p.PrometheusMeterRegistry - meter registry now tracking 380000+ distinct timeseries for metric 'http.server.requests'",
            "2026-09-15T10:00:15.220Z WARN  o.s.b.a.metrics.web.servlet.WebMvcMetricsAutoConfiguration - request URI tag cardinality exceeds typical bounds; verify path variables are being templated correctly",
          ],
        },
        age: "6d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gift-card-api-notes", namespace: "commerce" },
        spec: {
          data: {
            "GiftCardController.java.excerpt":
              "@GetMapping(\"/gift-cards/lookup\")\npublic GiftCardDto lookup(@RequestParam String code) {\n    return service.findByCode(code);\n    // Micrometer's WebMvcTags records the full request URI as the\n    // 'uri' tag by default for query-parameter-based endpoints -\n    // there's no {code} path template to normalize against here, and\n    // the endpoint was never given an explicit metrics tag override,\n    // so each distinct gift card code queried produces its own unique\n    // timeseries\n",
          },
        },
        age: "6d",
      },
    ],
  },
  hints: [
    "`kubectl logs gift-card-api-1x2y3z4a5-b6c7d -n commerce` - 380,000+ distinct timeseries for a single metric name is a huge red flag. What's making each one unique?",
    "`kubectl get configmap gift-card-api-notes -n commerce -o yaml` - the new lookup endpoint takes `code` as a query parameter, not a path variable. Does Micrometer have a template to normalize a query-parameter-based URI the way it does for `/gift-cards/{id}`?",
    "Every distinct gift card code queried becomes part of the recorded request tag if there's no explicit normalization - with millions of gift cards in circulation, that's millions of potential timeseries for one metric.",
  ],
  options: [
    {
      id: "query-param-endpoint-produces-unbounded-uri-tag-cardinality",
      label:
        "The new `/gift-cards/lookup?code=...` endpoint takes its identifier as a query parameter rather than a path variable, so Micrometer's default URI tagging has no `{code}` template to normalize against and effectively tags each request with something close to the raw, distinct query value - producing one new timeseries per distinct gift card code looked up, ballooning `http.server.requests` into hundreds of thousands of series and overwhelming the shared Prometheus instance's memory and scrape time.",
      explanation:
        "The warning names the exact mechanism: `380000+ distinct timeseries for metric 'http.server.requests'`, followed immediately by a hint about URI tag cardinality and path variable templating. `gift-card-api-notes` explains why this endpoint specifically is the source: unlike a path-variable endpoint (`/gift-cards/{id}`), which Micrometer can normalize to a single templated tag value, this one takes `code` as a query parameter with no explicit tag override - so each distinct code queried contributes its own high-cardinality tag value, and gift card codes are effectively unbounded in number.",
    },
    {
      id: "prometheus-instance-undersized",
      label: "The shared Prometheus instance itself is simply undersized for the team's overall metrics volume.",
      explanation:
        "The warning is specific to this one metric on this one service exploding to 380,000+ timeseries right after a particular endpoint shipped - that's a cardinality problem localized to gift-card-api's new code, not a general capacity shortfall across the shared instance's entire workload.",
    },
    {
      id: "grafana-dashboard-query-broken",
      label: "The Grafana dashboard's query itself is broken, unrelated to what's being collected.",
      explanation:
        "The warnings are emitted from within gift-card-api's own Prometheus meter registry about what it's collecting and reporting for scraping, before Grafana ever queries anything - a broken dashboard query wouldn't explain a service's own metrics registry warning about excessive cardinality.",
    },
    {
      id: "too-many-replicas-scraped-separately",
      label: "Scraping two replicas separately is doubling the metrics volume unnecessarily.",
      explanation:
        "Two replicas being scraped independently is completely normal and would only roughly double a metric's series count, not multiply it by hundreds of thousands - the actual cause is a single metric splitting into one series per distinct gift card code, which happens per-pod regardless of replica count.",
    },
  ],
  correctOptionId: "query-param-endpoint-produces-unbounded-uri-tag-cardinality",
  resolution: `The application's own metrics registry names the problem directly: \`meter
registry now tracking 380000+ distinct timeseries for metric
'http.server.requests'\`, followed by a warning specifically about URI tag
cardinality and path variable templating. \`gift-card-api-notes\` explains
why the new lookup endpoint is the source: Micrometer's default web MVC
tagging normalizes path-variable endpoints like \`/gift-cards/{id}\` into a
single templated tag value regardless of which ID was requested - but
\`/gift-cards/lookup?code=...\` takes its identifier as a query parameter,
which has no equivalent template to normalize against. With no explicit
tag override configured, each distinct gift card code effectively
produces its own tag value, and with potentially millions of gift cards
in circulation, that's an unbounded number of new timeseries - one per
code ever looked up, never cleaned up, accumulating in both this
service's own meter registry and the shared Prometheus instance scraping
it.

The fix is normalizing the recorded tag so it doesn't vary per request,
using a metrics-specific tag contributor or by switching the identifier
to a path variable that Micrometer can template:

\`\`\`java
@GetMapping("/gift-cards/{code}")
public GiftCardDto lookup(@PathVariable String code) {
    return service.findByCode(code); // {code} is templated by Micrometer,
                                       // producing one series total for
                                       // this endpoint, not one per code
}
\`\`\`

If the query-parameter shape has to stay for API-compatibility reasons, a
custom \`WebMvcTagsProvider\` can strip or normalize high-cardinality query
values before they ever become a metric tag. Either way, any endpoint
whose identifier can take effectively unbounded distinct values needs an
explicit plan for keeping that value out of a metric tag - Micrometer's
defaults only protect against this automatically for templated path
variables.`,
};
