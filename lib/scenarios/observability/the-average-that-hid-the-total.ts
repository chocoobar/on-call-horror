import type { Scenario } from "../types";

export const theAverageThatHidTheTotal: Scenario = {
  id: "the-average-that-hid-the-total",
  title: "The Average That Hid The Total",
  subtitle: "the queue-depth dashboard for job-runner looks calm even while the actual backlog visibly balloons",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["grafana", "promql", "aggregation"],
  briefing: `Customers are seeing background jobs on "job-runner" take much longer to
process than usual, and the queue backend's own admin UI confirms a
genuinely large, growing backlog. The "Queue Depth" panel on job-runner's
Grafana dashboard, built from the same underlying per-worker metric,
looks completely unremarkable - flat, low, well within normal range.`,
  constraints: [
    "The queue backend's own admin UI, an independent source, confirms the real total backlog is large and actively growing during this window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "job-runner", namespace: "jobs", labels: { app: "job-runner" } },
        spec: { replicas: 20 },
        status: { readyReplicas: 20, updatedReplicas: 20, availableReplicas: 20 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "job-runner-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Queue Depth",\n  "targets": [{ "expr": "avg(job_runner_queue_depth)" }]\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "queue-depth-metric-notes", namespace: "jobs" },
        spec: {
          data: {
            "notes.md":
              "Each of job-runner's 20 replicas exports `job_runner_queue_depth` as its\nown *locally observed* view of pending items assigned to it specifically\n(the queue is sharded per-worker, not one shared global counter). The\nreal, current backlog is heavily concentrated on a small handful of\nreplicas whose shards happen to be processing an unusually slow batch of\njobs, while the other replicas' shards are nearly empty as normal. The\ndashboard's `avg()` aggregation spreads that concentrated backlog across\nall 20 replicas' values, diluting a genuinely large number on a few\nworkers into an unremarkable-looking average across all of them.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap job-runner-dashboard-panel -n monitoring -o yaml` - is the panel summing queue depth across all workers, or averaging it?",
    "`kubectl get configmap queue-depth-metric-notes -n jobs -o yaml` - is the real backlog evenly spread across every worker, or concentrated on just a few?",
    "Averaging a metric across many workers, when the real problem is concentrated on a small handful of them, mathematically dilutes a genuinely large number down to something unremarkable - a `sum()` wouldn't have that blind spot.",
  ],
  options: [
    {
      id: "avg-dilutes-concentrated-backlog-across-many-workers",
      label:
        "job-runner's queue is sharded per-worker, and the real backlog is heavily concentrated on a small handful of the 20 replicas while the rest sit nearly empty as normal - the dashboard panel uses `avg(job_runner_queue_depth)`, which spreads that concentrated backlog across all 20 workers' values, mathematically diluting a genuinely large number on a few workers into an unremarkable-looking average, even though the real, total backlog (which the queue backend's own admin UI confirms) is large and actively growing.",
      explanation:
        "`job-runner-dashboard-panel` confirms the query is `avg(job_runner_queue_depth)`. `queue-depth-metric-notes` explains the queue is sharded per-worker and the real backlog is concentrated on a small number of replicas rather than spread evenly - exactly the condition under which averaging across all 20 workers dilutes a real, large, concerning number down to something that looks calm, fully explaining the mismatch against the queue backend's own admin UI, which reports the real, undiluted total.",
    },
    {
      id: "job-runner-queue-depth-metric-broken",
      label: "The `job_runner_queue_depth` metric itself is broken or not updating correctly.",
      explanation:
        "There's no indication the underlying metric is broken - each worker's own reported value is presumably accurate for its own shard; the issue is specifically how those individually-accurate per-worker values get aggregated together into one misleading dashboard number via `avg()`.",
    },
    {
      id: "queue-backend-admin-ui-inaccurate",
      label: "The queue backend's admin UI is overstating the real backlog.",
      explanation:
        "The queue backend's own admin UI is an independent, direct source of truth for the real total backlog and is presented as confirmed accurate - there's no reason to doubt it here; the dashboard built from Prometheus is the one producing a misleading, diluted picture via its choice of aggregation function.",
    },
    {
      id: "job-runner-scaling-event-resetting-metrics",
      label: "A recent scaling event reset job-runner's queue depth metrics across all replicas.",
      explanation:
        "job-runner's replica count is confirmed stable at 20, with no indication of a recent scaling event or metric reset - the mismatch is fully and directly explained by how an average aggregation dilutes a backlog concentrated on a few workers, without needing to assume any additional scaling-related disruption.",
    },
  ],
  correctOptionId: "avg-dilutes-concentrated-backlog-across-many-workers",
  resolution: `\`job-runner-dashboard-panel\` shows the "Queue Depth" panel queries
\`avg(job_runner_queue_depth)\` - averaging each of job-runner's 20
replicas' individually reported queue depth into one number.
\`queue-depth-metric-notes\` explains why that number looks calm while the
real backlog is anything but: the queue is sharded per-worker, and the
current backlog is heavily concentrated on just a small handful of
replicas whose shards happen to be stuck on an unusually slow batch of
jobs, while the rest sit nearly empty, exactly as normal. Averaging
across all 20 workers takes that concentrated, genuinely large number on
a few of them and spreads it thin across the whole fleet - mathematically
diluting it into something that looks unremarkable, even though nothing
about the real, total backlog got any smaller. The queue backend's own
admin UI, seeing the real total rather than a per-worker average, reports
exactly what's actually happening: a large and growing backlog.

Averaging is the right aggregation when a value is meant to be roughly
uniform across replicas (like memory usage per pod, say) - it's the wrong
one whenever the underlying quantity is meant to be summed, like a queue
depth or a request count, especially when it can legitimately be
unevenly distributed across workers.

The fix is switching the panel to \`sum()\`, which reflects the real total
regardless of how unevenly it's distributed across replicas:

\`\`\`promql
sum(job_runner_queue_depth)
\`\`\`

It's worth keeping the per-worker view available too (as a heatmap or a
"top N workers by queue depth" panel) alongside the fleet-wide sum -
\`sum()\` fixes the "hidden total" problem, but a concentrated backlog on a
handful of workers is itself worth being able to see directly, not just
inferred from a suspiciously uneven-looking total.`,
};
