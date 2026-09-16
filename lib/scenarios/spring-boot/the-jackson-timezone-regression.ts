import type { Scenario } from "../types";

export const theJacksonTimezoneRegression: Scenario = {
  id: "the-jackson-timezone-regression",
  title: "The Jackson Timezone Regression",
  subtitle: "delivery-scheduler's ETAs are off by exactly the local UTC offset, but only since Tuesday",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "jackson", "serialization"],
  briefing: `Since Tuesday's routine dependency-update deploy, "delivery-scheduler" has
been sending delivery ETAs to the driver app that are consistently a few
hours off - always in the same direction, always by an amount that lines
up suspiciously with a timezone offset. Nobody touched any scheduling
logic; the PR that shipped was a Spring Boot patch bump and its
transitive dependency updates.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "delivery-scheduler", namespace: "logistics", labels: { app: "delivery-scheduler" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "delivery-scheduler", image: "registry.internal/delivery-scheduler:8.4.0" }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "delivery-scheduler-2a3b4c5d6-e7f8g", namespace: "logistics", labels: { app: "delivery-scheduler" } },
        status: { phase: "Running", containerStatuses: [{ name: "delivery-scheduler", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "delivery-scheduler": [
            "2026-09-15T14:00:00.010Z INFO  c.e.logistics.EtaService - computed eta for stop-4821: 2026-09-15T18:00:00-04:00 (local, America/New_York)",
            "2026-09-15T14:00:00.220Z INFO  c.e.logistics.EtaController - responding with body {\"eta\":\"2026-09-15T18:00:00.000+0000\"}",
          ],
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "delivery-scheduler-notes", namespace: "logistics" },
        spec: {
          data: {
            "CHANGELOG.excerpt":
              "jackson-databind bumped 2.17.1 -> 2.18.0 as a transitive dependency of\nthe Spring Boot patch update. Release notes: 'ObjectMapper.writeValueAsString\nfor OffsetDateTime now serializes using the ObjectMapper's configured\nTimeZone (default: UTC) when WRITE_DATES_WITH_ZONE_ID is not explicitly\nset, instead of always preserving the value's own offset.' This app never\nset `WRITE_DATES_WITH_ZONE_ID` and relies on each `OffsetDateTime` already\ncarrying the correct local offset.",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl logs delivery-scheduler-2a3b4c5d6-e7f8g -n logistics` - compare the offset `EtaService` computed internally (`-04:00`) against what actually went out in the HTTP response body.",
    "`kubectl get configmap delivery-scheduler-notes -n logistics -o yaml` - what changed in the jackson-databind changelog between the version before and after Tuesday's deploy?",
    "The instant in time (the actual millisecond) is unchanged in both log lines - only how it's displayed changed. What serialization setting governs which timezone a date gets printed in?",
  ],
  options: [
    {
      id: "jackson-default-timezone-now-applied",
      label:
        "A transitive jackson-databind bump changed how it serializes `OffsetDateTime` values when `WRITE_DATES_WITH_ZONE_ID` isn't set explicitly - it now renders using the `ObjectMapper`'s configured timezone (UTC by default) instead of preserving each value's own local offset, so every ETA still represents the correct instant but now displays in UTC, looking off by the local UTC offset to any client expecting local time.",
      explanation:
        "The internal log shows the ETA computed correctly as `18:00:00-04:00` (America/New_York), but the HTTP response serializes the same instant as `18:00:00.000+0000` - the clock digits are identical, only the offset changed, which is exactly a display/timezone serialization issue rather than a wrong calculation. `delivery-scheduler-notes` confirms jackson-databind's changelog: the exact default-timezone-on-serialization behavior change landed in the version bumped by Tuesday's deploy, and this app never explicitly configured `WRITE_DATES_WITH_ZONE_ID` to opt out of the new default.",
    },
    {
      id: "eta-calculation-logic-broken",
      label: "EtaService's ETA calculation logic itself is now computing the wrong time.",
      explanation:
        "The internal log line shows `EtaService` computing `18:00:00-04:00` correctly, matching what it always would have - the discrepancy only appears in the next line, at serialization time, when the same instant is rendered with a different (UTC) offset in the response body.",
    },
    {
      id: "driver-app-timezone-bug",
      label: "The driver app itself has a timezone display bug, unrelated to this service.",
      explanation:
        "The malformed data originates from this service's own HTTP response body, which now carries a UTC offset instead of the value's original local offset - the driver app displaying exactly what it was sent isn't a bug on its end.",
    },
    {
      id: "clock-drift-on-pods",
      label: "System clock drift on the pods is causing incorrect timestamps.",
      explanation:
        "The underlying instant in time is unchanged between the internal computation and the response - only the displayed offset changed, which rules out clock drift (that would shift the actual instant, not just its textual representation).",
    },
  ],
  correctOptionId: "jackson-default-timezone-now-applied",
  resolution: `The internal log line shows \`EtaService\` computing the ETA correctly:
\`2026-09-15T18:00:00-04:00\`, properly localized to America/New_York. The
very next line - the actual HTTP response body - shows the same clock time
but with a completely different offset: \`+0000\`. The instant hasn't
changed at all, only how it's displayed, which points squarely at
serialization rather than calculation.

\`delivery-scheduler-notes\` names the cause: Tuesday's Spring Boot patch
bump pulled in a newer jackson-databind as a transitive dependency, and
that version changed the default behavior for serializing
\`OffsetDateTime\` - without \`WRITE_DATES_WITH_ZONE_ID\` explicitly
configured, it now renders using the \`ObjectMapper\`'s own configured
timezone (UTC, by default) rather than preserving each value's original
offset. This app always relied on the old default (preserve the value's
own offset) and never set the property to pin that behavior explicitly,
so the dependency bump silently flipped every ETA in every response to
UTC display - correct in absolute terms, wrong for every client expecting
local time.

The fix is pinning the serialization behavior explicitly rather than
depending on Jackson's current default:

\`\`\`java
@Bean
public Jackson2ObjectMapperBuilderCustomizer offsetDateTimeCustomizer() {
    return builder -> builder.featuresToEnable(
        SerializationFeature.WRITE_DATES_WITH_ZONE_ID
    );
}
\`\`\`

Pinning date/time serialization behavior explicitly - rather than relying
on whatever a library's current default happens to be - means the next
routine dependency bump can't silently change how timestamps look to
every downstream consumer.`,
};
