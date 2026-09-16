import type { Scenario } from "../types";

export const theProfileThatWasntPackaged: Scenario = {
  id: "the-profile-that-wasnt-packaged",
  title: "The Profile That Wasn't Packaged",
  subtitle: "search-indexer is quietly writing to an in-memory database in production",
  difficulty: "hard",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 25,
  tags: ["java25", "spring-profiles", "configuration"],
  briefing: `Every restart of "search-indexer" wipes out all of its indexed data, as if
it had never run before. No crash, no error - it just comes back empty
every single time, and starts reindexing from scratch.`,
  constraints: [
    "The service is confirmed to be running with `SPRING_PROFILES_ACTIVE=prod` set correctly - the environment variable itself isn't the problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-indexer", namespace: "search", labels: { app: "search-indexer" } },
        spec: {
          replicas: 1,
          template: {
            spec: {
              containers: [
                { name: "search-indexer", image: "registry.internal/search-indexer:2.2.0", env: [{ name: "SPRING_PROFILES_ACTIVE", value: "prod" }] },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "search-indexer-6z7a8b9c0-d1e2f", namespace: "search", labels: { app: "search-indexer" } },
        status: { phase: "Running", containerStatuses: [{ name: "search-indexer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "search-indexer": [
            "2026-09-15T06:00:01.114Z INFO  o.s.b.SpringApplication - The following 1 profile is active: \"prod\"",
            "2026-09-15T06:00:02.204Z WARN  o.s.b.a.jdbc.EmbeddedDataSourceBeanFactoryPostProcessor - Replacing 'dataSource' DataSource bean with embedded version",
            "2026-09-15T06:00:02.210Z INFO  c.z.h.HikariDataSource - HikariPool-1 - Starting...",
          ],
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-indexer-build-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "This service's real datasource connection details live in\n`application-prod.yaml`, which sets `spring.datasource.url` to the\nproduction Postgres instance. `application-prod.yaml` is listed in this\nrepo's `.gitignore` (added a long time ago to avoid ever committing an\nearlier version that had a hardcoded password in it, before secrets were\nmoved to environment variables). The Dockerfile's `COPY src/main/resources/\n*.yaml /app/config/` step therefore silently never picks it up, since it\nnever exists in the build context to begin with - only `application.yaml`\n(the default profile, with no datasource configured) makes it into the\nimage.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl logs search-indexer-6z7a8b9c0-d1e2f -n search` - `SPRING_PROFILES_ACTIVE=prod` is confirmed active. What does the very next log line say Spring Boot is doing with the datasource?",
    "Spring Boot auto-configures an embedded, in-memory database automatically whenever it can't find any datasource configuration at all - as a convenience for tests and quick starts, not something that would normally happen in a real deployment.",
    "`kubectl get configmap search-indexer-build-notes -n search -o yaml` - does the actual `application-prod.yaml` file (the one with real datasource settings) definitely make it into the built container image?",
  ],
  options: [
    {
      id: "prod-profile-file-gitignored-out-of-image",
      label:
        "`application-prod.yaml` - the file that actually configures the real production datasource - is in `.gitignore` and was never removed, so it's never present in the build context the Dockerfile copies from; the `prod` profile is genuinely active (per the logs), but its config file simply isn't in the image, so Spring Boot finds no datasource configuration at all and silently falls back to an auto-configured in-memory database that resets on every restart.",
      explanation:
        "The log line \"Replacing 'dataSource' DataSource bean with embedded version\" is Spring Boot's own auto-configuration announcing exactly this fallback - it only ever engages when no real datasource configuration is found. `search-indexer-build-notes` explains why: `application-prod.yaml` has been gitignored for a long time (originally to avoid committing a hardcoded credential, sensible at the time) and was never un-ignored after credentials moved to environment variables - so it's never in the build context, never copied into the image, and the `prod` profile - genuinely active, exactly as configured - has nothing real to load. Every restart starts a brand-new empty in-memory database, which matches the symptom precisely: no crash, no error, just a clean, empty slate every time.",
    },
    {
      id: "spring-profiles-active-not-set",
      label: "`SPRING_PROFILES_ACTIVE` isn't actually being read by the application.",
      explanation:
        "The log explicitly confirms `The following 1 profile is active: \"prod\"` - the profile selection mechanism is working correctly and is genuinely active; the problem is that the file that profile is supposed to load never made it into the deployed image.",
    },
    {
      id: "postgres-connection-refused",
      label: "The production Postgres database is refusing connections, so the app can't reach it.",
      explanation:
        "A connection failure to a real, configured datasource would produce a connection error in the logs - what's actually logged is Spring Boot's own auto-configuration deliberately substituting an embedded database because it found no datasource configuration to even attempt connecting with.",
    },
    {
      id: "persistent-volume-not-mounted",
      label: "A PersistentVolume for the database isn't mounted, so data doesn't survive restarts.",
      explanation:
        "This isn't about a volume failing to persist real data - it's an in-memory embedded database being created fresh inside the JVM process itself on every startup, which no volume mount could fix, since the database engine itself is never configured to use disk-backed storage in the first place.",
    },
  ],
  correctOptionId: "prod-profile-file-gitignored-out-of-image",
  resolution: `"Replacing 'dataSource' DataSource bean with embedded version" is Spring
Boot's own auto-configuration talking - it only substitutes an in-memory
database when it can find no real datasource configuration anywhere on
the classpath, and it does so silently, by design, since that behavior
exists specifically to make tests and quick demos work without any setup.
The logs confirm the \`prod\` profile is genuinely active, which rules out
the environment variable as the problem - the issue is what that profile
is supposed to load.

\`search-indexer-build-notes\` explains the rest: \`application-prod.yaml\`,
the file holding the actual production datasource URL and credentials,
has sat in \`.gitignore\` since an old, since-fixed incident involving a
hardcoded password - a reasonable precaution at the time that was never
revisited after secrets moved to environment variables. Because it's
gitignored, it was never in the build context the Dockerfile's \`COPY\`
step copies from, so it has never actually been present in any built
image. The \`prod\` profile has been active and correctly selected the
entire time; it simply has nothing to load, so Spring Boot quietly falls
back to an empty, in-memory database that resets every single restart.

The fix has two parts: get \`application-prod.yaml\` (with secrets pulled
from environment variables rather than hardcoded, as originally intended)
un-ignored and back into the repository and build context, and add a
startup-time safety check so this specific failure mode can never be this
silent again:

\`\`\`yaml
# application.yaml (default profile - fails loudly if prod config is missing)
spring:
  datasource:
    url: \${DB_URL:?DB_URL must be set - no default datasource configured}
\`\`\`

A missing production config file that silently degrades to a working,
in-memory substitute is one of the most dangerous kinds of misconfiguration
precisely because nothing crashes or errors - it just quietly does the
wrong thing successfully, for as long as nobody checks whether the data
survived a restart.`,
};
