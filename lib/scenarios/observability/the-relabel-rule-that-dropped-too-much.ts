import type { Scenario } from "../types";

export const theRelabelRuleThatDroppedTooMuch: Scenario = {
  id: "the-relabel-rule-that-dropped-too-much",
  title: "The Relabel Rule That Dropped Too Much",
  subtitle: "warehouse-sync's error metrics vanished from Prometheus the same day someone \"cleaned up\" noisy series",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "relabeling", "metrics"],
  briefing: `Three days ago, someone added a \`metric_relabel_configs\` drop rule to
Prometheus's scrape config to cut down on a flood of noisy debug metrics
from various services. Since then, "warehouse-sync"'s error-count metric -
a completely unrelated, legitimate, low-cardinality metric the on-call
team relies on - has been silently missing from Prometheus. The service
itself is confirmed to still be exporting it correctly.`,
  constraints: [
    "warehouse-sync's `/metrics` endpoint, checked directly, still exposes `warehouse_sync_errors_total` exactly as before.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "warehouse-sync", namespace: "warehouse", labels: { app: "warehouse-sync" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-scrape-config", namespace: "monitoring" },
        spec: {
          data: {
            "prometheus.yml":
              "scrape_configs:\n  - job_name: kubernetes-pods\n    metric_relabel_configs:\n      - source_labels: [__name__]\n        regex: '.*_debug_.*|.*_sync_.*'\n        action: drop\n        # NOTE: added 3 days ago to cut down on noisy debug metrics like\n        # `payments_debug_trace_count` and `cache_sync_internal_debug`.\n        # The regex '.*_sync_.*' was intended to catch only debug metrics\n        # with \"sync\" in the name from a couple of specific services, but\n        # as written it matches ANY metric name containing \"_sync_\"\n        # anywhere in it, cluster-wide.\n",
          },
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "relabel-rule-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "`warehouse_sync_errors_total` matches the regex `.*_sync_.*` because it\ncontains the substring `_sync_` - even though it has nothing to do with\nthe noisy debug metrics the rule was written to target. `metric_relabel_configs`\nwith `action: drop` applies *before* the metric is stored, cluster-wide,\nto every job sharing this scrape config - it doesn't distinguish which\nservice or purpose a metric name belongs to, only whether the regex\nmatches.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap prometheus-scrape-config -n monitoring -o yaml` - what's the exact regex on the drop rule added three days ago, and what was it actually meant to target?",
    "`kubectl get configmap relabel-rule-notes -n monitoring -o yaml` - does `warehouse_sync_errors_total` match that regex, even though it isn't a debug metric?",
    "A `drop` action based on a regex against `__name__` doesn't know or care about intent - it matches whatever metric names happen to satisfy the pattern, cluster-wide, regardless of which service emits them or why.",
  ],
  options: [
    {
      id: "overbroad-regex-drops-unrelated-metric",
      label:
        "A `metric_relabel_configs` drop rule added three days ago to cut noisy debug metrics uses the regex `.*_sync_.*`, intended to target a couple of specific debug metrics but broad enough to also match `warehouse_sync_errors_total` purely because it contains the substring `_sync_` - so Prometheus has been silently dropping this legitimate, unrelated metric at scrape time ever since, even though warehouse-sync itself is still exporting it correctly.",
      explanation:
        "`prometheus-scrape-config` shows the exact drop rule added three days ago, with its own comment acknowledging the regex is broader than intended. `relabel-rule-notes` confirms `warehouse_sync_errors_total` matches `.*_sync_.*` purely by substring, despite having nothing to do with the noisy debug metrics the rule targets. `metric_relabel_configs` drops happen before storage and apply cluster-wide with no awareness of intent - only whether the pattern matches, which explains why a completely unrelated, legitimate metric vanished from Prometheus the same day the rule was added, while remaining correctly exported by the service itself.",
    },
    {
      id: "warehouse-sync-stopped-emitting-metric",
      label: "warehouse-sync itself stopped emitting `warehouse_sync_errors_total` around the same time, coincidentally.",
      explanation:
        "warehouse-sync's own `/metrics` endpoint is confirmed, checked directly, to still expose `warehouse_sync_errors_total` exactly as before - the metric is being emitted correctly at the source. The problem is specifically that Prometheus never stores it after scraping, not that it was never produced.",
    },
    {
      id: "prometheus-storage-issue",
      label: "Prometheus is experiencing a storage or ingestion issue causing intermittent metric loss.",
      explanation:
        "This isn't intermittent or storage-related - the metric has been consistently, completely absent since exactly the day the drop rule was added, and every other metric continues to be stored normally, which points at a deliberate (if overbroad) filtering rule rather than a general ingestion problem.",
    },
    {
      id: "servicemonitor-selector-changed",
      label: "warehouse-sync's ServiceMonitor selector was accidentally changed, causing it to stop being scraped.",
      explanation:
        "If the ServiceMonitor's selector had broken, warehouse-sync would be entirely unscraped and every one of its metrics - not selectively just this one - would be missing from Prometheus. Only `warehouse_sync_errors_total` specifically is gone, consistent with a metric-name-targeted drop rule rather than a scrape-target-level failure.",
    },
  ],
  correctOptionId: "overbroad-regex-drops-unrelated-metric",
  resolution: `\`prometheus-scrape-config\` shows exactly when and why this started: a
\`metric_relabel_configs\` rule with \`action: drop\` was added three days
ago - matching precisely when \`warehouse_sync_errors_total\` disappeared -
targeting noisy debug metrics via the regex \`.*_sync_.*\`. \`relabel-rule-notes\`
confirms the problem directly: that regex matches any metric name
containing the substring \`_sync_\` anywhere in it, which catches
\`warehouse_sync_errors_total\` just as readily as the debug metrics it was
actually meant to filter, purely because both happen to share that
substring. \`metric_relabel_configs\` with \`action: drop\` runs before
storage and applies cluster-wide to every job under this scrape config -
it has no concept of which service a metric belongs to or what it's
actually measuring, only whether the name matches the pattern.
warehouse-sync's own \`/metrics\` endpoint was never affected; Prometheus
simply throws the sample away immediately after scraping it.

The fix is tightening the regex to match only the specific debug metric
names it was meant to target, rather than any name containing a common
substring:

\`\`\`yaml
metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'payments_debug_trace_count|cache_sync_internal_debug'
    action: drop
\`\`\`

Any \`drop\` (or \`keep\`) rule based on a regex against \`__name__\` is worth
double-checking against the *entire* set of currently-scraped metric
names before shipping it, specifically for accidental substring matches -
a broad pattern meant to catch a couple of noisy metrics can just as
easily catch a completely unrelated, load-bearing one, with no error or
warning to flag the collision.`,
};
