import type { Scenario } from "./types";

export const theHardcodedJobLabel: Scenario = {
  id: "the-hardcoded-job-label",
  title: "The Hardcoded Job Label",
  subtitle: "the migrated cluster is up and healthy, but every dashboard for it still says \"No data\"",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["grafana", "prometheus", "migration"],
  briefing: `"inventory-sync" was migrated last week from the old "cluster-a" to the
new "cluster-b" as part of a planned cluster decommission, and everyone
confirmed the migration went smoothly - pods healthy, traffic flowing.
Its Grafana dashboard has shown "No data" on every panel since the
migration completed, even though Prometheus in cluster-b is confirmed
actively scraping and storing its metrics.`,
  constraints: [
    "Querying Prometheus directly (outside Grafana) for `inventory_sync_requests_total` in cluster-b returns real, current data.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-sync", namespace: "inventory", labels: { app: "inventory-sync", cluster: "cluster-b" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inventory-sync-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Inventory Sync Requests",\n  "targets": [{ "expr": "sum(rate(inventory_sync_requests_total{job=\\"inventory-sync-cluster-a\\"}[5m]))" }]\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cluster-migration-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "cluster-a's Prometheus scrape job for inventory-sync was named\n`inventory-sync-cluster-a` (a cluster-specific job name, a legacy\nnaming convention from before federated multi-cluster labeling was\nstandardized). cluster-b's equivalent scrape job is named\n`inventory-sync-cluster-b`, following the same legacy convention on the\nnew cluster. The dashboard panel's query still hardcodes\n`job=\"inventory-sync-cluster-a\"` - nobody updated it as part of the\nmigration checklist, which focused on the application and infrastructure\nside and didn't include a dashboard audit.\n",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap inventory-sync-dashboard-panel -n monitoring -o yaml` - what exact `job` label does this panel's query filter on?",
    "`kubectl get configmap cluster-migration-notes -n monitoring -o yaml` - does the Prometheus scrape job name for inventory-sync in cluster-b match what the dashboard is querying for?",
    "A query hardcoded to `job=\"inventory-sync-cluster-a\"` will never match series labeled `job=\"inventory-sync-cluster-b\"`, no matter how healthy or well-scraped the cluster-b deployment actually is.",
  ],
  options: [
    {
      id: "dashboard-hardcodes-old-cluster-job-name",
      label:
        "The dashboard panel's query hardcodes `job=\"inventory-sync-cluster-a\"`, the old cluster's scrape job name under a legacy per-cluster naming convention - cluster-b's equivalent scrape job is named `inventory-sync-cluster-b`, and since the migration checklist focused on application and infrastructure changes without including a dashboard audit, nobody updated the query, so it never matches any series from the new cluster despite cluster-b's Prometheus actively scraping and storing inventory-sync's metrics correctly under its own job name.",
      explanation:
        "`inventory-sync-dashboard-panel` shows the query explicitly hardcodes `job=\"inventory-sync-cluster-a\"`. `cluster-migration-notes` confirms cluster-b's equivalent job is named `inventory-sync-cluster-b` under the same legacy per-cluster naming convention, and that the migration checklist didn't include a dashboard audit. Since a direct Prometheus query for `inventory_sync_requests_total` in cluster-b (without the stale job filter) confirms real, current data exists, the panel's hardcoded old job name is a sufficient and fully evidenced explanation for the 'No data' result.",
    },
    {
      id: "cluster-b-prometheus-not-federated-to-grafana",
      label: "Grafana isn't configured with a datasource pointing at cluster-b's Prometheus at all.",
      explanation:
        "If Grafana had no datasource for cluster-b's Prometheus, the panel would typically show a datasource error rather than a clean 'No data' result from a query that executes successfully - and the scenario confirms Prometheus in cluster-b is being queried and returning real data when checked directly, which requires Grafana's underlying datasource connectivity to be functional.",
    },
    {
      id: "inventory-sync-metric-name-changed-in-migration",
      label: "The metric name `inventory_sync_requests_total` changed as part of the migration.",
      explanation:
        "A direct Prometheus query for `inventory_sync_requests_total` in cluster-b, without any job filter, is confirmed to return real, current data - the metric name itself is unchanged and working; the dashboard's problem is specifically its extra `job=\"inventory-sync-cluster-a\"` filter, which excludes those results.",
    },
    {
      id: "grafana-dashboard-permissions-changed",
      label: "The dashboard's permissions changed during the migration, hiding data from the current viewer.",
      explanation:
        "A permissions issue would typically block viewing the dashboard or its panels entirely with an access error, not render a normally-displayed panel showing a clean 'No data' result from a query that executes successfully but simply matches no series under its hardcoded old job label.",
    },
  ],
  correctOptionId: "dashboard-hardcodes-old-cluster-job-name",
  resolution: `\`inventory-sync-dashboard-panel\` shows the query hardcodes
\`job="inventory-sync-cluster-a"\`. \`cluster-migration-notes\` explains this
was cluster-a's scrape job name under a legacy, per-cluster naming
convention predating standardized multi-cluster labeling - and that
cluster-b's equivalent scrape job follows the same convention under its
own name, \`inventory-sync-cluster-b\`. The migration itself, focused on
application and infrastructure changes, never included a dashboard audit
step, so nobody caught that this panel's query would need updating. A
direct query for \`inventory_sync_requests_total\` in cluster-b, without
the stale job filter, confirms the real data is there and Prometheus is
scraping it correctly - the dashboard's hardcoded old job name simply
never matches any series coming from the new cluster, producing a clean,
query-executed-successfully "No data" result that looks exactly like a
real gap rather than a stale label filter.

Any query hardcoding an infrastructure-specific identifier - a job name
tied to a specific cluster, a specific node, a specific legacy naming
convention - is a latent trap for the next migration, rename, or
infrastructure change, silently breaking with no error the moment that
identifier changes underneath it.

The fix is updating the query to the new job name, and ideally moving
toward labels that don't need updating on every future migration (a
stable \`service\` label alongside a separate, migration-prone \`cluster\`
label used only when genuinely needed for cluster-specific filtering):

\`\`\`promql
sum(rate(inventory_sync_requests_total{job="inventory-sync-cluster-b"}[5m]))
\`\`\`

Any infrastructure migration checklist is worth including an explicit
"audit dashboards and alerts referencing the old environment" step -
application and infrastructure health checks alone won't catch a
dashboard that silently stopped showing anything real.`,
};
