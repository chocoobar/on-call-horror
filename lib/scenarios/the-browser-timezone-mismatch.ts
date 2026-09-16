import type { Scenario } from "./types";

export const theBrowserTimezoneMismatch: Scenario = {
  id: "the-browser-timezone-mismatch",
  title: "The Browser Timezone Mismatch",
  subtitle: "two engineers on the same incident call insist the graph shows the spike at two different times",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["grafana", "timezone", "dashboards"],
  briefing: `Mid-incident, two engineers looking at the exact same shared Grafana
dashboard link for "video-encoder" are arguing about when a latency spike
started - one insists it was 14:32, the other is equally sure it was
18:32. Both are looking at the same panel, same time range, same data.`,
  constraints: [
    "There's only one real spike - both engineers are looking at the same underlying data point, not two different events.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "video-encoder", namespace: "media", labels: { app: "video-encoder" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-dashboard-timezone-setting", namespace: "monitoring" },
        spec: {
          data: {
            "dashboard.json":
              '{\n  "title": "video-encoder latency",\n  "timezone": "browser"\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "engineer-timezone-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "Dashboard `timezone` setting is `\"browser\"` - each viewer's Grafana\nrenders all timestamps in whatever local timezone their own browser/OS\nis set to, rather than a single fixed timezone shared by everyone\nlooking at the dashboard. One engineer on the incident call is in\nUTC-4 (US Eastern), the other is in UTC (London) - a 4-hour difference,\nmatching exactly the gap between the two claimed spike times (14:32 vs\n18:32).\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap grafana-dashboard-timezone-setting -n monitoring -o yaml` - what timezone is this dashboard configured to display timestamps in?",
    "`kubectl get configmap engineer-timezone-notes -n monitoring -o yaml` - what timezone is each engineer's own browser/OS actually set to, and how big is the gap between them?",
    "A dashboard set to `timezone: \"browser\"` renders every timestamp according to each individual viewer's own local settings - the exact same underlying data point can display as two different clock times to two people looking at the identical shared link at the identical moment.",
  ],
  options: [
    {
      id: "dashboard-timezone-set-to-browser",
      label:
        "The dashboard's `timezone` setting is `\"browser\"`, meaning every timestamp renders according to each individual viewer's own local browser/OS timezone rather than one shared, fixed timezone - the two engineers are in US Eastern (UTC-4) and London (UTC) respectively, a 4-hour gap that matches exactly the discrepancy between their claimed spike times, even though they're both looking at the exact same underlying data point on the exact same shared dashboard link.",
      explanation:
        "`grafana-dashboard-timezone-setting` confirms `\"timezone\": \"browser\"` is configured. `engineer-timezone-notes` confirms the two engineers' timezones differ by exactly 4 hours, matching precisely the 14:32-vs-18:32 discrepancy reported. With `timezone: \"browser\"`, the identical underlying spike timestamp is genuinely rendered differently for each viewer based on their own local settings - there's no actual disagreement about the data, only about what clock time it's displayed as, which fully and precisely explains the argument.",
    },
    {
      id: "two-separate-spikes",
      label: "There were actually two separate latency spikes, roughly 4 hours apart, and each engineer is describing a different real one.",
      explanation:
        "The scenario confirms there's only one real spike, and both engineers are looking at the exact same underlying data point on the exact same shared dashboard - this isn't a case of two real events being conflated, but of one real event being displayed at two different apparent clock times.",
    },
    {
      id: "grafana-server-clock-inconsistent",
      label: "Grafana's server-side clock is inconsistent, causing timestamps to render unpredictably.",
      explanation:
        "An inconsistent server clock would tend to produce unpredictable, non-reproducible discrepancies rather than a clean, exact 4-hour gap that precisely matches a known, real timezone difference between the two specific viewers involved - a fixed offset like this is a strong signature of a timezone display setting, not clock drift.",
    },
    {
      id: "dashboard-cached-different-versions",
      label: "The two engineers are viewing cached, different versions of the dashboard from before a recent edit.",
      explanation:
        "There's no indication of a dashboard edit or versioning issue here - both engineers are using the same shared link to the same current dashboard, and the discrepancy has an exact, precise 4-hour signature matching a real timezone difference rather than the kind of inconsistency a stale cache would typically produce.",
    },
  ],
  correctOptionId: "dashboard-timezone-set-to-browser",
  resolution: `\`grafana-dashboard-timezone-setting\` confirms the dashboard's \`timezone\`
field is set to \`"browser"\` rather than a fixed timezone like \`"utc"\`.
With that setting, Grafana renders every timestamp - axis labels, tooltip
values, everything - according to each individual viewer's own local
browser/OS timezone, rather than one consistent timezone shared by
everyone looking at the same dashboard. \`engineer-timezone-notes\` confirms
the two engineers on the call are in US Eastern (UTC-4) and London (UTC)
respectively - a 4-hour difference that lines up exactly with the
14:32-vs-18:32 discrepancy they were arguing about. Both were looking at
the exact same underlying data point, on the exact same shared dashboard
link, at the exact same moment - the *data* never disagreed; only its
rendered clock-time label did, because it was being computed relative to
two different local timezones simultaneously.

This is a particularly disorienting failure mode specifically because it
doesn't look like a data problem at all - the graph shapes match, the
values match, only the axis labels differ, in a way that's easy to
mistake for two genuinely different events rather than one event
rendered two different ways.

The fix, especially for any dashboard likely to be viewed by a distributed
team during an incident, is pinning the timezone to a fixed, shared value
rather than leaving it viewer-dependent:

\`\`\`json
{
  "title": "video-encoder latency",
  "timezone": "utc"
}
\`\`\`

Standardizing incident-response dashboards on UTC (and getting the team
in the habit of always speaking in UTC during incident calls) removes
this entire category of confusion - "browser" timezone is a reasonable
default for a personal, single-viewer dashboard, but it's a liability for
anything meant to be a shared source of truth during a live incident.`,
};
