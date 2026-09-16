import type { Scenario } from "../types";

export const theTwoHooksSameWave: Scenario = {
  id: "the-two-hooks-same-wave",
  title: "The Two Hooks, Same Wave",
  subtitle: "subscription-billing's migration sometimes runs against half-seeded reference data, sometimes not",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "sync-hooks", "sync-waves"],
  briefing: `"subscription-billing" runs two PreSync Jobs on every deploy: one that
seeds reference data (currency codes, tax rules) and one that runs schema
migrations which read that reference data to validate foreign keys. Most
deploys succeed. Roughly one in five fails with a foreign-key violation
during migration - and it's never the same deploy twice in a row, making
it maddening to reproduce on demand.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-two-hooks-same-wave", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/subscription-billing.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "billing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "a7b8c9d" }, health: { status: "Degraded" } },
        age: "1h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "seed-reference-data", namespace: "billing", annotations: { "argocd.argoproj.io/hook": "PreSync" } },
        status: { succeeded: 1 },
        age: "1h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "run-schema-migration", namespace: "billing", annotations: { "argocd.argoproj.io/hook": "PreSync" } },
        status: { failed: 1 },
        events: [
          { type: "Warning", reason: "BackoffLimitExceeded", age: "50m", message: "Job has reached the specified backoff limit" },
        ],
        previousLogs: { migrate: ["ERROR: insert or update on table \"invoices\" violates foreign key constraint \"fk_currency_code\": Key (currency_code)=(NZD) is not present in table \"currency_codes\""] },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "hook-ordering-notes", namespace: "billing" },
        spec: {
          data: {
            "notes.md":
              "Both Jobs carry `argocd.argoproj.io/hook: PreSync` with NO sync-wave\nannotation on either - meaning both default to the same wave, 0. Within\na single wave, ArgoCD applies all of that wave's resources concurrently\nand does not guarantee any particular ordering or completion sequencing\nbetween them relative to each other - it only guarantees the whole wave\ncompletes (all resources in it healthy) before the next wave starts.\nWith both Jobs started concurrently and racing, run-schema-migration\nsometimes starts and reaches the currency_codes foreign-key check before\nseed-reference-data has finished inserting the NZD row specifically\n(new currency added recently, inserted near the end of that Job's seed\nscript) - a race that resolves differently depending on pod scheduling\nlatency, node contention, and exact seed-data insert ordering each time,\nwhich is exactly why it's intermittent rather than deterministic.",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl get job seed-reference-data run-schema-migration -n billing -o yaml` - check the `argocd.argoproj.io/sync-wave` annotation on each. Are they actually different?",
    "Resources within the same sync wave are applied concurrently, with no ordering guarantee relative to each other - only that the whole wave completes before the next one starts.",
    "`kubectl get configmap hook-ordering-notes -n billing -o yaml` - and note the foreign-key error names a specific, recently-added value (NZD) rather than a systematically broken migration.",
  ],
  options: [
    {
      id: "both-hooks-same-wave-race-condition",
      label:
        "Both PreSync Jobs have no sync-wave annotation, so both default to wave 0 and run concurrently with no ordering guarantee between them - the migration Job sometimes reaches its foreign-key check before the seed Job finishes inserting a recently-added reference row, and which one wins the race varies by pod scheduling and insert timing on each deploy, producing intermittent, non-reproducible-on-demand failures.",
      explanation:
        "`hook-ordering-notes` confirms neither Job has a sync-wave annotation, so both default to wave 0 and run concurrently rather than sequentially. The failed migration's error names a specific, recently-added value (NZD) that the seed Job inserts near the end of its script - exactly the kind of dependency that only breaks when the migration Job happens to reach that particular check before the seed Job's insert completes, which depends on scheduling timing that varies deploy to deploy, matching the roughly-one-in-five, never-reproducible-on-demand pattern.",
    },
    {
      id: "seed-script-missing-currency",
      label: "The seed script is missing the NZD currency code entirely, so it will always eventually fail.",
      explanation:
        "The seed Job's own status shows `succeeded: 1` on every deploy, including ones where the migration later fails - the reference data genuinely does get seeded successfully each time, including NZD, per the notes. The issue is purely about whether the seed completes *before* the migration checks for it, not whether the seed data is correct or complete.",
    },
    {
      id: "database-connection-pool-exhausted",
      label: "The database connection pool is being exhausted by running two Jobs at once.",
      explanation:
        "The failure is a specific foreign-key constraint violation naming a particular missing value, not a connection error or timeout that pool exhaustion would typically produce - both Jobs are able to connect and execute their queries successfully, they're just racing on data dependency, not connection availability.",
    },
    {
      id: "migration-job-retries-not-idempotent",
      label: "The migration Job's retries aren't idempotent, causing it to fail on a second attempt.",
      explanation:
        "The failure happens on the Job's actual execution against real, currently-incomplete seed data - it's a genuine data dependency violation on that attempt, not a retry-related idempotency issue. Fixing idempotency wouldn't address the fact that the required reference row may not exist yet when the check runs.",
    },
  ],
  correctOptionId: "both-hooks-same-wave-race-condition",
  resolution: `\`hook-ordering-notes\` confirms neither PreSync Job has an explicit
sync-wave annotation, so both default to the same wave, 0. ArgoCD applies
every resource within a wave concurrently, guaranteeing only that the
whole wave completes before the next one starts - not any ordering
between resources inside the same wave. The migration Job's error names a
specific, recently-added reference value (NZD) that the seed Job inserts
near the end of its own script; when pod scheduling or execution timing
happens to let the migration reach that particular foreign-key check
before the seed Job's insert completes, it fails. Which Job "wins" varies
by node contention and scheduling latency on each individual deploy -
exactly why this is intermittent and resistant to reproducing on demand,
rather than a deterministic, always-or-never failure.

Fix by giving the two Jobs distinct, ordered sync-waves so the dependency
is enforced explicitly rather than left to chance:

\`\`\`yaml
# seed-reference-data Job
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/sync-wave: "-1"

# run-schema-migration Job
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/sync-wave: "0"
\`\`\`

With the seed Job in an earlier wave, ArgoCD waits for it to reach
Succeeded (via its own Job health check) before the migration Job's wave
even starts, eliminating the race entirely. Worth a broader lesson for
the team: any two PreSync (or PostSync) hooks with a real data or
ordering dependency between them need distinct sync-waves - sharing the
default wave 0 is only safe when hooks are genuinely independent of each
other.`,
};
