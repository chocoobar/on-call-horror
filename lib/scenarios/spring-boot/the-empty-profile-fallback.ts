import type { Scenario } from "../types";

export const theEmptyProfileFallback: Scenario = {
  id: "the-empty-profile-fallback",
  title: "The Empty Profile Fallback",
  subtitle: "vendor-sync-service is quietly writing test vendors into the real supplier catalog",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "spring-profiles", "configuration"],
  briefing: `Procurement noticed a handful of obviously fake vendor records ("Test
Vendor Co", "ACME Fixtures Ltd") showing up in the production supplier
catalog after "vendor-sync-service" was redeployed following a
filename-cleanup PR. The service is confirmed running with the right
profile active - it's not the usual environment variable mixup.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "vendor-sync-service", namespace: "procurement", labels: { app: "vendor-sync-service" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "vendor-sync-service", image: "registry.internal/vendor-sync-service:1.4.0", env: [{ name: "SPRING_PROFILES_ACTIVE", value: "prod" }] }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "vendor-sync-service-8j9k0l1m2-n3o4p", namespace: "procurement", labels: { app: "vendor-sync-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "vendor-sync-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "vendor-sync-service": [
            "2026-09-15T07:00:00.110Z INFO  o.s.b.SpringApplication - The following 1 profile is active: \"prod\"",
            "2026-09-15T07:00:00.884Z INFO  c.e.procurement.VendorSeeder - seeding 3 sample vendors (fixture data for local testing)",
            "2026-09-15T07:00:01.220Z INFO  c.e.procurement.VendorSeeder - seeded vendor 'Test Vendor Co'",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "vendor-sync-service-notes", namespace: "procurement" },
        spec: {
          data: {
            "notes.md":
              "`VendorSeeder` is annotated `@Profile(\"!produ\")` (intended to mean\n'run everywhere except production'), guarding fixture-data seeding meant\nonly for local development and tests. The filename-cleanup PR renamed the\nprofile-specific config file from `application-prod.yaml` to\n`application-produ.yaml` mid-refactor before being caught and partially\nreverted - the config file rename was corrected back to `prod`, but this\none stray `@Profile(\"!produ\")` annotation, typed against the temporary\nname, was missed in the same PR and never changed back.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl logs vendor-sync-service-8j9k0l1m2-n3o4p -n procurement` - the active profile is confirmed correctly as `\"prod\"`. So why does `VendorSeeder`, which is supposed to be dev/test-only, run at all?",
    "`kubectl get configmap vendor-sync-service-notes -n procurement -o yaml` - look very carefully at the exact string inside `VendorSeeder`'s `@Profile` annotation, character by character.",
    "`@Profile(\"!produ\")` doesn't mean 'not prod' - it means 'not exactly this one specific string.' If the active profile is `\"prod\"` and the annotation checks against `\"produ\"`, are those the same string at all?",
  ],
  options: [
    {
      id: "profile-annotation-typo-doesnt-exclude-prod",
      label:
        "`VendorSeeder` is annotated `@Profile(\"!produ\")` - a leftover typo from a mid-refactor filename rename that was only partially reverted - intending to mean 'skip this in production,' but `!produ` only excludes a profile literally named `produ`; since the active profile is genuinely `prod` (a different string), the negation condition is satisfied and `VendorSeeder` runs anyway, seeding fixture test vendors straight into the real production catalog.",
      explanation:
        "The log confirms the active profile is exactly `\"prod\"`, ruling out the usual environment-variable mixup - and yet `VendorSeeder`, described as dev/test-only fixture data, runs anyway and seeds `'Test Vendor Co'`. `vendor-sync-service-notes` explains the exact defect: the seeder's `@Profile` annotation reads `\"!produ\"`, a stray typo from a filename rename that was reverted everywhere except this one annotation. `!produ` excludes only a profile named exactly `produ` - it has no special relationship to `prod` at all, so with `prod` active, the negation still matches and the seeder runs in production.",
    },
    {
      id: "vendorseeder-missing-profile-annotation-entirely",
      label: "VendorSeeder has no `@Profile` guard at all and simply always runs.",
      explanation:
        "`vendor-sync-service-notes` confirms `VendorSeeder` is annotated with `@Profile(\"!produ\")` - a guard does exist, it's just checking against the wrong string due to a leftover typo, not entirely absent.",
    },
    {
      id: "spring-profiles-active-not-honored",
      label: "`SPRING_PROFILES_ACTIVE=prod` isn't actually being honored by the application.",
      explanation:
        "The startup log explicitly confirms `The following 1 profile is active: \"prod\"` - profile activation is working exactly as configured; the defect is entirely inside one bean's own profile-matching condition, not in how the active profile is determined.",
    },
    {
      id: "database-migration-seeded-test-data",
      label: "A database migration script accidentally seeded test data during a schema update.",
      explanation:
        "The log traces the seeded vendor directly to `VendorSeeder`, a Spring bean explicitly logging its own seeding activity - this is application-level bean logic running under an unintentionally-matching profile condition, not a database migration artifact.",
    },
  ],
  correctOptionId: "profile-annotation-typo-doesnt-exclude-prod",
  resolution: `The startup log rules out the usual suspect immediately: \`The following 1
profile is active: "prod"\` - profile activation itself is correct. And
yet \`VendorSeeder\`, described as fixture data meant only for local
testing, runs anyway and seeds \`'Test Vendor Co'\` straight into
production.

\`vendor-sync-service-notes\` finds the actual defect: \`VendorSeeder\` is
annotated \`@Profile("!produ")\` - a stray typo left over from a
filename-cleanup PR that briefly renamed \`application-prod.yaml\` to
\`application-produ.yaml\` mid-refactor before being caught and reverted.
The config filename was fixed back to \`prod\`, but this one Java
annotation, typed against the temporary misspelled name, was missed in
the same PR. \`@Profile("!produ")\` doesn't mean "skip this whenever prod
is active" - it means "run this whenever the active profile is *not
exactly* the string \`produ\`." Since the real active profile is \`prod\` (a
different string entirely), that negation is satisfied, and the seeder
runs in every environment, production included.

The fix is a one-character-per-letter correction back to the real profile
name:

\`\`\`java
@Profile("!prod")
@Component
public class VendorSeeder {
    // fixture-data seeding, now correctly excluded from production
}
\`\`\`

A typo inside a \`@Profile\` string is uniquely dangerous because Spring
doesn't validate that the referenced profile name matches anything real -
an annotation checking against a profile that simply doesn't exist will
silently evaluate to whatever its negation implies, with no warning at
startup that the intended guard was never actually doing anything.`,
};
