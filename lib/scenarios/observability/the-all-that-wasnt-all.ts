import type { Scenario } from "../types";

export const theAllThatWasntAll: Scenario = {
  id: "the-all-that-wasnt-all",
  title: "The All That Wasn't All",
  subtitle: "picking \"All\" on the fleet-wide dashboard shows fewer services than picking each one individually and adding them up",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["grafana", "template-variables", "promql"],
  briefing: `Someone cross-checking the fleet-wide error-rate dashboard for a monthly
report notices the "service = All" view shows a noticeably lower total
than manually selecting every service one at a time and summing the
numbers by hand. One service in particular - "notify-fanout" - never
appears to contribute anything when "All" is selected, despite showing
real, nonzero traffic when selected individually.`,
  constraints: [
    "notify-fanout's own metrics, queried directly by name, are confirmed present and accurate in Prometheus the whole time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notify-fanout", namespace: "notifications", labels: { app: "notify-fanout" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fleet-dashboard-template-vars", namespace: "monitoring" },
        spec: {
          data: {
            "dashboard.json":
              '{\n  "templating": {\n    "list": [\n      {\n        "name": "service",\n        "type": "query",\n        "query": "label_values(http_requests_total, service)",\n        "includeAll": true,\n        "allValue": ".*[^t]$"\n      }\n    ]\n  },\n  "panels": [\n    {\n      "title": "Fleet Error Rate",\n      "targets": [{ "expr": "sum(rate(http_requests_total{service=~\\"$service\\",code=~\\"5..\\"}[5m]))" }]\n    }\n  ]\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-all-value-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "When `includeAll` is enabled, Grafana normally substitutes an\nauto-generated regex that alternates every known value\n(`(value1|value2|value3|...)`) whenever `$service` is used as `=~\"$service\"`\nfor the \"All\" option - UNLESS a custom `allValue` is explicitly set, in\nwhich case Grafana uses that literal string instead, completely\nunrelated to the actual list of known values. This dashboard has\n`allValue: \".*[^t]$\"` configured - added, per its since-departed author's\nlast commit message, as a quick fix to exclude some literal \"test-\"\nprefixed service names during a load test, and left in place ever\nsince. It happens to also exclude any service name ending in the letter\n\"t\" - `notify-fanout` ends in \"t\".\n",
          },
        },
        age: "9mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap fleet-dashboard-template-vars -n monitoring -o yaml` - is there a custom `allValue` set on the `$service` variable, and what does it actually match?",
    "`kubectl get configmap grafana-all-value-notes -n monitoring -o yaml` - what was this custom `allValue` originally meant to do, and what does its regex actually exclude as a side effect?",
    "A custom `allValue` completely replaces Grafana's normal 'match everything' behavior for the All option - it's just a regex like any other, and a regex written to exclude one specific pattern can accidentally exclude anything else matching that same pattern, including a perfectly legitimate service name.",
  ],
  options: [
    {
      id: "custom-all-value-regex-excludes-services-ending-in-t",
      label:
        "The `$service` template variable has a custom `allValue` regex, `.*[^t]$`, added as a quick fix to exclude leftover `test-`-prefixed services from a load test - but as a side effect, it excludes *any* service name ending in the letter \"t\", including `notify-fanout`, so selecting \"All\" silently drops every such service from the aggregated query while selecting them individually still works fine, since the custom `allValue` only applies to the All option.",
      explanation:
        "`fleet-dashboard-template-vars` shows `allValue: \".*[^t]$\"` explicitly configured. `grafana-all-value-notes` explains it was a quick fix for excluding `test-` prefixed services during a load test, left in place afterward, and confirms the regex as written excludes any service name ending in \"t\" as an unintended side effect - `notify-fanout` ends in \"t\", explaining exactly why it's invisible under 'All' while still showing real traffic when selected individually, since selecting it by name bypasses the custom `allValue` regex entirely.",
    },
    {
      id: "notify-fanout-metrics-missing-service-label",
      label: "notify-fanout's metrics are missing the `service` label entirely.",
      explanation:
        "notify-fanout's own metrics are confirmed present and accurate when queried directly by name, which requires the `service` label to be set correctly - if the label were missing, selecting it individually by service name wouldn't work either. The gap is specific to the 'All' selection's custom regex, not to notify-fanout's own labeling.",
    },
    {
      id: "prometheus-query-too-many-series-truncation",
      label: "The query hits a series limit under 'All' and silently truncates results, dropping notify-fanout.",
      explanation:
        "There's no evidence of a series-count or result-truncation limit here - the discrepancy is precisely and consistently explained by the custom `allValue` regex's exclusion pattern, which deterministically drops any service ending in \"t\" regardless of how many total series are involved.",
    },
    {
      id: "dashboard-caching-stale-service-list",
      label: "The dashboard's template variable list is cached and hasn't picked up notify-fanout as a known service.",
      explanation:
        "notify-fanout does appear as a selectable option in the variable dropdown (it can be selected individually) - the variable list itself is current. The problem is specific to what regex Grafana substitutes for the special 'All' option, not whether notify-fanout is known as a service at all.",
    },
  ],
  correctOptionId: "custom-all-value-regex-excludes-services-ending-in-t",
  resolution: `\`fleet-dashboard-template-vars\` shows the \`$service\` template variable has
a custom \`allValue\` set: \`.*[^t]$\`. Normally, with just \`includeAll: true\`
and no custom \`allValue\`, Grafana substitutes a regex alternating every
known value for the "All" option - guaranteed to match everything
currently in the list. A custom \`allValue\` overrides that entirely with
whatever literal regex is configured, with no connection to the actual
list of known values. \`grafana-all-value-notes\` explains how this one got
there: it was a quick fix, during a load test, to exclude some
\`test-\`-prefixed service names from cluttering the fleet view, and was
never removed afterward. As written, \`.*[^t]$\` matches any string that
does *not* end in the letter "t" - which does exclude \`test-\`-prefixed
names that happen not to end in "t", but as an unrelated side effect also
excludes any legitimate service name that genuinely ends in "t", like
\`notify-fanout\`. Selecting "All" substitutes this regex and silently
drops every such service from the aggregated query; selecting
\`notify-fanout\` individually bypasses the custom \`allValue\` entirely and
queries it directly, which is why it shows real traffic only that way.

Custom \`allValue\` regexes are a sharp tool - they stop tracking the
actual list of known values the moment they're set, so anything added (or
already present) that happens to match the exclusion pattern silently
falls out of every "All" view, with no error or indication anything was
excluded.

The fix is removing the custom \`allValue\` (letting Grafana's normal,
list-derived "All" behavior take over) or, if the load-test exclusion is
still needed, doing it with a real prefix-anchored pattern instead of an
incidental character-class exclusion:

\`\`\`json
{
  "name": "service",
  "type": "query",
  "query": "label_values(http_requests_total, service)",
  "includeAll": true
}
\`\`\`

Any custom \`allValue\` is worth treating with suspicion and revisiting
periodically - it's very easy for it to quietly stop meaning "everything"
as the real list of values changes around it.`,
};
