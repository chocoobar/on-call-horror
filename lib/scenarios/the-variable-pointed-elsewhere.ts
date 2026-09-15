import type { Scenario } from "./types";

export const theVariablePointedElsewhere: Scenario = {
  id: "the-variable-pointed-elsewhere",
  title: "The Variable Pointed Elsewhere",
  subtitle: "the staging dashboard for inventory-api looks alarmingly identical to production's",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["grafana", "datasource", "multi-cluster"],
  briefing: `An engineer switched the "Environment" dropdown on the shared inventory-api
dashboard from "production" to "staging" to check something unrelated, and
the numbers barely moved - same request rate, same error rate, same pod
count, down to suspiciously similar-looking noise. Staging is supposed to
get a tiny fraction of production's traffic. Now nobody's sure which
environment they've actually been looking at all week.`,
  constraints: [
    "Both a production and a staging Prometheus datasource are confirmed configured and reachable in Grafana independently.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-api", namespace: "inventory-staging", labels: { app: "inventory-api", env: "staging" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inventory-dashboard-json", namespace: "monitoring" },
        spec: {
          data: {
            "dashboard.json":
              '{\n  "templating": {\n    "list": [\n      {\n        "name": "environment",\n        "type": "custom",\n        "options": [{"text":"production","value":"production"},{"text":"staging","value":"staging"}]\n      }\n    ]\n  },\n  "panels": [\n    {\n      "title": "Request Rate",\n      "datasource": "Prometheus - Production",\n      "targets": [{ "expr": "sum(rate(http_requests_total{env=\\"$environment\\"}[5m]))" }]\n    }\n  ]\n}',
          },
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-datasource-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "A panel's `datasource` field controls which Prometheus instance the query\nis sent to. A template variable like `$environment` only affects the\n*label matchers inside the query string* sent to whichever datasource is\nselected - it does not, on its own, redirect the query to a different\ndatasource. This dashboard has two separate Prometheus datasources\nconfigured: \"Prometheus - Production\" and \"Prometheus - Staging\", each\nonly scraping its own cluster.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap inventory-dashboard-json -n monitoring -o yaml` - the panel has both a hardcoded `datasource` field and a `$environment` variable used inside the query. What does each one actually control?",
    "`kubectl get configmap grafana-datasource-notes -n monitoring -o yaml` - does changing a template variable change which Prometheus instance gets queried?",
    "If the production Prometheus datasource has never scraped staging at all, what would a query for `env=\"staging\"` sent to it return - and would it look the same either way if the label just happens to also exist as noise or leftover data there?",
  ],
  options: [
    {
      id: "datasource-hardcoded-variable-only-filters-label",
      label:
        "The panel's `datasource` field is hardcoded to \"Prometheus - Production\" regardless of the `$environment` dropdown - switching the variable only changes the `env=\"...\"` label matcher inside the query, which still gets sent to the production Prometheus instance either way, so 'staging' and 'production' views are really just two label filters both being evaluated against the same production data source.",
      explanation:
        "`inventory-dashboard-json` shows the panel's `datasource` is a hardcoded string, `\"Prometheus - Production\"`, entirely separate from the `$environment` templating variable used only inside the query expression. `grafana-datasource-notes` confirms a template variable changes query content, not which datasource receives it. Switching the dropdown to 'staging' still sends the query to the production Prometheus instance - it just asks that instance for series labeled `env=\"staging\"`, which is why the two views look so similar: they're both hitting the same backend.",
    },
    {
      id: "staging-actually-getting-production-traffic",
      label: "A load balancer misconfiguration is accidentally routing production traffic into staging.",
      explanation:
        "There's no evidence of real traffic misrouting here - the dashboard evidence points specifically at a Grafana panel configuration issue (a hardcoded datasource field), not at anything in the actual request path between environments.",
    },
    {
      id: "staging-prometheus-scraping-production",
      label: "The staging Prometheus instance's scrape config was accidentally pointed at production targets.",
      explanation:
        "The dashboard notes confirm each Prometheus datasource only scrapes its own cluster - the mixing isn't happening at the scrape layer, it's happening because this specific panel's `datasource` field never changes even as the `$environment` variable does.",
    },
    {
      id: "env-label-missing-in-staging",
      label: "The `env` label isn't actually being set correctly by staging pods, so staging metrics get miscategorized as production.",
      explanation:
        "The Deployment's own labels correctly show `env: staging`, and there's no indication the applied metric label differs from that - the issue is which datasource the panel queries at all, not how staging's own metrics are labeled at the source.",
    },
  ],
  correctOptionId: "datasource-hardcoded-variable-only-filters-label",
  resolution: `\`inventory-dashboard-json\` shows the panel's query has two independent
moving parts that look related but aren't: a hardcoded \`datasource\` field
set to \`"Prometheus - Production"\`, and a \`$environment\` templating
variable used only inside the PromQL expression as an \`env="$environment"\`
label matcher. \`grafana-datasource-notes\` spells out the distinction - a
template variable changes what a query *asks for*, not *which backend it's
sent to*. Since this panel's \`datasource\` never changes, switching the
dropdown to "staging" still sends the query to the production Prometheus
instance, just asking it for whatever happens to carry the label
\`env="staging"\` there. That's why the "staging" view looked so close to
production's - both dropdown positions were, in effect, querying the same
data source the whole time.

The fix is making the panel's datasource itself variable-driven, so the
dropdown actually switches which Prometheus instance gets queried:

\`\`\`json
{
  "panels": [
    {
      "title": "Request Rate",
      "datasource": "\${datasource}",
      "targets": [{ "expr": "sum(rate(http_requests_total[5m]))" }]
    }
  ],
  "templating": {
    "list": [
      {
        "name": "datasource",
        "type": "datasource",
        "query": "prometheus"
      }
    ]
  }
}
\`\`\`

With a proper datasource-type template variable, the dropdown correctly
switches between the production and staging Prometheus instances instead
of silently re-filtering the same one - and whoever was reading "staging"
numbers all week can go back and check what they actually looked at.`,
};
