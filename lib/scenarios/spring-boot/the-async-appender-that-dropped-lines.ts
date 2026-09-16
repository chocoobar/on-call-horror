import type { Scenario } from "../types";

export const theAsyncAppenderThatDroppedLines: Scenario = {
  id: "the-async-appender-that-dropped-lines",
  title: "The Async Appender That Dropped Lines",
  subtitle: "payout-scheduler crashed twice this week, and both times the logs just... stop, with no exception visible",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "logging", "spring-boot"],
  briefing: `"payout-scheduler" crashed unexpectedly twice this week. Both times, the
last thing in the logs is a routine "processing payout batch" message -
whatever actually caused the crash never made it into the log stream at
all, even though the crash was severe enough to be logged as ERROR before
the process died, according to the team that added that error handling
last month.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payout-scheduler", namespace: "payments", labels: { app: "payout-scheduler" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "payout-scheduler", image: "registry.internal/payout-scheduler:1.6.0" }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payout-scheduler-1w2x3y4z5-a6b7c", namespace: "payments", labels: { app: "payout-scheduler" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "payout-scheduler", ready: true, restartCount: 2, state: { running: {} }, lastState: { terminated: { reason: "Error", exitCode: 1, startedAt: "2026-09-14T22:00:00Z", finishedAt: "2026-09-15T03:12:40Z" } } },
          ],
        },
        previousLogs: {
          "payout-scheduler": [
            "2026-09-15T03:12:38.114Z INFO  c.e.payments.PayoutBatchProcessor - processing payout batch batch-4471, 812 payouts",
            "2026-09-15T03:12:38.220Z INFO  c.e.payments.PayoutBatchProcessor - applying payout rule set v14",
          ],
        },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "payout-scheduler-notes", namespace: "payments" },
        spec: {
          data: {
            "logback-spring.xml.excerpt":
              "<appender name=\"ASYNC\" class=\"ch.qos.logback.classic.AsyncAppender\">\n    <queueSize>512</queueSize>\n    <discardingThreshold>20</discardingThreshold>  <!-- default: 20% of\n         queueSize - once the queue is more than 80% full, TRACE/DEBUG/INFO\n         events are silently dropped to protect logging throughput, keeping\n         only WARN/ERROR... but a burst large enough can still fill the\n         remaining queue before the appender thread drains it, and\n         AsyncAppender's queue itself is bounded and non-persistent: any\n         event still queued when the JVM exits abruptly (a crash, not a\n         graceful shutdown) is lost entirely, drained or not -->\n    <appender-ref ref=\"FILE\" />\n</appender>\n<root level=\"INFO\">\n    <appender-ref ref=\"ASYNC\" />\n</root>\n",
          },
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "`kubectl logs payout-scheduler-1w2x3y4z5-a6b7c -n payments --previous` - the last two lines are routine INFO messages. The team says a fatal error was logged right before the crash - where did it go?",
    "`kubectl get configmap payout-scheduler-notes -n payments -o yaml` - is logging synchronous or asynchronous here? What happens to whatever's still sitting in an async appender's queue if the JVM exits abruptly rather than shutting down gracefully?",
    "An `AsyncAppender` hands log events off to a background thread and returns immediately - if the process dies before that background thread gets a chance to actually write a queued event to disk, that event is gone, no matter how severe it was.",
  ],
  options: [
    {
      id: "async-appender-queue-lost-on-abrupt-exit",
      label:
        "Logging goes through a Logback `AsyncAppender` with a bounded, in-memory, non-persistent queue; when the crash happened, the fatal ERROR log event (and possibly others just ahead of it) was still sitting in that queue waiting for the background appender thread to write it to disk when the JVM exited abruptly - an abrupt exit doesn't flush or wait for the queue to drain, so whatever hadn't been physically written yet is lost entirely, leaving the last *written* log line as an unrelated, routine INFO message from moments earlier.",
      explanation:
        "The previous-run logs stop cleanly at two routine INFO lines with no trace of any error, despite the team confirming a fatal error handler logs an ERROR right before the process would exit. `payout-scheduler-notes` explains the gap: logging routes through an `AsyncAppender` with a bounded, in-memory queue - log events are handed off to a background thread and the calling thread continues immediately, without waiting for the event to actually be written. If the process crashes (an abrupt JVM exit, not a graceful shutdown) before that background thread drains the queue, whatever was still queued - including the most recent, most diagnostically important event - is lost for good, never reaching disk at all.",
    },
    {
      id: "logback-configuration-not-loaded",
      label: "The logback configuration itself isn't actually being loaded by the application at all.",
      explanation:
        "Regular INFO-level application logs are clearly being written and are visible in the previous logs - logging is working; the issue is specifically that one late, critical event never made it out of an in-memory queue before the process exited, not that logging is absent entirely.",
    },
    {
      id: "error-handler-itself-never-runs",
      label: "The error handler that's supposed to log the fatal error never actually executes.",
      explanation:
        "This would be a reasonable hypothesis on its own, but `payout-scheduler-notes` specifically describes a known failure mode - an async appender's queue being lost on abrupt exit - that matches the exact symptom (clean-looking logs that simply stop) without requiring the error handler itself to be broken; the team's own confirmation that the handler logs an ERROR before exit points at the log event being lost after being created, not never created.",
    },
    {
      id: "log-aggregation-pipeline-dropping-lines",
      label: "An external log aggregation/shipping pipeline is dropping lines before they reach storage.",
      explanation:
        "The evidence available here (`--previous` container logs, read directly from the container's own log output) already shows the gap - the fatal event never appears even at the source, inside the container's own log stream, which points at the event never being written in the first place rather than being lost somewhere downstream in an aggregation pipeline.",
    },
  ],
  correctOptionId: "async-appender-queue-lost-on-abrupt-exit",
  resolution: `The previous run's logs end cleanly on two routine INFO lines - \`processing
