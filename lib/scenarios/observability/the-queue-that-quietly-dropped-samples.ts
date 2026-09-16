import type { Scenario } from "../types";

export const theQueueThatQuietlyDroppedSamples: Scenario = {
  id: "the-queue-that-quietly-dropped-samples",
  title: "The Queue That Quietly Dropped Samples",
  subtitle: "the long-term storage dashboard has gaps that don't exist in Prometheus's own local graphs",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "remote-write", "thanos"],
  briefing: `A post-incident review for "auth-service" is going smoothly until someone
notices the Grafana dashboard - backed by long-term storage via
remote_write - has ragged, minutes-long gaps right during the most
interesting part of the incident. Pulling up the same metric directly
from Prometheus's own local storage (via its own web UI) shows a
complete, gapless graph for the exact same window.`,
  constraints: [
    "Prometheus itself never restarted or lost data locally during the incident - its own TSDB has a complete, uninterrupted record.",
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
                { name: "prometheus", args: ["--storage.remote-write.flush-deadline=1m"] },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-remote-write-metrics", namespace: "monitoring" },
        spec: {
          data: {
            "queue-stats-during-incident.md":
              "`prometheus_remote_storage_samples_dropped_total{remote_name=\"thanos-receive\"}`:\nwent from 0 to 1,840,221 during the 14-minute incident window.\n`prometheus_remote_storage_queue_highest_sent_timestamp_seconds` fell\nnoticeably behind `time()` during the same window (lag peaked around 6\nminutes). `prometheus_remote_storage_shards` was pinned at its configured\nmax (`10`) the whole time - the queue never got more shards to work with.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "remote-write-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "The remote_write queue has a bounded in-memory buffer per shard. When\nthe receiving endpoint (`thanos-receive`) can't keep up - overloaded,\nslow disk, network hiccup - and the queue's retry/backoff can't drain\nfast enough, samples older than the configured retention window inside\nthe queue get dropped rather than blocking Prometheus's own local\nwrites. `thanos-receive` was independently confirmed to be under heavy\nload from an unrelated bulk backfill job during this exact incident\nwindow.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap prometheus-remote-write-metrics -n monitoring -o yaml` - what does `prometheus_remote_storage_samples_dropped_total` do during the incident window, and what's happening to the queue's shards and send lag at the same time?",
    "`kubectl get configmap remote-write-notes -n monitoring -o yaml` - what happens to samples in the remote_write queue when the receiving endpoint can't keep up, and does that affect Prometheus's own local storage at all?",
    "Prometheus's local TSDB and its remote_write path are two separate things - a receiving endpoint falling behind can cause the queue feeding it to drop samples, without ever touching what Prometheus keeps for itself.",
  ],
  options: [
    {
      id: "remote-write-queue-dropped-samples-under-backpressure",
      label:
        "`thanos-receive` was under heavy load from an unrelated bulk backfill job during the incident window and couldn't keep up with incoming remote_write traffic - Prometheus's remote_write queue backed up and, once its bounded in-memory buffer filled, started dropping the oldest samples rather than blocking local writes, which is exactly why long-term storage has gaps that Prometheus's own complete local TSDB doesn't.",
      explanation:
        "`prometheus-remote-write-metrics` shows `prometheus_remote_storage_samples_dropped_total` jumping by over 1.8 million samples during the 14-minute window, alongside growing send lag and shards pinned at their configured max - all signs of a queue that can't drain fast enough. `remote-write-notes` explains the mechanism and confirms `thanos-receive` was independently under heavy unrelated load at that exact time. Local Prometheus storage and the remote_write path are decoupled by design - exactly why the local TSDB stayed complete while long-term storage gained gaps.",
    },
    {
      id: "prometheus-crashed-during-incident",
      label: "Prometheus itself crashed and restarted partway through the incident, losing a chunk of data.",
      explanation:
        "This is explicitly ruled out - Prometheus's own local TSDB has a complete, uninterrupted record for the exact window in question, which wouldn't be true if the process had crashed and restarted mid-incident.",
    },
    {
      id: "grafana-dashboard-rendering-glitch",
      label: "The gaps are a Grafana rendering artifact, not missing data.",
      explanation:
        "`prometheus_remote_storage_samples_dropped_total` shows real, substantial sample loss recorded on the remote_write queue itself during that exact window - the data genuinely never arrived at long-term storage, it isn't merely a display issue on top of complete underlying data.",
    },
    {
      id: "network-partition-between-clusters",
      label: "A full network partition between the Prometheus cluster and the Thanos cluster caused total data loss for the window.",
      explanation:
        "A full partition would typically show as zero samples sent rather than a large-but-partial drop count alongside growing (not infinite) send lag - the queue metrics point at overload-driven backpressure and selective dropping of older samples, not a complete connectivity outage.",
    },
  ],
  correctOptionId: "remote-write-queue-dropped-samples-under-backpressure",
  resolution: `\`prometheus-remote-write-metrics\` shows the fingerprint of remote_write
backpressure directly: \`prometheus_remote_storage_samples_dropped_total\`
for \`thanos-receive\` jumped by over 1.8 million during the 14-minute
incident window, \`prometheus_remote_storage_queue_highest_sent_timestamp_seconds\`
fell increasingly behind real time (peaking around 6 minutes of lag), and
the queue's shard count sat pinned at its configured maximum the whole
time - it had no more capacity to throw at the backlog. \`remote-write-notes\`
explains the mechanism: the remote_write queue's in-memory buffer is
bounded, and when the receiving endpoint can't keep up, samples older than
the queue's retention window get dropped rather than blocking Prometheus's
own local writes. \`thanos-receive\` was independently confirmed to be under
heavy load from an unrelated bulk backfill job during this exact window.

This is remote_write behaving exactly as designed under overload - it
protects Prometheus's own local ingestion and query path at the cost of
the remote copy, rather than letting a slow downstream receiver back
pressure and potentially destabilize the source Prometheus itself. That's
precisely why the local TSDB stayed complete while the long-term-storage
dashboard picked up gaps.

There's no instant fix for the receiving side's capacity from here, but
mitigations include giving the queue more headroom and shards, and
alerting directly on the drop metric so backpressure like this is visible
during the incident instead of discovered afterward in a post-mortem:

\`\`\`yaml
remote_write:
  - url: http://thanos-receive:19291/api/v1/receive
    queue_config:
      max_shards: 30
      capacity: 10000
\`\`\`

\`\`\`promql
increase(prometheus_remote_storage_samples_dropped_total[5m]) > 0
\`\`\`

Whenever long-term storage disagrees with Prometheus's own local graphs,
the queue metrics - shards, send lag, and the drop counter specifically -
are the first place to look, since the two storage paths can silently
diverge without either side technically failing.`,
};
