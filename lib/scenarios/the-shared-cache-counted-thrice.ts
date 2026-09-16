import type { Scenario } from "./types";

export const theSharedCacheCountedThrice: Scenario = {
  id: "the-shared-cache-counted-thrice",
  title: "The Shared Cache Counted Thrice",
  subtitle: "the platform capacity dashboard says the shared Redis cluster is handling triple the ops it can possibly handle",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["grafana", "redis", "metrics"],
  briefing: `The "shared-cache-ops" panel on the platform capacity dashboard shows
Redis operations per second roughly triple what the cluster's own
internal \`INFO\` stats and CloudWatch-equivalent metrics report for the
same window. Nobody's panicking yet, but capacity planning based on this
dashboard would massively overprovision, and the discrepancy has to be
explained before anyone trusts it for anything.`,
  constraints: [
    "The Redis cluster's own native stats (queried directly) are confirmed accurate and agree with the infrastructure team's independent monitoring.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-api", namespace: "inventory", labels: { app: "inventory-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-api", namespace: "search", labels: { app: "search-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "redis-exporter-topology-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "The shared Redis cluster is polled by three separate `redis_exporter`\nsidecars - one deployed alongside checkout-api, one alongside\ninventory-api, one alongside search-api - each configured (independently,\nby three different teams, none aware the others had done the same) to\npoint at the same shared Redis cluster's connection endpoint to expose\ncluster-wide stats for their own team's convenience. Each exporter\nreports the exact same cluster-wide `redis_commands_processed_total`\ncounter under its own scrape job. The `shared-cache-ops` panel's query is\n`sum(rate(redis_commands_processed_total[5m]))` with no `job` or\n`exporter` filter, so it sums across all three exporters' identical\nreadings of the same underlying counter.\n",
          },
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shared-cache-dashboard-query", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "shared-cache-ops",\n  "targets": [{ "expr": "sum(rate(redis_commands_processed_total[5m]))" }]\n}',
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap redis-exporter-topology-notes -n monitoring -o yaml` - how many separate `redis_exporter` instances are pointed at this one shared Redis cluster, and what do they each report?",
    "`kubectl get configmap shared-cache-dashboard-query -n monitoring -o yaml` - does the panel's query filter to a single exporter's job, or sum across everything matching the metric name?",
    "If three independently-deployed exporters are all polling the exact same cluster and reporting the exact same cluster-wide counter under three different job labels, what happens when a query sums across all of them with no `job` filter?",
  ],
  options: [
    {
      id: "three-exporters-summed-together",
      label:
        "Three separate `redis_exporter` sidecars - deployed independently by three different teams, none aware the others had done the same - all poll the same shared Redis cluster and each report the identical cluster-wide `redis_commands_processed_total` counter under their own job label, and the dashboard's `sum(rate(...))` query has no `job` filter, so it adds together three identical readings of the same real number, tripling it.",
      explanation:
        "`redis-exporter-topology-notes` confirms three independently-deployed exporters, each scraping the same shared cluster and exposing the same cluster-wide counter under separate job labels. `shared-cache-dashboard-query` shows the panel's query is an unfiltered `sum(rate(redis_commands_processed_total[5m]))`, which adds every matching series together regardless of which exporter it came from. Three identical copies of the same real number summed together produce exactly a 3x inflation - consistent with the cluster's own internal stats being accurate and roughly a third of what the dashboard shows.",
    },
    {
      id: "redis-cluster-actually-overloaded",
      label: "The Redis cluster is genuinely processing triple the load its own internal stats show, which are themselves wrong.",
      explanation:
        "The cluster's own native stats are confirmed accurate and independently corroborated by infrastructure's own separate monitoring - there's no reason to distrust the cluster's self-reported numbers over a dashboard whose query is shown summing multiple redundant sources together.",
    },
    {
      id: "redis-exporter-double-counting-replicas",
      label: "A single `redis_exporter` is double-counting because it's polling both a primary and a replica node separately.",
      explanation:
        "The topology notes specifically describe three separately-deployed exporter *instances* from three different teams' deployments, not one exporter polling multiple nodes of the same cluster - the redundancy is at the exporter-instance level, matching the sum-across-job-labels behavior shown in the dashboard query.",
    },
    {
      id: "rate-window-too-short",
      label: "The `[5m]` rate window is too short for this counter's actual update frequency, inflating the computed rate.",
      explanation:
        "A too-short rate window can introduce noise, but it wouldn't produce a clean, consistent roughly-3x multiplier matching exactly the number of independent exporters found pointed at the same cluster - the topology evidence directly explains the specific magnitude of the discrepancy, which a windowing issue wouldn't.",
    },
  ],
  correctOptionId: "three-exporters-summed-together",
  resolution: `\`redis-exporter-topology-notes\` uncovers the root cause: three separate
teams, independently and without coordinating, each deployed a
\`redis_exporter\` sidecar pointed at the same shared Redis cluster's
connection endpoint, purely for their own team's convenience. Each
exporter reports the exact same cluster-wide \`redis_commands_processed_total\`
counter - because it's genuinely the same cluster - just under its own
distinct \`job\` label. \`shared-cache-dashboard-query\` shows the
\`shared-cache-ops\` panel's query, \`sum(rate(redis_commands_processed_total[5m]))\`,
has no \`job\` or \`exporter\` filter at all, so it sums across every series
matching that metric name - which, with three exporters all reporting the
same real number, means the panel adds three identical copies of the
truth together and calls it one figure, inflating it roughly threefold.
The cluster's own internal stats, confirmed accurate, are simply the real
number without the duplication.

The fix is either filtering the query down to a single canonical
exporter, or (better, longer-term) consolidating to exactly one
exporter deployment owned by the team responsible for the shared Redis
cluster:

\`\`\`promql
sum(rate(redis_commands_processed_total{job="redis-exporter-platform"}[5m]))
\`\`\`

Any metric describing a genuinely *shared* piece of infrastructure -
a shared cache, a shared queue, a shared database - is a natural spot for
this kind of accidental duplication once more than one team starts
independently monitoring the same thing. It's worth periodically checking
\`count(up{job=~".*redis.*"}) by (instance)\` style queries against shared
infra to catch redundant exporters before they quietly multiply a
capacity number.`,
};
