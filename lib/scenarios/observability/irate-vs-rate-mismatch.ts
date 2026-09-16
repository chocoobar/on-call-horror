import type { Scenario } from "../types";

export const irateVsRateMismatch: Scenario = {
  id: "irate-vs-rate-mismatch",
  title: "Irate Decision",
  subtitle: "the CPU throttling graph for payments-api looks like a seismograph during a total non-event",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "promql", "cpu"],
  briefing: `Someone on the platform team pulled up the CPU throttling panel for
"payments-api" and paged the on-call because the line looks like it's
spiking wildly every few seconds. Nobody else has noticed anything wrong -
no latency complaints, no error rate change, no other panel showing
anything unusual. The graph itself is the only alarming thing in the room.`,
  constraints: [
    "payments-api's actual request latency and error rate are flat and healthy the entire time in question.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payments-api", namespace: "payments", labels: { app: "payments-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "payments-cpu-dashboard", namespace: "monitoring" },
        spec: {
          data: {
            "panel-throttling.json":
              '{\n  "title": "CPU Throttled (%)",\n  "targets": [\n    { "expr": "irate(container_cpu_cfs_throttled_periods_total{namespace=\\"payments\\"}[1m])" }\n  ]\n}',
            "panel-throttling-alt.json":
              '{\n  "title": "CPU Throttled (%) - 5m smoothed",\n  "targets": [\n    { "expr": "rate(container_cpu_cfs_throttled_periods_total{namespace=\\"payments\\"}[5m])" }\n  ]\n}',
          },
        },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-scrape-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "payments-api is scraped every 15s. `irate()` computes a rate using only\nthe *last two* samples in the given range vector - with a 15s scrape\ninterval, that's essentially instantaneous, per-15-second deltas, which\nare extremely sensitive to normal scrape-to-scrape jitter (a scrape\nlanding 200ms late, a GC pause, a brief scheduling blip). `rate()` over\nthe same range instead averages across every sample in the window,\nsmoothing that jitter out.\n",
          },
        },
        age: "9mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap payments-cpu-dashboard -n monitoring -o yaml` - compare the two panel queries side by side. Same metric, same namespace - what's different?",
    "`kubectl get configmap prometheus-scrape-notes -n monitoring -o yaml` - how many samples does `irate()` actually use, versus `rate()`, over the same time range?",
    "The panel everyone's alarmed about uses `irate()` with a 1m range on a metric scraped every 15s - that's only a couple of samples per evaluation, and `irate()` only looks at the last two of them.",
  ],
  options: [
    {
      id: "irate-jitter-sensitivity",
      label:
        "The alarming panel uses `irate()`, which computes its rate from only the last two samples in the range - on a 15s scrape interval that's extremely sensitive to ordinary scrape timing jitter, producing a spiky, misleading graph for a value that's actually low and stable, as the `rate()`-based panel of the exact same metric confirms.",
      explanation:
        "`payments-cpu-dashboard` shows the alarming panel uses `irate(...[1m])` while a second panel on the same metric uses `rate(...[5m])`. `prometheus-scrape-notes` explains why they disagree: `irate()` only uses the last two samples in its window, so on a 15s-scrape target it's essentially graphing raw sample-to-sample deltas, amplifying any timing jitter into visible-looking spikes. `rate()` averages across the whole window instead, which is why the second panel - and every other real signal (latency, errors) - shows nothing unusual.",
    },
    {
      id: "real-cpu-throttling-event",
      label: "payments-api is genuinely being CPU throttled repeatedly and needs its CPU limits raised.",
      explanation:
        "If throttling were genuinely spiking this often, it would show up as real latency degradation - which isn't happening. The 5m `rate()`-based panel on the identical metric shows nothing alarming, which is inconsistent with a real recurring throttling event and consistent with `irate()`'s known sensitivity to scrape jitter.",
    },
    {
      id: "prometheus-scrape-flapping",
      label: "Prometheus is intermittently failing to scrape payments-api, causing gaps that look like spikes.",
      explanation:
        "There's no evidence of missed scrapes or target flapping here - both panels are querying the same continuously-collected metric. The difference between the two panels is entirely explained by the PromQL function used, not by data collection reliability.",
    },
    {
      id: "container-runtime-cgroup-bug",
      label: "The container runtime's cgroup CPU accounting has a bug producing bogus throttling numbers.",
      explanation:
        "Both panels read the exact same underlying `container_cpu_cfs_throttled_periods_total` values - if the raw counter itself were bogus, both the `irate()` and `rate()` panels would be affected. Only the panel using `irate()`'s two-sample window looks wrong, which points at the query function, not the underlying metric.",
    },
  ],
  correctOptionId: "irate-jitter-sensitivity",
  resolution: `Both panels in \`payments-cpu-dashboard\` query the exact same metric,
\`container_cpu_cfs_throttled_periods_total\`, scoped to the same
namespace - the only difference is the PromQL function. The alarming
panel uses \`irate(...[1m])\`; the second, calm panel uses \`rate(...[5m])\`.
\`prometheus-scrape-notes\` spells out why that matters: \`irate()\` computes
its rate from only the *last two* samples inside the range, which on a
15-second scrape interval means it's essentially plotting raw
sample-to-sample deltas. Any normal jitter in exactly when a scrape lands
- a few hundred milliseconds here or there - gets amplified into a
visible-looking spike on the graph, even though nothing about the real
underlying throttling behavior changed at all. \`rate()\` instead averages
across every sample in its (longer) window, smoothing that jitter out,
which is exactly why the second panel and every other real signal stay
flat.

\`irate()\` is meant for fast-moving counters viewed at very short
timescales in interactive dashboards (like \`Explore\`), where you
specifically want to see the most recent instantaneous rate - it's a poor
fit for an always-on alerting-style panel on a value sampled only every
15 seconds.

The fix is switching the dashboard panel to \`rate()\` with a window that
comfortably spans several scrape intervals:

\`\`\`promql
rate(container_cpu_cfs_throttled_periods_total{namespace="payments"}[5m])
\`\`\`

Once the panel uses \`rate()\`, the graph settles down to reflect the real,
low, stable throttling rate that every other signal already agreed on -
and stops paging people over ordinary scrape jitter.`,
};
