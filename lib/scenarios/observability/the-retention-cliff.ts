import type { Scenario } from "../types";

export const theRetentionCliff: Scenario = {
  id: "the-retention-cliff",
  title: "The Retention Cliff",
  subtitle: "every capacity-planning query touching more than fifteen days of history for fleet-scheduler comes back oddly incomplete",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "retention", "storage"],
  briefing: `Quarterly capacity planning for "fleet-scheduler" needs a full 30 days of
CPU usage history, but the Prometheus query keeps coming back with data
only for roughly the most recent two weeks, tapering to nothing before
that. Nobody remembers changing anything about retention, and other
teams' 30-day capacity queries against the same Prometheus work fine.`,
  constraints: [
    "Prometheus's overall configured retention period, cluster-wide, is confirmed set to 45 days - comfortably more than the 30 days being requested.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "prometheus-k8s", namespace: "monitoring", labels: { app: "prometheus" } },
        spec: {
          replicas: 1,
          template: {
            spec: {
              containers: [
                {
                  name: "prometheus",
                  args: ["--storage.tsdb.retention.time=45d", "--storage.tsdb.retention.size=15GB"],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-storage-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "Prometheus enforces WHICHEVER retention limit is hit first: time-based\n(`retention.time`, 45d here) or size-based (`retention.size`, 15GB\nhere). fleet-scheduler's team added several new, higher-cardinality\nmetrics about 3 weeks ago as part of a new scheduling-algorithm\nexperiment, meaningfully increasing overall TSDB disk usage growth rate\ncluster-wide (this Prometheus instance is shared across many teams'\nmetrics, not just fleet-scheduler's). The 15GB size limit is now being\nhit at around 14-16 days of retained data, well before the 45-day time\nlimit would ever apply - once the size limit triggers, Prometheus deletes\nthe *oldest* blocks first to make room, regardless of how much of the\nconfigured 45-day time budget is left unused.\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get statefulset prometheus-k8s -n monitoring -o yaml` - Prometheus has both a time-based and a size-based retention flag configured here. Which one actually ends up triggering first?",
    "`kubectl get configmap prometheus-storage-notes -n monitoring -o yaml` - did anything change recently about how much disk this shared Prometheus instance is consuming, and does that connect to when the missing history started?",
    "Prometheus enforces whichever retention limit - time or size - is hit first, and deletes the oldest data to stay under the size limit regardless of how much of the time-based budget is technically still available.",
  ],
  options: [
    {
      id: "size-based-retention-limit-hit-before-time-limit",
      label:
        "Prometheus is configured with both a 45-day time-based retention and a 15GB size-based retention limit, and whichever is hit first wins - new, higher-cardinality metrics added three weeks ago by fleet-scheduler's team meaningfully increased this shared Prometheus instance's overall disk usage growth rate, causing the 15GB size limit to now be reached at around 14-16 days of data, well short of the 45-day time budget, so the oldest blocks get deleted to stay under the size cap regardless of the time limit still having plenty of room left.",
      explanation:
        "`prometheus-k8s`'s own container args confirm both `--storage.tsdb.retention.time=45d` and `--storage.tsdb.retention.size=15GB` are set. `prometheus-storage-notes` explains Prometheus enforces whichever limit is hit first, and that new higher-cardinality metrics added three weeks ago increased disk usage growth cluster-wide, pushing the size limit to now trigger around 14-16 days in - matching exactly the roughly-two-weeks-of-available-history pattern observed, and explaining why other teams' 30-day queries, presumably against metrics with lower cardinality contributing less to overall disk growth, aren't as visibly affected by the same shared size ceiling.",
    },
    {
      id: "fleet-scheduler-metrics-not-being-scraped-consistently",
      label: "fleet-scheduler's metrics are being scraped inconsistently, creating gaps that look like missing retention.",
      explanation:
        "The pattern described is a clean, consistent taper starting around two weeks back - consistent with data actually being deleted from storage after that point - rather than scattered gaps throughout, which is what inconsistent scraping would typically produce. A retention boundary is a much better fit for a hard cutoff.",
    },
    {
      id: "query-time-range-limit-in-grafana",
      label: "Grafana's datasource has a maximum query time-range limit capping results to two weeks.",
      explanation:
        "Other teams' 30-day queries against the same Prometheus datasource are confirmed to work fine, which rules out a datasource-level time-range cap - such a limit would apply uniformly to every query through that datasource, not selectively to fleet-scheduler's data.",
    },
    {
      id: "prometheus-configured-retention-recently-shortened",
      label: "Someone recently shortened Prometheus's configured time-based retention period.",
      explanation:
        "Prometheus's overall configured time-based retention is explicitly confirmed still set to 45 days, comfortably more than the 30 days needed - the time-based configuration itself hasn't changed; it's the separate, less-obvious size-based limit that's actually triggering first and deleting old data early.",
    },
  ],
  correctOptionId: "size-based-retention-limit-hit-before-time-limit",
  resolution: `\`prometheus-k8s\`'s container spec confirms two retention flags are set
simultaneously: \`--storage.tsdb.retention.time=45d\` and
\`--storage.tsdb.retention.size=15GB\`. \`prometheus-storage-notes\` explains
the interaction: Prometheus enforces whichever limit is reached first,
deleting the oldest on-disk blocks to stay under it, regardless of how
much of the *other* limit's budget remains unused. Everyone remembered
and trusted the 45-day time-based setting; nobody was watching the
15GB size-based one closely, because for most of this shared Prometheus
instance's life, the time limit was the one that would have triggered
first under normal disk growth. Three weeks ago, fleet-scheduler's team
added several new, higher-cardinality metrics for a scheduling-algorithm
experiment, meaningfully increasing this shared instance's overall disk
usage growth rate - and now the size limit is being hit at roughly 14-16
days of retained data, well before the time limit would ever come into
play, silently pruning history far short of the configured 45-day budget
that everyone assumed was governing retention.

Other teams' 30-day queries likely still mostly work because their own
metrics contribute less to the disk growth driving the size limit, and
because Prometheus deletes oldest-block-first cluster-wide rather than
per-team - fleet-scheduler's own new, larger metrics are effectively
accelerating everyone's data loss, with fleet-scheduler's own capacity
queries simply being the first to visibly notice the gap.

The fix is either raising the size limit to match the intended time
budget (if disk capacity allows), or addressing the underlying
cardinality growth directly:

\`\`\`yaml
args:
  - --storage.tsdb.retention.time=45d
  - --storage.tsdb.retention.size=60GB
\`\`\`

It's worth alerting directly on how many days of history Prometheus is
actually retaining (\`time() - process_start_time_seconds\` combined with
oldest-block metadata, or a synthetic canary query) rather than trusting
the configured time-based flag alone - a size-based limit can silently
override it the moment cardinality or scrape volume grows enough.`,
};
