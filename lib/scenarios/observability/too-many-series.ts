import type { Scenario } from "../types";

export const tooManySeries: Scenario = {
  id: "too-many-series",
  title: "Too Many Series",
  subtitle: "Prometheus itself goes down in the middle of an actual incident",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "cardinality", "metrics"],
  briefing: `While the team was already investigating elevated latency on "search-api",
someone went to pull up Grafana for more detail and found Prometheus
itself unresponsive - queries time out, and the Prometheus pod is
restarting every few minutes. Whatever was going on with search-api, the
team was now flying blind on top of it.`,
  constraints: [
    "Prometheus's persistent volume has plenty of free space - this isn't a disk problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "prometheus-server", namespace: "monitoring", labels: { app: "prometheus-server" } },
        spec: {
          replicas: 1,
          template: {
            spec: {
              containers: [
                {
                  name: "prometheus",
                  image: "prom/prometheus:v3.1.0",
                  resources: { requests: { memory: "2Gi" }, limits: { memory: "4Gi" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 1, availableReplicas: 0 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "prometheus-server-7f8g9h0i1-k2l3m", namespace: "monitoring", labels: { app: "prometheus-server" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "prometheus",
              ready: false,
              restartCount: 11,
              state: { waiting: { reason: "CrashLoopBackOff" } },
              lastState: {
                terminated: {
                  reason: "OOMKilled",
                  exitCode: 137,
                  startedAt: "2026-09-15T14:02:00Z",
                  finishedAt: "2026-09-15T14:06:41Z",
                },
              },
            },
          ],
        },
        events: [
          { type: "Warning", reason: "BackOff", age: "1m", message: "Back-off restarting failed container prometheus in pod prometheus-server-7f8g9h0i1-k2l3m_monitoring" },
        ],
        logs: {
          prometheus: [
            "ts=2026-09-15T14:02:03.114Z level=info msg=\"Starting Prometheus Server\" version=\"(version=3.1.0)\"",
            "ts=2026-09-15T14:02:04.980Z level=info msg=\"TSDB started\"",
            "ts=2026-09-15T14:02:05.201Z level=info msg=\"Loading configuration file\" filename=/etc/prometheus/prometheus.yml",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-api-metrics-notes", namespace: "search" },
        spec: {
          data: {
            "SearchMetrics.java.excerpt":
              "public void recordSearch(HttpServletRequest request, String userId) {\n    searchCounter.labels(\n        request.getParameter(\"q\"),   // raw, free-text search query\n        userId                        // one label value per user\n    ).increment();\n}\n\n// registered as:\n// Counter searchCounter = Counter.build()\n//     .name(\"search_requests_total\")\n//     .labelNames(\"query\", \"user_id\")\n//     .register();\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get pod prometheus-server-7f8g9h0i1-k2l3m -n monitoring -o yaml` - `lastState.terminated.reason` is `OOMKilled`, and it keeps happening (`restartCount: 11`). Prometheus's own logs never get far past startup each time.",
    "`kubectl get configmap search-api-metrics-notes -n search -o yaml` - look at what values get used as Prometheus *label* values on `search_requests_total`, not just what the metric measures.",
    "Every distinct combination of label values on a metric is its own separately-stored time series in Prometheus's memory. A label whose value is unbounded - free text, a user ID, a request ID - means an unbounded number of series.",
  ],
  options: [
    {
      id: "unbounded-label-cardinality",
      label:
        "search-api tags its `search_requests_total` counter with the raw search query text and the user's ID - every unique query/user combination creates a brand-new time series, and that unbounded cardinality is what's blowing up Prometheus's in-memory TSDB until it gets OOMKilled and crash-loops.",
      explanation:
        "`search-api-metrics-notes` shows `search_requests_total` labeled with `request.getParameter(\"q\")` (free-text search input) and `userId` - two label dimensions with effectively unlimited distinct values. Prometheus keeps every unique label combination as its own series in memory; with real search traffic that's an unbounded, ever-growing number of series, which is exactly the kind of memory growth that produces a repeating `OOMKilled` crash loop like the one on `prometheus-server`, independent of how much disk is available.",
    },
    {
      id: "retention-too-long",
      label: "Prometheus's retention period is set too long, so it's holding too much historical data in memory.",
      explanation:
        "Retention mostly affects how much data sits on disk and how expensive long-range queries are - it doesn't explain a fast, repeating OOM kill like this. The evidence points at an ever-growing number of *distinct series* being written right now, which bloats memory regardless of how long old data is kept.",
    },
    {
      id: "search-api-scraping-too-fast",
      label: "search-api is sending metrics to Prometheus too frequently, overwhelming it.",
      explanation:
        "Prometheus pulls metrics on its own schedule via scrape configs - a target can't unilaterally \"send too fast.\" The problem here is the number of distinct time series being stored per scrape, not how often scrapes happen.",
    },
    {
      id: "raise-memory-limit",
      label: "The Prometheus pod's memory limit is simply too low and needs to be raised.",
      explanation:
        "Raising the limit buys a little time before the next crash, but with search queries and user IDs as label values, the series count keeps growing without bound - it will eventually exhaust any limit set. The real fix is to stop storing unbounded values as label values in the first place.",
    },
  ],
  correctOptionId: "unbounded-label-cardinality",
  resolution: `\`prometheus-server\`'s pod keeps hitting \`OOMKilled\` (exit code 137) and
crash-looping - its own logs barely get past loading the config file each
time before it dies, which is consistent with memory pressure during TSDB
startup/ingestion rather than a config or disk issue (and the persistent
volume has plenty of free space, ruling that out).

\`search-api-metrics-notes\` shows the actual cause: \`search_requests_total\`
is labeled with the raw search query text and the requesting user's ID.
Prometheus stores one independent time series per unique combination of
label values - with a free-text query and a user ID as labels, that's
effectively an unbounded number of series, growing with every distinct
search anyone runs. This is one of the most common ways to accidentally
take down a Prometheus instance: an innocuous-looking \`.labels(...)\` call
with the wrong kind of value turns one metric into millions of them.

The fix is to stop putting unbounded values in labels - keep metrics to a
small, fixed set of label values, and use logs or traces (which are built
for high-cardinality, per-request detail) for anything that needs to be
sliced by query text or user:

\`\`\`java
// before: unbounded cardinality
searchCounter.labels(request.getParameter("q"), userId).increment();

// after: fixed, low-cardinality labels only
searchCounter.labels(statusOf(response)).increment();
\`\`\`

Each observability pillar has a job: metrics are for aggregate trends over
a small label space, logs and traces are for per-request detail. Once
\`search_requests_total\` goes back to a bounded label set, Prometheus's
memory usage stabilizes and stays up through the next real incident
instead of becoming one.`,
};
