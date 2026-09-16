import type { Scenario } from "../types";

export const theIncreaseThatOvercounted: Scenario = {
  id: "the-increase-that-overcounted",
  title: "The Increase That Overcounted",
  subtitle: "the daily total-signups counter for onboarding-api is consistently a little higher than the database's own count",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "promql", "increase"],
  briefing: `Someone cross-checking "onboarding-api"'s daily signups dashboard against
the actual database row count for new accounts finds a small but
consistent discrepancy - the dashboard is always a bit higher, by
roughly 1-3%, every single day, never lower. Nothing about the
application logic suggests it would ever double-count a signup.`,
  constraints: [
    "The database's own row count is confirmed to be the accurate ground truth - every signup creates exactly one row, verified by the application's own transactional guarantees.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "onboarding-api", namespace: "onboarding", labels: { app: "onboarding-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "onboarding-signups-dashboard-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Daily Signups",\n  "targets": [{ "expr": "sum(increase(onboarding_signups_total[24h]))" }]\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "increase-extrapolation-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "`increase()` doesn't simply subtract the first sample in the range from\nthe last - it *extrapolates* slightly beyond the observed samples to\nestimate the true increase across the full requested duration, to\ncompensate for the range boundary not landing exactly on a scrape\ntimestamp. This extrapolation assumes a roughly constant rate throughout\nthe window and can slightly overestimate (or underestimate) the true\nvalue, especially for a counter that increases in occasional bursts\nrather than smoothly (which onboarding_signups_total does - signups\ncluster during business hours). Additionally, deploys roughly twice a\nweek cause brief counter resets (new pods starting at 0) mid-window,\nwhich `increase()` handles by detecting the reset and adding an estimate\nof the pre-reset counter's likely final value back in - itself only an\napproximation, and one more small source of overcounting on deploy days.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap onboarding-signups-dashboard-panel -n monitoring -o yaml` - is the panel using `increase()`? What does that function actually do at the edges of its time range?",
    "`kubectl get configmap increase-extrapolation-notes -n monitoring -o yaml` - does `increase()` compute an exact value from real samples, or does it extrapolate?",
    "A metric that increases in bursts (business-hours signups) rather than smoothly, combined with an extrapolating function and occasional deploy-triggered counter resets, is a recipe for small, consistent overestimation rather than an exact count.",
  ],
  options: [
    {
      id: "increase-extrapolation-plus-reset-handling-overestimates",
      label:
        "The dashboard computes daily signups with `sum(increase(onboarding_signups_total[24h]))`, and `increase()` doesn't simply subtract exact sample values - it extrapolates slightly to estimate the true increase across the full requested window and estimates a reset counter's pre-reset value on deploys, both of which are approximations that tend to slightly overestimate a bursty (rather than smoothly increasing) counter like signups, explaining the small, consistent, never-negative discrepancy against the database's exact row count.",
      explanation:
        "`onboarding-signups-dashboard-panel` confirms the panel uses `sum(increase(onboarding_signups_total[24h]))`. `increase-extrapolation-notes` explains `increase()`'s extrapolation behavior and its approximate handling of counter resets during deploys, both of which tend to overestimate for a bursty (business-hours-clustered) counter rather than producing an exact value - fully consistent with a small, always-positive discrepancy against the database's exact, transactionally-guaranteed row count, rather than a large or randomly-signed one.",
    },
    {
      id: "database-undercounting-signups",
      label: "The database's own row count is undercounting real signups due to a transaction rollback edge case.",
      explanation:
        "The database's row count is explicitly confirmed to be accurate ground truth, backed by the application's own transactional guarantees ensuring exactly one row per signup - there's no reason to doubt this side of the comparison; the dashboard's `increase()`-based estimate is the one with a known, evidenced source of approximation.",
    },
    {
      id: "onboarding-api-double-incrementing-metric",
      label: "onboarding-api's code sometimes increments `onboarding_signups_total` twice for a single signup.",
      explanation:
        "There's no evidence in the application logic of a double-increment bug, and a code-level double-count would typically produce a larger, more erratic discrepancy rather than a small, consistent 1-3% - the evidenced, directly-applicable explanation is `increase()`'s own known extrapolation behavior on a bursty counter.",
    },
    {
      id: "prometheus-scraping-duplicate-samples",
      label: "Prometheus is somehow recording duplicate samples for the same scrape.",
      explanation:
        "There's no indication of duplicate sample ingestion here - a duplicate-sample issue would typically show up more broadly across many metrics and queries, not as a small, specific, and precisely-timed discrepancy consistent with a well-documented property of the `increase()` function applied to a bursty counter.",
    },
  ],
  correctOptionId: "increase-extrapolation-plus-reset-handling-overestimates",
  resolution: `\`onboarding-signups-dashboard-panel\` confirms the dashboard computes daily
signups as \`sum(increase(onboarding_signups_total[24h]))\`.
\`increase-extrapolation-notes\` explains a property of \`increase()\` that's
easy to overlook: it doesn't just subtract the first observed sample from
the last within the window - it extrapolates slightly beyond the actually
observed samples to estimate the true increase across the *entire*
requested duration, compensating for the query's time range boundary
rarely landing exactly on a real scrape timestamp. That extrapolation
assumes a roughly constant rate of increase throughout the window, which
is a reasonable approximation for a smoothly increasing counter but less
accurate for one that increases in bursts - exactly onboarding-api's
signup pattern, clustered during business hours rather than spread evenly
across 24 hours. \`increase()\`'s handling of counter resets from routine
deploys (estimating a reset counter's likely pre-reset final value)
contributes a similar small, additional source of approximation on deploy
days. None of this is a bug in Prometheus or in onboarding-api's own
instrumentation - it's \`increase()\` behaving exactly as documented,
producing a close, generally slightly-high estimate rather than an exact
count, which is precisely the small, consistent, never-negative
discrepancy observed against the database's exact, transactionally
guaranteed row count.

For a dashboard that specifically needs to match an exact business
count rather than a close estimate, the fix is either accepting
\`increase()\`'s small approximation as expected and documenting it, or
switching to a Prometheus counter reset-aware sum built from
\`resets()\`-adjusted raw deltas, or - most robust for an exact business
metric - sourcing the "signups" number directly from the database or a
dedicated business-metrics pipeline instead of a Prometheus counter at
all:

\`\`\`promql
sum(increase(onboarding_signups_total[24h]))  # close estimate, not exact
\`\`\`

It's worth explicitly labeling Prometheus-derived counts as
"approximate" wherever they're shown next to or in place of an exact
business number - \`increase()\`'s small, expected imprecision is fine for
trend dashboards and alerting, but not always for a number someone
expects to match a database count exactly.`,
};
