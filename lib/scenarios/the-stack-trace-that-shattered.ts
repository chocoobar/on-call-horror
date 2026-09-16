import type { Scenario } from "./types";

export const theStackTraceThatShattered: Scenario = {
  id: "the-stack-trace-that-shattered",
  title: "The Stack Trace That Shattered",
  subtitle: "every Java exception from ledger-service shows up in Kibana as dozens of unrelated one-line events",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["fluent-bit", "logging", "elasticsearch"],
  briefing: `Debugging a rare exception in "ledger-service" is unusually painful:
instead of one log entry containing the full stack trace, Kibana shows
each line of the stack trace as its own separate, disconnected log
document, interleaved with unrelated log lines from other threads logging
at the same time. Piecing together what actually happened means manually
reordering dozens of fragments by timestamp.`,
  constraints: [
    "ledger-service's own stdout, checked directly via `kubectl logs`, shows each exception correctly as one coherent multi-line block.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ledger-service", namespace: "ledger", labels: { app: "ledger-service" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fluent-bit-config", namespace: "logging" },
        spec: {
          data: {
            "fluent-bit.conf":
              "[INPUT]\n    Name              tail\n    Path              /var/log/containers/ledger-service*.log\n    Parser            docker\n    Tag               ledger.*\n    # NOTE: no Multiline.Parser directive set on this input - each line\n    # read from the container log file is treated and shipped as its own\n    # independent, standalone log record.\n\n[OUTPUT]\n    Name  es\n    Match ledger.*\n    Host  elasticsearch.logging.svc\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fluent-bit-multiline-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "Fluent Bit's `tail` input reads and ships each newline-terminated line\nas a separate record by default. A Java stack trace - the exception\nmessage line followed by many `at com.example...` frame lines and\npossibly `Caused by:` sections - is many newlines, and with no\n`Multiline.Parser` configured to recognize and re-join a continuation\nline based on a pattern (e.g. detecting a line that doesn't start a new\ntimestamp/log-level prefix), Fluent Bit has no way to know those\nfollow-on lines belong to the log entry before them.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap fluent-bit-config -n logging -o yaml` - does the `[INPUT]` section for ledger-service's logs have a `Multiline.Parser` directive configured at all?",
    "`kubectl get configmap fluent-bit-multiline-notes -n logging -o yaml` - what does Fluent Bit's `tail` input do with each line it reads, by default, without one configured?",
    "Compare `kubectl logs` output for a real exception against what Kibana shows for the same moment - the raw container log already has the full multi-line stack trace as one coherent block. Something downstream is the one splitting it apart.",
  ],
  options: [
    {
      id: "no-multiline-parser-configured",
      label:
        "Fluent Bit's `tail` input for ledger-service has no `Multiline.Parser` configured, so it ships every line - including every individual stack-trace frame - as its own separate, standalone log record, which is why a single coherent exception in the raw container logs ends up shattered into dozens of disconnected documents in Elasticsearch, interleaved with whatever else logged at the same moment.",
      explanation:
        "`fluent-bit-config`'s `[INPUT]` block for ledger-service's logs has no `Multiline.Parser` directive at all, explicitly noted in the config's own comment. `fluent-bit-multiline-notes` confirms `tail`'s default behavior of treating every line as an independent record with nothing to re-join continuation lines. Since `kubectl logs` shows the exception as one coherent block directly from the container's own stdout, the splitting is demonstrably happening downstream, in the shipping pipeline - exactly where the missing multiline parser configuration would cause it.",
    },
    {
      id: "elasticsearch-splitting-large-documents",
      label: "Elasticsearch is splitting large log documents into multiple smaller ones during indexing.",
      explanation:
        "Elasticsearch indexes whatever document it's given as a single document - it doesn't split incoming documents apart on its own. The fragmentation is happening earlier, at log collection, before anything is even sent to Elasticsearch as a document.",
    },
    {
      id: "ledger-service-logging-per-line",
      label: "ledger-service's own logging framework is configured to emit each line of a stack trace as a separate log call.",
      explanation:
        "`kubectl logs`, reading directly from the container's own stdout, shows the exception as one coherent multi-line block - which rules out the application itself emitting fragmented log calls. The application is logging correctly; something in the shipping pipeline downstream of it is what fragments the output.",
    },
    {
      id: "kibana-display-truncating-long-documents",
      label: "Kibana's discover view is truncating and splitting long documents for display purposes only.",
      explanation:
        "Kibana displays documents as they exist in Elasticsearch - if the underlying issue were purely a display truncation, the raw documents in Elasticsearch would still each contain the full stack trace, and a raw query/export would show that. The actual documents themselves are fragmented at the source, not just their on-screen rendering.",
    },
  ],
  correctOptionId: "no-multiline-parser-configured",
  resolution: `\`kubectl logs\` shows ledger-service writing each exception to stdout as
one coherent block, exactly as expected from the JVM - the message line,
every \`at com.example...\` frame, any \`Caused by:\` sections, all together.
\`fluent-bit-config\`'s \`[INPUT]\` block for ledger-service's logs has no
\`Multiline.Parser\` directive configured at all, which its own comment
flags directly. \`fluent-bit-multiline-notes\` explains the consequence:
Fluent Bit's \`tail\` input ships every newline-terminated line it reads as
its own independent record by default, with nothing telling it that a
line starting with \`\\tat com.example...\` is a continuation of the record
before it rather than a new log entry of its own. Every stack-trace frame
becomes its own document, interleaved in Elasticsearch with whatever else
happened to log at nearby timestamps from other threads.

The fix is configuring a multiline parser that recognizes where a new log
entry actually starts (typically by matching a timestamp/log-level
prefix) and treats everything after it, up to the next match, as one
continued record:

\`\`\`ini
[MULTILINE_PARSER]
    Name          java-multiline
    Type          regex
    Rule          "start_state"  "/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/"  "cont"
    Rule          "cont"         "/^(?!\\d{4}-\\d{2}-\\d{2}T)/"                "cont"

[INPUT]
    Name              tail
    Path              /var/log/containers/ledger-service*.log
    Parser            docker
    Tag               ledger.*
    Multiline.Parser  java-multiline
\`\`\`

Once configured, a stack trace ships and indexes as one document again -
turning "manually reorder thirty fragments by timestamp" back into
"click the one log entry that has the whole exception in it."`,
};
