import type { Scenario } from "../types";

export const theExemplarThatPointedNowhere: Scenario = {
  id: "the-exemplar-that-pointed-nowhere",
  title: "The Exemplar That Pointed Nowhere",
  subtitle: "clicking a latency spike on the search-ranking dashboard never opens a matching trace",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "exemplars", "tracing"],
  briefing: `Grafana's "jump to trace" exemplar feature is set up on search-ranking's
latency dashboard specifically so engineers can click a slow data point
and land directly on the trace that caused it. Every click for the past
month has landed on a "trace not found" error in Tempo, for every single
data point tried, across multiple engineers.`,
  constraints: [
    "Traces for search-ranking do exist and are queryable in Tempo directly by searching for the service and time range - they're just never reachable via the exemplar link.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-ranking", namespace: "search", labels: { app: "search-ranking" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-ranking-metrics-notes", namespace: "search" },
        spec: {
          data: {
            "MetricsConfig.java.excerpt":
              'histogram.recordDuration(\n    duration,\n    Attributes.of(AttributeKey.stringKey("trace_id"), currentSpan.getSpanContext().getTraceId())\n);\n// exemplar label attached as "trace_id" - but the Prometheus exemplar\n// spec (and Grafana\'s exemplar-to-trace linking) specifically looks for\n// a label literally named "traceID" or "trace_id" depending on the\n// configured exemplar_trace_id_label_name in the datasource - this\n// deployment\'s Grafana datasource has that setting configured as\n"traceID"\n// (capital ID, no underscore), which does not match "trace_id" as\n// emitted here.\n',
          },
        },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-datasource-exemplar-config", namespace: "monitoring" },
        spec: {
          data: {
            "datasource.yaml":
              "exemplarTraceIdDestinations:\n  - name: traceID\n    datasourceUid: tempo-uid-search\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap search-ranking-metrics-notes -n search -o yaml` - what's the actual label name attached to the exemplar in the application code?",
    "`kubectl get configmap grafana-datasource-exemplar-config -n monitoring -o yaml` - what label name is the Grafana datasource configured to look for when linking an exemplar to a trace?",
    "Exemplar-to-trace linking works by exact label-name match between what the application attaches to the exemplar and what the datasource is told to look for - a mismatch in capitalization or underscores is enough to break the link entirely, even though both the exemplar and the trace independently exist.",
  ],
  options: [
    {
      id: "exemplar-label-name-mismatch",
      label:
        "search-ranking's instrumentation attaches the trace ID to each exemplar under the label name `trace_id`, but the Grafana datasource's `exemplarTraceIdDestinations` is configured to look for a label literally named `traceID` - the exact-match label name never lines up, so Grafana never manages to extract a trace ID to link to, even though both the exemplar data and the underlying trace genuinely exist.",
      explanation:
        "`search-ranking-metrics-notes` shows the exemplar label attached in code is `trace_id`. `grafana-datasource-exemplar-config` shows the datasource's exemplar-to-trace configuration is keyed on `name: traceID` - different capitalization and no underscore. Exemplar-to-trace linking requires an exact label name match to know which exemplar field holds the trace ID; a mismatch here means Grafana has no way to read out a trace ID to build the link from, even though the exemplar itself was recorded correctly and the trace exists and is separately queryable in Tempo.",
    },
    {
      id: "tempo-retention-too-short",
      label: "Tempo's trace retention period is shorter than how long exemplar data is kept, so the traces have already expired.",
      explanation:
        "Traces for search-ranking are confirmed directly queryable in Tempo by service and time range - they haven't expired. The problem is specifically that the exemplar link never successfully resolves to them, not that the underlying traces are gone.",
    },
    {
      id: "prometheus-not-storing-exemplars",
      label: "Prometheus isn't configured to store exemplars at all for this metric.",
      explanation:
        "If exemplars weren't being stored at all, there would typically be no clickable exemplar points on the graph in the first place, rather than points that are clickable but resolve to 'trace not found.' The exemplar data is present; it just isn't labeled in a way the datasource recognizes.",
    },
    {
      id: "tempo-datasource-uid-wrong",
      label: "The Tempo datasource UID configured for exemplar linking points at the wrong Tempo instance entirely.",
      explanation:
        "The configured `datasourceUid: tempo-uid-search` isn't shown to be wrong or pointing elsewhere - the more direct, evidenced mismatch is the exemplar label name itself (`trace_id` vs `traceID`), which would prevent Grafana from ever extracting a trace ID to look up, regardless of which Tempo instance it would otherwise query.",
    },
  ],
  correctOptionId: "exemplar-label-name-mismatch",
  resolution: `\`search-ranking-metrics-notes\` shows the application attaches the trace ID
to each latency histogram exemplar under the label \`trace_id\`.
\`grafana-datasource-exemplar-config\` shows the Prometheus datasource's
\`exemplarTraceIdDestinations\` is configured with \`name: traceID\` - a
different label name, in both capitalization and the missing underscore.
Grafana's exemplar-to-trace linking works by reading out the value of
whatever label name is configured there from each exemplar and using it
to build a link to the trace datasource; if that exact label name isn't
present on the exemplar, there's nothing for Grafana to read, and the
link either doesn't render correctly or resolves to a lookup that finds
nothing - exactly the "trace not found" behavior reported here, even
though the exemplar was recorded correctly and the underlying trace is
genuinely sitting in Tempo, directly queryable by service and time range.

This is an easy mismatch to introduce, since both spellings look
reasonable in isolation and nothing errors loudly when they don't match -
the link entry just silently fails to resolve.

The fix is making the exemplar label name and the datasource's configured
label name match exactly:

\`\`\`java
Attributes.of(AttributeKey.stringKey("traceID"), currentSpan.getSpanContext().getTraceId())
\`\`\`

\`\`\`yaml
exemplarTraceIdDestinations:
  - name: traceID
    datasourceUid: tempo-uid-search
\`\`\`

Whichever spelling the team standardizes on, it needs to match exactly
across every service's instrumentation and the datasource config - once
it does, clicking an exemplar point finally lands on the real trace that
was there the whole time.`,
};
