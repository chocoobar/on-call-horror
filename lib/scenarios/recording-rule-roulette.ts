import type { Scenario } from "./types";

export const recordingRuleRoulette: Scenario = {
  id: "recording-rule-roulette",
  title: "Recording Rule Roulette",
  subtitle: "the capacity dashboard occasionally shows a number that makes no sense for a few minutes",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "recording-rules", "metrics"],
  briefing: `The platform capacity dashboard for "orders-cluster" is built entirely
from Prometheus recording rules chained together for efficiency. Most of
the time it's accurate. A few times a week, for exactly one evaluation
interval, it briefly shows a wildly wrong number - then goes back to
normal on its own, with nothing else in the underlying system actually
changing.`,
  constraints: [
    "The raw, underlying metrics this dashboard is ultimately built from are confirmed accurate and stable throughout - nothing about the real data is glitching.",
  ],
  world: {
    resources: [
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "orders-capacity-rules", namespace: "monitoring" },
        spec: {
          groups: [
            {
              name: "orders.capacity.raw",
              interval: "30s",
              rules: [{ record: "orders:cpu_used:sum", expr: "sum(rate(container_cpu_usage_seconds_total{namespace=\"orders\"}[5m]))" }],
            },
            {
              name: "orders.capacity.derived",
              interval: "30s",
              rules: [{ record: "orders:capacity_ratio", expr: "orders:cpu_used:sum / orders:cpu_capacity:sum" }],
            },
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "recording-rule-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "`orders.capacity.raw` and `orders.capacity.derived` are two *separate*\nrule groups, each independently evaluated every 30 seconds, in the\norder they're listed in the PrometheusRule file (Prometheus evaluates\ngroups within one rule file sequentially, one full group at a time - but\ngroups do not wait for each other's evaluation timestamp to line up).\n`orders:capacity_ratio` (in the derived group) divides by\n`orders:cpu_capacity:sum`, a recording rule that lives in a third,\nunrelated rule group (`cluster.capacity`) owned by a different team, on\nits own independent 30s evaluation cycle that isn't synchronized with\n`orders.capacity.raw`/`orders.capacity.derived`'s cycle.\n\nWhen `cluster.capacity`'s evaluation happens to land a few seconds later\nthan `orders.capacity.derived`'s in a given 30s window (relative clock\ndrift between independent evaluation cycles, which isn't perfectly\nfixed), `orders:capacity_ratio` briefly divides by whatever stale or\nnot-yet-updated value `orders:cpu_capacity:sum` last held.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get prometheusrule orders-capacity-rules -n monitoring -o yaml` - `orders:capacity_ratio` divides by a metric name that isn't defined anywhere in this same file. Where does `orders:cpu_capacity:sum` actually come from?",
    "`kubectl get configmap recording-rule-notes -n monitoring -o yaml` - are all three recording rules involved in this calculation guaranteed to evaluate at the exact same moment, every time?",
    "Two independently-scheduled rule groups, each on their own 30-second cycle, aren't necessarily evaluated in lockstep with each other - a rule in one group reading the output of a rule in a completely separate group can occasionally read a value that's a few seconds staler than it expects.",
  ],
  options: [
    {
      id: "cross-group-recording-rule-evaluation-order",
      label:
        "`orders:capacity_ratio` divides by `orders:cpu_capacity:sum`, a recording rule owned by a completely separate, independently-scheduled rule group - both are on 30-second cycles, but the two groups' evaluation timestamps aren't synchronized with each other, so occasionally the capacity value hasn't updated yet relative to the CPU-used value it's being divided against, briefly producing a ratio computed from two numbers that don't actually correspond to the same moment in time.",
      explanation:
        "`recording-rule-notes` confirms `orders:cpu_capacity:sum` lives in a third, unrelated rule group with its own independent evaluation cycle, not synchronized with the group computing `orders:capacity_ratio`. Prometheus doesn't guarantee cross-group evaluation ordering or timing alignment - each group runs on its own schedule. The underlying raw metrics are confirmed stable the whole time; what's unstable is the *relationship in time* between two independently-evaluated recording rules being divided against each other, which occasionally lines up a few seconds off and produces a nonsensical ratio for exactly one evaluation interval before both groups catch back up to a consistent state.",
    },
    {
      id: "container-cpu-metric-flaky",
      label: "The underlying `container_cpu_usage_seconds_total` metric is occasionally reported incorrectly by the kubelet.",
      explanation:
        "The raw, underlying metrics this dashboard is built from are confirmed accurate and stable throughout - the anomaly only appears in the *derived* recording rule's output, not in the raw source data feeding into it.",
    },
    {
      id: "dashboard-caching-stale-panel",
      label: "The dashboard's own panel caching briefly shows a stale value.",
      explanation:
        "The wrong value corresponds to a real, if inconsistent, computation actually stored in Prometheus for that evaluation interval (this is a recording-rule output issue), not a display-layer caching artifact on top of otherwise-correct underlying data.",
    },
    {
      id: "prometheus-storage-compaction",
      label: "Prometheus's periodic TSDB compaction is briefly interfering with query results.",
      explanation:
        "Compaction affects how already-written data is stored on disk, not the values recording rules compute during a live evaluation - and this happens predictably a few times a week rather than correlating with any compaction schedule, pointing instead at the cross-group evaluation timing already evidenced in the rule setup.",
    },
  ],
  correctOptionId: "cross-group-recording-rule-evaluation-order",
  resolution: `\`orders:capacity_ratio\` divides \`orders:cpu_used:sum\` by
\`orders:cpu_capacity:sum\` - a recording rule that doesn't live in either
group in this file at all. \`recording-rule-notes\` traces it to a third
rule group, owned by a different team, evaluated on its own independent
30-second cycle. Prometheus evaluates rule *groups* sequentially within
a file and guarantees ordering *within* a group, but it makes no
guarantee that two entirely separate groups - especially ones defined in
different files, owned by different teams - evaluate at synchronized
wall-clock moments, even if both happen to be on the same 30-second
interval. Their two schedules can drift relative to each other by a few
seconds in either direction.

Almost all of the time, that drift is too small to matter - the values
involved don't change much second to second. Occasionally, the timing
lines up such that \`orders:capacity_ratio\`'s evaluation runs just before
\`orders:cpu_capacity:sum\`'s latest value has been written for that
window, so the division briefly uses a slightly stale denominator against
a fresh numerator, producing a nonsensical ratio for exactly one
evaluation interval before both groups' next cycle brings everything back
into a consistent relationship.

The fix is putting rules with this kind of direct dependency into the
*same* rule group, where Prometheus guarantees sequential, same-timestamp
evaluation:

\`\`\`yaml
groups:
  - name: orders.capacity.combined
    interval: 30s
    rules:
      - record: orders:cpu_used:sum
        expr: sum(rate(container_cpu_usage_seconds_total{namespace="orders"}[5m]))
      - record: orders:cpu_capacity:sum
        expr: sum(kube_node_status_capacity{resource="cpu"})
      - record: orders:capacity_ratio
        expr: orders:cpu_used:sum / orders:cpu_capacity:sum
\`\`\`

Any recording rule that depends on another recording rule's output should
live in the same group as it whenever possible - cross-group dependencies
between independently-scheduled rule sets are a subtle, intermittent
source of exactly this kind of "briefly wrong for no reason" anomaly.`,
};
