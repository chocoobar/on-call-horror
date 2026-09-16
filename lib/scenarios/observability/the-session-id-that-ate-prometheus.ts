import type { Scenario } from "../types";

export const theSessionIdThatAtePrometheus: Scenario = {
  id: "the-session-id-that-ate-prometheus",
  title: "The Session ID That Ate Prometheus",
  subtitle: "Prometheus's memory usage has been climbing for three days straight, with no plateau in sight",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "cardinality", "metrics"],
  briefing: `Prometheus's memory usage has been climbing steadily for three days with
no sign of leveling off - not the usual sawtooth of ingest-and-compact,
just a straight line up. Queries are getting slower by the hour, and
everyone's now nervously eyeing the memory limit, wondering what happens
when the line reaches the top.`,
  constraints: [
    "Overall request traffic across the cluster has been flat for the past three days - nothing about real load has changed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "prometheus-k8s", namespace: "monitoring", labels: { app: "prometheus" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-tsdb-status", namespace: "monitoring" },
        spec: {
          data: {
            "tsdb-status.md":
              "Head series count (from /api/v1/status/tsdb): 3 days ago ~410,000,\ntoday ~9,200,000. Top metric by series count: `websocket_active_connections`\nwith 8,760,000 series. Top label contributing to that metric's cardinality:\n`connection_id`.\n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "notifications-gateway-metrics-notes", namespace: "notifications" },
        spec: {
          data: {
            "WebsocketMetrics.go.excerpt":
              "func (h *Hub) onConnect(c *Connection) {\n    websocketActiveConnections.WithLabelValues(c.ID).Set(1)\n    // c.ID is a freshly generated UUID per websocket connection - a new\n    // value every single time a client connects, deployed three days ago\n    // as part of a per-connection debugging feature.\n}\n\nfunc (h *Hub) onDisconnect(c *Connection) {\n    websocketActiveConnections.DeleteLabelValues(c.ID)\n    // deletion frees the series from active scraping eventually, but the\n    // already-ingested time series data for it stays in Prometheus's TSDB\n    // for the rest of its retention window regardless.\n}\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap prometheus-tsdb-status -n monitoring -o yaml` - which single metric accounts for almost the entire head series growth, and which label is driving it?",
    "`kubectl get configmap notifications-gateway-metrics-notes -n notifications -o yaml` - what value does `notifications-gateway` use as a label on `websocket_active_connections`, and when did that code ship?",
    "Deleting a label value with `DeleteLabelValues` stops *future* scrapes of that series, but every sample already written for it stays on disk for the rest of the retention window - a constant stream of brand-new UUID label values means constant new series, even if old ones are eventually cleaned up from active scraping.",
  ],
  options: [
    {
      id: "per-connection-uuid-label",
      label:
        "notifications-gateway shipped a change three days ago that labels `websocket_active_connections` with a freshly generated UUID per connection - every new websocket connection creates a brand-new time series that never gets reused, and with real connection churn that's an unbounded, ever-growing number of series, exactly matching the timing and shape of Prometheus's memory growth.",
      explanation:
        "`prometheus-tsdb-status` shows `websocket_active_connections` alone accounts for 8.76 million of the roughly 8.8 million new series, driven by the `connection_id` label. `notifications-gateway-metrics-notes` shows exactly why - `c.ID`, a freshly generated UUID per connection, used directly as a Prometheus label value, shipped three days ago. Even though disconnects call `DeleteLabelValues`, every series already ingested stays in TSDB for the retention window, and a constant stream of new UUIDs from ongoing connection churn means constant new series creation, which explains sustained growth with flat real traffic.",
    },
    {
      id: "retention-period-misconfigured",
      label: "Prometheus's retention period was recently extended, causing it to hold much more historical data.",
      explanation:
        "A longer retention period would increase disk usage gradually and predictably in line with ingest rate, not cause the specific, massive series-count explosion on one metric shown in `prometheus-tsdb-status` - and there's no evidence retention configuration changed at all.",
    },
    {
      id: "flat-traffic-rules-out-cardinality",
      label: "Since overall traffic is flat, this must be a memory leak in Prometheus itself, unrelated to the data it's ingesting.",
      explanation:
        "Flat *request* traffic doesn't mean flat *connection churn* - websocket connections can open and close constantly without changing the steady-state request rate elsewhere. `prometheus-tsdb-status` shows the series count is genuinely exploding on one specific metric, which is a data-driven cause, not evidence of a bug in Prometheus itself.",
    },
    {
      id: "scrape-interval-too-frequent",
      label: "notifications-gateway's scrape interval was set too low, causing excessive sample ingestion.",
      explanation:
        "A too-frequent scrape interval increases the *number of samples per series* over time, not the *number of distinct series* - the explosion here is specifically in head series count driven by a high-cardinality label, which scrape frequency doesn't create on its own.",
    },
  ],
  correctOptionId: "per-connection-uuid-label",
  resolution: `\`prometheus-tsdb-status\` narrows the problem down fast: head series count
grew roughly 22x in three days, and essentially all of that growth is one
metric, \`websocket_active_connections\`, driven by its \`connection_id\`
label. \`notifications-gateway-metrics-notes\` shows the change that shipped
exactly three days ago: each new websocket connection gets a freshly
generated UUID (\`c.ID\`) used directly as a Prometheus label value. Every
single connection - and with real traffic, there's a constant stream of
them opening and closing - creates a brand-new, never-reused time series.

The \`DeleteLabelValues\` call on disconnect helps *future* scrapes stop
reporting a now-closed connection's series, but it doesn't retroactively
remove data already written to TSDB - every series that ever existed
stays on disk for the rest of the retention window. With flat overall
traffic but ongoing connection churn, new UUID-labeled series keep getting
created at a steady rate, which is exactly the sustained, plateau-free
growth curve seen in Prometheus's memory usage.

The fix is removing the unbounded UUID from the label set entirely - a
per-connection identifier belongs in logs or traces, not as a Prometheus
label:

\`\`\`go
// before: one series per connection, forever
websocketActiveConnections.WithLabelValues(c.ID).Set(1)

// after: a single gauge, no unbounded label
websocketActiveConnections.Inc()
// ...and Dec() on disconnect
\`\`\`

If per-connection debugging detail is still needed, it belongs in a log
line or span attribute tied to the connection, not baked into a metric's
label set. Once the UUID label is gone, new series creation stops, and
Prometheus's head series count - and memory usage - settles back down
once the existing high-cardinality series age out of the retention
window.`,
};
