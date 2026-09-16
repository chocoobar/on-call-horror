import type { Scenario } from "../types";

export const theHeatmapThatHidTheSpike: Scenario = {
  id: "the-heatmap-that-hid-the-spike",
  title: "The Heatmap That Hid The Spike",
  subtitle: "customers reported a brutal slowdown on media-transcoder that the latency heatmap doesn't seem to show at all",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["grafana", "heatmap", "latency"],
  briefing: `A handful of customers reported some transcoding jobs on "media-transcoder"
taking dramatically longer than usual yesterday afternoon - some over a
minute, versus a typical few seconds. The latency heatmap panel for that
exact window looks almost entirely uniform, with no visually obvious hot
spot anywhere near the top of the chart.`,
  constraints: [
    "media-transcoder's raw histogram data for that window, queried directly, does contain a real cluster of unusually slow observations.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "media-transcoder", namespace: "media", labels: { app: "media-transcoder" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "media-transcoder-heatmap-panel", namespace: "monitoring" },
        spec: {
          data: {
            "panel.json":
              '{\n  "title": "Transcode Duration Heatmap",\n  "type": "heatmap",\n  "targets": [{ "expr": "sum(rate(media_transcode_duration_seconds_bucket[5m])) by (le)" }],\n  "options": { "color": { "scale": "linear" } }\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "heatmap-color-scale-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "This panel's color scale is set to `linear`. The overwhelming majority\nof transcode jobs (>99.5%) complete in under 5 seconds, forming a very\ntall, dense band at the low-latency end of the heatmap - under a linear\ncolor scale, that dominant band consumes almost the entire color\ngradient's dynamic range near its brightest end. The genuinely real,\nrare cluster of 45-90 second transcode jobs from yesterday afternoon\n(confirmed present in the raw histogram bucket data) is a tiny fraction\nof total volume by comparison, and under a linear scale gets rendered\nnearly indistinguishable from the empty (zero-count) cells around it -\nit's visually there, but far too faint against the dominant band to\nnotice at a glance.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap media-transcoder-heatmap-panel -n monitoring -o yaml` - what color scale is this heatmap panel actually using?",
    "`kubectl get configmap heatmap-color-scale-notes -n monitoring -o yaml` - how does the volume of the dominant, fast-transcode band compare to the volume of the rare, slow cluster - and what does a linear color scale do to a small count sitting next to an overwhelmingly larger one?",
    "A linear color scale maps color intensity proportionally to raw count - a rare cluster of slow jobs is real, but if it's a tiny fraction of total volume, a linear scale can render it almost the same color as 'nothing happened here' right next to a band that's off-the-charts bright by comparison.",
  ],
  options: [
    {
      id: "linear-color-scale-hides-low-volume-spike",
      label:
        "The heatmap's color scale is set to `linear`, and with the overwhelming majority of transcode jobs completing in under 5 seconds forming a dense, dominant low-latency band, a linear scale maps that band to the brightest end of the color gradient while the real but comparatively tiny cluster of 45-90 second jobs from yesterday afternoon gets rendered almost indistinguishable from empty cells nearby - the slow jobs are genuinely present in the underlying data, they're just visually crushed by a color scale that doesn't give a rare, low-count cluster enough contrast against a much larger dominant band.",
      explanation:
        "`media-transcoder-heatmap-panel` confirms `\"scale\": \"linear\"` explicitly. `heatmap-color-scale-notes` explains the mechanism: under a linear scale, an overwhelmingly larger dominant band consumes nearly the entire color gradient's range, leaving a much smaller real cluster of slow jobs nearly invisible by comparison - consistent with the raw histogram bucket data, queried directly, genuinely containing the slow-job cluster the customers experienced, just not rendered with enough contrast to be visually obvious on this particular panel.",
    },
    {
      id: "customers-reports-exaggerated",
      label: "The customer reports of slow transcoding are likely exaggerated or describe a different issue.",
      explanation:
        "media-transcoder's raw histogram data for that exact window, queried directly, is confirmed to contain a real cluster of unusually slow observations - the slowdown genuinely happened and is present in the underlying metrics; it's specifically the heatmap panel's visual rendering of it that's misleading.",
    },
    {
      id: "histogram-buckets-missing-high-latency-range",
      label: "The histogram's bucket boundaries don't extend high enough to capture 45-90 second durations.",
      explanation:
        "The raw histogram bucket data is confirmed, when queried directly, to already contain the real slow-job cluster - the data exists at the correct latency range. The issue is specifically how the heatmap panel colors and displays that data, not whether the buckets can represent it at all.",
    },
    {
      id: "media-transcoder-scrape-gap-during-window",
      label: "Prometheus missed scrapes during the exact window the slowdown occurred, undercounting the real event.",
      explanation:
        "The raw histogram data for that window is confirmed present and does contain the real slow-job cluster when queried directly - there's no indication of a scrape gap; the data was successfully collected, it's just difficult to see on this specific panel's linear color scale.",
    },
  ],
  correctOptionId: "linear-color-scale-hides-low-volume-spike",
  resolution: `\`media-transcoder-heatmap-panel\` confirms the panel's color scale is set to
\`linear\`. \`heatmap-color-scale-notes\` explains what that does here:
transcode jobs are overwhelmingly fast (over 99.5% complete in under 5
seconds), forming a dense, high-count band at the low end of the
heatmap - and a linear color scale maps color brightness proportionally
to raw count, so that dominant band consumes nearly the entire visible
color range near its brightest end. The real cluster of 45-90 second
transcode jobs from yesterday afternoon, confirmed present in the raw
histogram bucket data when queried directly, is a comparatively tiny
fraction of total volume - under the same linear scale, its cell colors
land so close to "zero count" that they're nearly indistinguishable from
empty cells at a glance, even though the data is genuinely there and
genuinely real.

This is a common heatmap trap: a linear color scale is intuitive for data
where the values of interest span a modest range, but for latency data -
where a rare, high-severity tail sits next to an overwhelmingly larger
normal-case volume - it systematically under-represents exactly the rare
tail an on-call engineer most needs to notice.

The fix is switching the panel to a logarithmic (or otherwise
count-compressing) color scale, which gives low-count cells enough
visual contrast to stand out against empty ones without needing to be
anywhere near the dominant band's volume:

\`\`\`json
{
  "options": { "color": { "scale": "exponential", "exponent": 0.5 } }
}
\`\`\`

(Grafana's heatmap panel documentation also supports a log-transformed
scale for exactly this case.) For any panel meant to surface a rare,
high-latency tail sitting alongside a much larger normal-case volume, a
linear color scale is almost always the wrong default.`,
};
