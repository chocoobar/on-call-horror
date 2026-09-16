import type { Scenario } from "../types";

export const theLoggerSetToQuiet: Scenario = {
  id: "the-logger-set-to-quiet",
  title: "The Logger Set To Quiet",
  subtitle: "pricing-engine is definitely erroring, but there isn't a single ERROR line to be found anywhere",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["logging", "log-level", "elk"],
  briefing: `Customers are seeing incorrect prices on "pricing-engine" intermittently,
and its error-rate metric confirms a real, nonzero rate of exceptions
being thrown. Searching Kibana for anything at ERROR level from
pricing-engine, for any time range, returns nothing at all - not even old,
known-historical incidents show up as ERROR-level logs.`,
  constraints: [
    "pricing-engine's error-rate metric is a separate signal, exported independently of its text logs, and is confirmed reliable.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-engine", namespace: "pricing", labels: { app: "pricing-engine" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pricing-engine-2c3d4e5f6-g7h8i", namespace: "pricing", labels: { app: "pricing-engine" } },
        status: { phase: "Running", containerStatuses: [{ name: "pricing-engine", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pricing-engine": [
            "2026-09-15T09:12:04.001Z WARN c.e.pricing.RuleEvaluator - falling back to default rule set, primary rule set unavailable",
            "2026-09-15T09:14:55.222Z WARN c.e.pricing.RuleEvaluator - falling back to default rule set, primary rule set unavailable",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "pricing-engine-logging-config", namespace: "pricing" },
        spec: {
          data: {
            "logback.xml":
              '<configuration>\n  <root level="WARN">\n    <appender-ref ref="STDOUT" />\n  </root>\n  <!-- NOTE: root level set to WARN during a noisy-logs incident 4 months\n       ago (ERROR-level logging was flooding disk I/O due to an unrelated\n       bug that has since been fixed) and never reverted back to the\n       previous, correct ERROR-and-above baseline. -->\n</configuration>',
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap pricing-engine-logging-config -n pricing -o yaml` - what's the root logging level actually set to right now?",
    "If the root logger level is set *above* ERROR in severity ordering... wait, check the actual ordering: does `WARN` include or exclude `ERROR`-level events?",
    "Standard logging frameworks treat level as a floor, not a single filter - `WARN` should normally still let `ERROR` through since ERROR is more severe. Read the comment in the config carefully - is the level actually set correctly, or set to something that's silently swallowing ERROR too?",
  ],
  options: [
    {
      id: "root-level-set-above-error",
      label:
        "Wait - actually the root logger is explicitly set to `WARN`, which by standard logging-level ordering (TRACE < DEBUG < INFO < WARN < ERROR) should still allow ERROR through as a *more* severe level than the configured floor - so the real issue is that this WARN-level floor was left in place from an unrelated incident 4 months ago as a temporary change, and while WARN itself doesn't block ERROR, this codebase's `RuleEvaluator` never actually calls `.error(...)` for the underlying failure - it silently catches the real exception and only logs a WARN-level fallback message instead, so there's genuinely no ERROR-level log call being made for on-call to find.",
      explanation:
        "The logging config confirms the root level is `WARN`, which does not suppress ERROR under standard severity ordering - so this isn't a level-filtering problem at all. The real gap is upstream of logging configuration: `RuleEvaluator`'s fallback path only ever logs at WARN when the primary rule set is unavailable, with no corresponding `.error(...)` call anywhere logging the actual underlying exception that's driving the separately-measured error-rate metric - meaning there's no ERROR log line missing due to filtering, because none was ever written to filter out in the first place.",
    },
    {
      id: "root-level-suppressing-error",
      label: "The root logger's level is set to WARN, and WARN is configured here as a stricter floor that excludes ERROR-level messages too, following an unrevered change made during an unrelated noisy-logs incident four months ago.",
      explanation:
        "Standard logging framework severity ordering places ERROR above WARN, so a `WARN` floor should still let ERROR-level messages through in a normally configured setup - a WARN floor blocking ERROR specifically would itself be unusual and isn't what's shown in this configuration. The actually documented WARN-level fallback logging, with no corresponding ERROR call for the real exception, is a more direct and consistent explanation for finding no ERROR lines.",
    },
    {
      id: "kibana-index-missing-error-field",
      label: "Kibana's index mapping is missing the log-level field for ERROR-tagged documents specifically.",
      explanation:
        "There's no indication of a field-mapping issue - other log levels (WARN, seen directly in `kubectl logs`) index and search normally through the same pipeline, which would also affect ERROR-level documents if there were a genuine field-mapping problem specific to this index.",
    },
    {
      id: "pricing-engine-error-metric-is-wrong",
      label: "The error-rate metric itself is miscounting and pricing-engine isn't actually erroring at all.",
      explanation:
        "The error-rate metric is explicitly confirmed reliable and independent of the text logging pipeline - and it's corroborated by the customer-visible incorrect pricing behavior. The mismatch to explain is why no ERROR-level *log line* exists despite that real, confirmed error condition, not whether the error condition itself is real.",
    },
  ],
  correctOptionId: "root-level-set-above-error",
  resolution: `\`pricing-engine-logging-config\` shows the root logger level set to \`WARN\`,
with a comment explaining it was set that way during a noisy-logs incident
four months ago and never reverted. That's a real config smell worth
fixing, but it isn't actually the cause here - under standard logging
severity ordering (TRACE < DEBUG < INFO < WARN < ERROR), a \`WARN\` floor
still lets ERROR-level messages through; it only suppresses the *less*
severe levels below it.

The real gap shows up in what's actually logged: \`kubectl logs\` shows
\`RuleEvaluator\` logging at \`WARN\` when it falls back to a default rule
set because the primary one is unavailable - but nowhere does the code
path that actually throws and handles the underlying exception (the one
driving the separately-measured, confirmed-real error-rate metric) call
\`.error(...)\` at all. The exception is presumably being caught, logged (if
at all) only as part of that WARN-level fallback message, and swallowed -
there's no ERROR-level log call in this code path for the WARN floor to
even have a chance of filtering out.

Two things are worth fixing here: restoring the root level to its correct
baseline (since a stale incident-response setting lingering for four
months is its own risk), and adding an actual ERROR-level log call where
the real exception is caught, so it's not just inferred from a metric:

\`\`\`java
catch (RuleSetUnavailableException e) {
    log.error("primary rule set unavailable, falling back to defaults", e);
    // existing fallback logic
}
\`\`\`

\`\`\`xml
<root level="ERROR">
  <appender-ref ref="STDOUT" />
</root>
\`\`\`

A log level that's stricter than intended is a real bug and worth
catching on its own - but it's worth verifying, as here, that the code
actually calls the level you're looking for before assuming filtering
config is the whole story.`,
};
