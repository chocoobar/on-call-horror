import type { Scenario } from "../types";

export const theConnectionThatNeverCameBack: Scenario = {
  id: "the-connection-that-never-came-back",
  title: "The Connection That Never Came Back",
  subtitle: "audit-writer runs fine for hours, then every request starts failing with a pool timeout",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "hikaricp", "database"],
  briefing: `"audit-writer" logs a compliance record for every sensitive action taken
elsewhere in the platform. It runs smoothly for hours, then abruptly every
write starts failing with a connection-pool timeout - never a database
outage, never a network blip, just a pool that's apparently run out of
connections it never gives back.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "audit-writer", namespace: "compliance", labels: { app: "audit-writer" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "audit-writer", image: "registry.internal/audit-writer:2.0.9" }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "9h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "audit-writer-9f8g7h6i5-j4k3l", namespace: "compliance", labels: { app: "audit-writer" } },
        status: { phase: "Running", containerStatuses: [{ name: "audit-writer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "audit-writer": [
            "2026-09-15T05:00:00.100Z INFO  c.z.h.HikariDataSource - HikariPool-1 - Starting...",
            "2026-09-15T05:00:00.410Z INFO  c.z.h.HikariDataSource - HikariPool-1 - Start completed, pool size 10",
            "2026-09-15T11:42:03.884Z WARN  c.z.h.pool.HikariPool - HikariPool-1 - Connection is not available, request timed out after 30000ms.",
            "2026-09-15T11:42:03.885Z INFO  c.z.h.pool.HikariPool - HikariPool-1 - Pool stats (total=10, active=10, idle=0, waiting=14)",
          ],
        },
        age: "9h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "audit-writer-notes", namespace: "compliance" },
        spec: {
          data: {
            "AuditRepository.java.excerpt":
              "public void write(AuditRecord record) {\n    Connection conn = dataSource.getConnection();\n    PreparedStatement stmt = conn.prepareStatement(INSERT_SQL);\n    bind(stmt, record);\n    stmt.executeUpdate();\n    conn.close(); // never reached if bind() or executeUpdate() throws -\n                  // no try/finally, no try-with-resources\n}\n",
            "notes.md":
              "`bind()` throws a `SQLDataException` whenever an audit record's\n`actorId` field is longer than the column's varchar limit - a rare but\nreal occurrence for a handful of internal service accounts with unusually\nlong generated IDs. Every time that happens, the connection acquired\nfor that call is never returned to the pool.",
          },
        },
        age: "9h",
      },
    ],
  },
  hints: [
    "`kubectl logs audit-writer-9f8g7h6i5-j4k3l -n compliance` - `active=10, idle=0` means every connection in the pool is currently checked out. Checked out by what, if nothing is visibly still running?",
    "`kubectl get configmap audit-writer-notes -n compliance -o yaml` - look at how `write()` acquires and releases its connection. What happens to `conn.close()` if an earlier line in the method throws?",
    "A connection pool doesn't run low from too much legitimate concurrent traffic alone - it runs low from connections that were checked out and never returned. Find the code path where that can happen.",
  ],
  options: [
    {
      id: "missing-try-finally-leaks-connection-on-exception",
      label:
        "`AuditRepository.write()` acquires a connection with `dataSource.getConnection()` and only closes it at the very end of the method, with no `try/finally` or try-with-resources - so whenever `bind()` throws (which it does for the rare audit record with an oversized `actorId`), execution jumps past `conn.close()` entirely and that connection is leaked from the pool for good, one at a time, until the pool is fully exhausted.",
      explanation:
        "`HikariPool-1`'s stats show `active=10, idle=0` - every connection checked out, none available - despite no unusual concurrent load. `audit-writer-notes` explains how that accumulates one connection at a time: `bind()` throws for a known, if rare, class of oversized `actorId` values, and because `write()` has no `try/finally` around `conn.close()`, any exception thrown before that final line skips it entirely. Each affected audit record permanently strands one connection; enough of them over several hours are enough to exhaust a 10-connection pool completely.",
    },
    {
      id: "database-server-restarted",
      label: "The database server itself silently restarted, invalidating existing connections.",
      explanation:
        "A database restart would typically produce connection-validation failures or `SQLRecoverableException`s across many connections around the same moment, not a slow, steady climb toward `active=10, idle=0` with a stable pool size the whole time - this pattern looks like connections being checked out and never returned, not invalidated all at once.",
    },
    {
      id: "pool-size-too-small-for-load",
      label: "HikariCP's pool size of 10 is simply too small for audit-writer's write volume.",
      explanation:
        "A genuinely undersized pool for real concurrent load would show sustained high utilization from the start, not hours of normal operation followed by a hard wall - the gradual climb to fully exhausted with no connections ever coming back points at a leak, not steady-state capacity being too low.",
    },
    {
      id: "long-running-audit-queries",
      label: "Some audit queries are simply slow and holding connections longer than expected under load.",
      explanation:
        "A slow query would eventually finish and return its connection to the pool - the pool stats show connections that never come back at all, and `AuditRepository.write()`'s missing exception handling explains exactly why some connections are never returned in the first place.",
    },
  ],
  correctOptionId: "missing-try-finally-leaks-connection-on-exception",
  resolution: `\`HikariPool-1\`'s own stats line spells it out: \`active=10, idle=0,
waiting=14\` - every single connection checked out, none idle, and
fourteen more callers stuck waiting for one to free up. That's not a
capacity problem under legitimate load; it's the signature of connections
being acquired and never returned.

\`audit-writer-notes\` shows exactly how: \`AuditRepository.write()\` calls
\`dataSource.getConnection()\` at the top of the method and only calls
\`conn.close()\` on the very last line, with no \`try/finally\` or
try-with-resources in between. \`bind()\` throws a \`SQLDataException\`
whenever an audit record's \`actorId\` exceeds the column's varchar limit -
a rare edge case, but a real and recurring one for a handful of service
accounts with unusually long generated IDs. Every time that exception
fires, execution jumps straight out of the method, skipping
\`conn.close()\` entirely, and that connection is gone from the pool for
good. One leaked connection at a time, over several hours, is more than
enough to exhaust a pool of ten.

The fix is switching to try-with-resources so the connection is released
no matter how the method exits:

\`\`\`java
public void write(AuditRecord record) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement stmt = conn.prepareStatement(INSERT_SQL)) {
        bind(stmt, record);
        stmt.executeUpdate();
    } catch (SQLDataException e) {
        log.error("audit record rejected, actorId too long: {}", record.actorId(), e);
        throw e;
    }
}
\`\`\`

Any code path that acquires a JDBC connection manually needs a guaranteed
release, exception or not - a rare failure case is exactly the kind of
thing a missing \`finally\` will hide for hours before it quietly drains an
entire pool.`,
};
