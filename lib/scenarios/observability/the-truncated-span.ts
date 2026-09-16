import type { Scenario } from "../types";

export const theTruncatedSpan: Scenario = {
  id: "the-truncated-span",
  title: "The Truncated Span",
  subtitle: "every trace for a failing request on quote-builder shows the same unhelpful half-sentence of error detail",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["opentelemetry", "collector", "tracing"],
  briefing: `Debugging failures on "quote-builder" via tracing is going nowhere -
every failed span's \`exception.message\` attribute cuts off mid-sentence
at almost exactly the same length, regardless of what the actual
underlying error was. Different bugs, different stack traces, same
suspiciously identical cutoff point.`,
  constraints: [
    "quote-builder's own application logs, checked directly, show the full, untruncated exception messages for the same failures.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "otel-collector", namespace: "observability", labels: { app: "otel-collector" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "otel-collector-config", namespace: "observability" },
        spec: {
          data: {
            "config.yaml":
              "processors:\n  attributes:\n    actions:\n      - key: exception.message\n        action: truncate\n        # NOTE: truncate action added 4 months ago to cap a *different*,\n        # unrelated attribute (\"http.request.body\") that was occasionally\n        # enormous and inflating span storage costs - applied broadly\n        # across several attribute keys at once, including this one by\n        # accident, all sharing the same max length setting.\n  span:\n    name:\n      to_attributes:\n        rules: []\nexporters:\n  otlp: { endpoint: tempo-distributor:4317 }\nservice:\n  pipelines:\n    traces:\n      processors: [attributes, span]\n      exporters: [otlp]\n",
          },
        },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "attribute-truncate-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "The `attributes` processor's `truncate` action was configured with a\nglobal `max_length: 120` intended specifically for `http.request.body`.\nIt was applied to a list of attribute keys that, during an edit four\nmonths ago, accidentally also came to include `exception.message` -\nevery exception message attribute on every span passing through this\nCollector has been cut to exactly 120 characters ever since, regardless\nof how long or short the real message actually was.\n",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap otel-collector-config -n observability -o yaml` - which attribute keys does the `truncate` action in the `attributes` processor actually apply to?",
    "`kubectl get configmap attribute-truncate-notes -n observability -o yaml` - what was this truncation originally meant to target, and what else got swept up in it?",
    "If every truncated exception message cuts off at almost exactly the same character count regardless of the real message's length or content, that's a strong sign of a fixed `max_length` truncation rule rather than anything about the exceptions themselves.",
  ],
  options: [
    {
      id: "shared-truncate-rule-accidentally-includes-exception-message",
      label:
        "A `truncate` action added four months ago to cap the size of an unrelated attribute (`http.request.body`, to control span storage costs) was applied to a shared list of attribute keys that, during that edit, accidentally also came to include `exception.message` - every span's exception message has been silently cut to the same fixed `max_length` ever since, which is why every failure's trace shows the same cutoff length regardless of the real underlying error, even though the full message is still present in quote-builder's own application logs.",
      explanation:
        "`otel-collector-config`'s own comment on the `truncate` action confirms it was meant for a different attribute and got applied to `exception.message` by accident during a broader edit. `attribute-truncate-notes` confirms a global `max_length: 120` is applied uniformly, explaining the identical cutoff length seen across every failed span regardless of the real error. quote-builder's own logs, confirmed to show the full untruncated message, rule out the truncation happening at the source - it's specifically the Collector's attribute processor cutting the value down in transit.",
    },
    {
      id: "quote-builder-truncating-its-own-exceptions",
      label: "quote-builder's own exception-handling code truncates error messages before attaching them to spans.",
      explanation:
        "quote-builder's own application logs are confirmed to show the full, untruncated exception message for the same failures - the application itself has the complete message available and is presumably attaching it in full; something downstream of the application is what's cutting it short.",
    },
    {
      id: "tempo-storage-limit-truncating-attributes",
      label: "Tempo is truncating long span attributes on ingestion due to a storage size limit.",
      explanation:
        "The Collector's own configuration shows an explicit, deliberate `truncate` action being applied before spans are ever exported to Tempo - there's a directly evidenced cause upstream of Tempo, which makes a separate, unconfirmed Tempo-side limit an unnecessary additional assumption.",
    },
    {
      id: "otel-sdk-max-attribute-length-default",
      label: "The OpenTelemetry SDK's default maximum attribute length setting is capping the message client-side.",
      explanation:
        "quote-builder's application logs show the full message is available and presumably passed to the SDK in full - the Collector's own config, confirmed to include a `truncate` action that was meant for a different attribute and got applied here by mistake, is a directly evidenced explanation without needing to assume a separate SDK-side default is also in play.",
    },
  ],
  correctOptionId: "shared-truncate-rule-accidentally-includes-exception-message",
  resolution: `\`otel-collector-config\`'s \`attributes\` processor includes a \`truncate\`
action on \`exception.message\`, with a comment explaining it was added
four months ago to cap a completely different, unrelated attribute -
\`http.request.body\` - which was occasionally enormous and inflating span
storage costs. \`attribute-truncate-notes\` confirms what happened: the
truncation was configured with a shared \`max_length: 120\` applied across a
list of attribute keys, and during that edit, \`exception.message\`
accidentally ended up on that list alongside the attribute it was
actually meant for. Every span passing through this Collector since then
has had its exception message silently cut to exactly 120 characters,
regardless of the real error - which is exactly why every failure's trace
shows the same suspiciously identical cutoff point no matter what
actually went wrong. quote-builder's own application logs, confirmed to
carry the full, untruncated message, make clear the application itself
is doing nothing wrong - the truncation is happening strictly in transit,
inside the Collector's processor pipeline.

The fix is scoping the \`truncate\` action to only the attribute it was
actually meant for:

\`\`\`yaml
processors:
  attributes:
    actions:
      - key: http.request.body
        action: truncate
        max_length: 120
\`\`\`

A shared truncation (or any other attribute-processor action) configured
across a list of keys is worth double-checking every time that list is
edited - it's easy for an unrelated, high-value attribute to quietly ride
along with a change meant for something else entirely, silently degrading
data quality with no error to flag it.`,
};
