import type { Scenario } from "../types";

export const timeZoneDrift: Scenario = {
  id: "time-zone-drift",
  title: "Time Zone Drift",
  subtitle: "every scheduled report for one country landed exactly one hour later than it should have",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "timezone", "tzdata"],
  briefing: `"reporting-scheduler" sends a daily summary email at 8:00 AM local time
for each country it operates in. Starting exactly on a specific date this
month, every report for one specific country arrived at 9:00 AM local
time instead - every single day since, without fail. Every other
country's reports have stayed correct the entire time.`,
  constraints: [
    "Nobody deployed a code or configuration change to reporting-scheduler around when this started - the deploy history shows nothing for that entire week.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "reporting-scheduler", namespace: "reporting", labels: { app: "reporting-scheduler" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "reporting-scheduler-9r0s1t2u3-v4w5x", namespace: "reporting", labels: { app: "reporting-scheduler" } },
        status: { phase: "Running", containerStatuses: [{ name: "reporting-scheduler", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "reporting-scheduler": [
            "2026-09-15T09:00:00.114Z INFO  c.e.reporting.ScheduleRunner - sending daily report for zone=America/Santiago, computed local time=08:00",
            "2026-09-15T09:00:00.204Z INFO  c.e.reporting.EmailSender - report delivered",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "reporting-scheduler-notes", namespace: "reporting" },
        spec: {
          data: {
            "notes.md":
              "`reporting-scheduler` computes each report's send time using\n`ZonedDateTime.now(ZoneId.of(\"America/Santiago\"))`, relying entirely on\nthe JVM's bundled tzdata (IANA time zone database) for that zone's\ncurrent UTC offset and DST rules. Chile changed its own daylight saving\ntime transition date by law earlier this year, effective this month -\na change the JVM's bundled tzdata, current as of when this image was\nlast built (over a year ago), does not know about at all. The container\nhas not been rebuilt or had its JDK/tzdata patched since.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs reporting-scheduler-9r0s1t2u3-v4w5x -n reporting` - the app itself believes it's computing 08:00 local time correctly. Trust that it's doing its own arithmetic right, and ask what it's basing that arithmetic on.",
    "`kubectl get configmap reporting-scheduler-notes -n reporting -o yaml` - what does `ZonedDateTime.now(ZoneId.of(...))` actually depend on to know a zone's current UTC offset, and how often does that data normally need updating?",
    "A country legally changing its own DST transition date is exactly the kind of change that only reaches a JVM through an updated tzdata release, bundled with a JDK security/patch update - not something the application's own code has any way to know about on its own.",
  ],
  options: [
    {
      id: "stale-bundled-tzdata-missed-dst-law-change",
      label:
        "Chile changed its own DST transition date by law this month, but the JVM's bundled tzdata - baked into the image over a year ago and never updated since - has no idea that change happened, so it's still computing this zone's UTC offset using the old transition rule; the code and its arithmetic are completely correct, they're just correct relative to time zone rules that are no longer actually true.",
      explanation:
        "`reporting-scheduler-notes` confirms exactly this: a real, legally-effective DST transition date change in Chile this month, and a JVM/tzdata build that's over a year old and has never been patched to learn about it. `ZonedDateTime.now(ZoneId.of(\"America/Santiago\"))` is only ever as accurate as the tzdata bundled into the JVM it runs on - the application's own scheduling logic is confirmed correct (it genuinely computed and believed it was sending at 08:00 local time), it's just working from an offset/DST rule that stopped being true partway through the JVM's lifetime. This affects only this one country because it's the one whose DST law actually changed - every other country's rules, unaffected by any recent legal change, are still accurately reflected in the same stale tzdata.",
    },
    {
      id: "cron-expression-off-by-one-hour",
      label: "The cron expression scheduling this specific country's report has a one-hour error.",
      explanation:
        "The deploy history shows no changes at all around when this started, and a hardcoded cron misconfiguration wouldn't explain why the shift happened on a specific calendar date corresponding to a real DST transition rather than at deploy time - this points at something in the environment changing meaning out from under unchanged code, not a config typo.",
    },
    {
      id: "database-storing-wrong-country-config",
      label: "The database's stored schedule configuration for this country's send time was accidentally edited.",
      explanation:
        "The log line shows the application correctly computing and believing `08:00` local time is the target, then simply landing an hour later - the intended schedule (8:00 AM) is confirmed correctly configured and used; the discrepancy is entirely in what the JVM's time zone calculation resolves \"local time\" to.",
    },
    {
      id: "server-system-clock-drifted",
      label: "The underlying node's system clock has drifted by an hour.",
      explanation:
        "A drifted system clock would affect every scheduled job across every time zone equally and consistently, not selectively shift exactly one specific country's reports by exactly one hour while every other country stays perfectly accurate - the selectivity by country points specifically at time zone rule data, not the underlying clock.",
    },
  ],
  correctOptionId: "stale-bundled-tzdata-missed-dst-law-change",
  resolution: `The log line shows the application doing exactly what it's supposed to:
computing \`08:00\` local time for \`America/Santiago\` and sending right
then, with total internal confidence that it got the arithmetic right.
\`reporting-scheduler-notes\` explains why that confidence was misplaced -
Chile changed its own DST transition date by law earlier this year,
effective this month, and \`ZonedDateTime\`'s entire understanding of "what
UTC offset does America/Santiago currently observe, and when does it
change" comes from the tzdata (IANA time zone database) bundled into the
JVM the code runs on. This container's image, and the tzdata baked into
its JDK, hasn't been rebuilt or patched in over a year - it has no way of
knowing the law changed, because that information only reaches a JVM
through an updated tzdata release. The code's arithmetic against the
rules it has is entirely correct; the rules themselves just stopped being
true partway through this deployment's lifetime, for this one zone
specifically, which is exactly why every other country - whose real DST
rules didn't change - kept reporting correctly the entire time.

The fix is updating the JVM's tzdata to a release that includes the
corrected rule - either by rebuilding on a patched base JDK image, or via
the JDK's own tzdata updater tool if the platform provides one:

\`\`\`bash
# many JDK distributions ship a standalone tzdata updater
java -jar tzupdater.jar -l   # verify current tzdata version
java -jar tzupdater.jar -u   # apply latest available tzdata
\`\`\`

or simply rebuilding the container image against a current base JDK
image, which typically bundles current tzdata. Any long-lived container
image is implicitly relying on a snapshot-in-time of the world's time
zone rules - and those rules do change, by real legislative action, more
often than most teams expect. A periodic image rebuild against a current
base image is the most reliable way to avoid this class of bug entirely,
rather than needing to notice it after the fact, one country at a time.`,
};