payout batch batch-4471\` and \`applying payout rule set v14\` - with no
trace of any error, despite the team confirming their crash handler logs
a fatal ERROR immediately before the process would exit. Something
between that ERROR being logged and it reaching disk is losing it.

\`payout-scheduler-notes\` shows the mechanism in \`logback-spring.xml\`:
logging routes through Logback's \`AsyncAppender\`, which hands each log
event off to an internal, bounded, in-memory queue and returns
immediately - the actual write to the underlying \`FILE\` appender happens
later, on a separate background thread, whenever it gets around to
draining the queue. That's normally a reasonable performance
optimization. But it means a log event only survives a crash if the
background thread has already physically written it before the process
exits - and an abrupt JVM exit (an uncaught error triggering
\`System.exit\`, a fatal signal, an OOMKill) doesn't wait for or flush that
queue first. Whatever was still sitting there, including the single most
important event of the whole crash, is simply gone.

The fix has two parts: make sure the appender actually flushes on JVM
shutdown, and consider writing anything ERROR-or-above synchronously so
it can never be lost to queue timing at all:

\`\`\`xml
<appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
    <queueSize>512</queueSize>
    <includeCallerData>false</includeCallerData>
    <neverBlock>false</neverBlock>
    <appender-ref ref="FILE" />
</appender>

<!-- ERROR events bypass the async queue entirely and write synchronously -->
<appender name="SYNC_ERROR" class="ch.qos.logback.core.FileAppender">
    <filter class="ch.qos.logback.classic.filter.LevelFilter">
        <level>ERROR</level>
        <onMatch>ACCEPT</onMatch>
        <onMismatch>DENY</onMismatch>
    </filter>
    <file>/var/log/app/error-sync.log</file>
</appender>

<root level="INFO">
    <appender-ref ref="ASYNC" />
    <appender-ref ref="SYNC_ERROR" />
</root>
\`\`\`

Async logging trades a small amount of durability for throughput - that's
usually the right trade for routine INFO/DEBUG traffic, but the one class
of log event a team most needs to survive a crash (the ERROR explaining
*why* it crashed) is exactly the one that shouldn't be allowed to sit in
a queue that a crash can wipe out before it's ever written.`,
};
