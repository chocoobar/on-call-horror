import type { Scenario } from "../types";

export const theTypoInTheProfileVar: Scenario = {
  id: "the-typo-in-the-profile-var",
  title: "The Typo in the Profile Var",
  subtitle: "loyalty-points-api is talking to a staging Redis cluster from inside production",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "spring-profiles", "configuration"],
  briefing: `"loyalty-points-api" was redeployed yesterday as part of a routine
manifest cleanup. Since then, points awarded in production have been
disappearing after a few minutes, and a couple of customers have reported
seeing balances that look like old staging test data. Nothing crashed,
nothing's erroring, and the deploy itself was marked healthy.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "loyalty-points-api", namespace: "loyalty", labels: { app: "loyalty-points-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "loyalty-points-api",
                  image: "registry.internal/loyalty-points-api:1.9.3",
                  env: [{ name: "SPRING_PROFILES_ACTVE", value: "prod" }],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "loyalty-points-api-9m8n7o6p5-q4r3s", namespace: "loyalty", labels: { app: "loyalty-points-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "loyalty-points-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "loyalty-points-api": [
            "2026-09-15T07:00:01.010Z INFO  o.s.b.SpringApplication - The following 1 profile is active: \"default\"",
            "2026-09-15T07:00:01.884Z INFO  o.s.d.r.c.RedisConnectionFactory - connecting to redis://redis-staging.internal:6379",
            "2026-09-15T07:00:02.114Z INFO  c.e.loyalty.PointsService - points TTL configured at 300s (default profile)",
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "loyalty-points-api-notes", namespace: "loyalty" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "spring:\n  config:\n    activate:\n      on-profile: prod\n  data:\n    redis:\n      host: redis-prod.internal\n---\n# default profile (no on-profile marker) - meant for local dev only\nspring:\n  data:\n    redis:\n      host: redis-staging.internal\n      ttl: 300s\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl logs loyalty-points-api-9m8n7o6p5-q4r3s -n loyalty` - which profile does Spring Boot say is actually active? Compare that carefully to what the Deployment's env sets.",
    "`kubectl get deployment loyalty-points-api -n loyalty -o yaml` - read the environment variable name one character at a time.",
    "Spring Boot silently falls back to the `default` profile whenever the variable it's actually listening for isn't set at all - it doesn't error on an unrecognized environment variable name.",
  ],
  options: [
    {
      id: "env-var-name-typo",
      label:
        "The Deployment sets `SPRING_PROFILES_ACTVE` (missing the 'I') instead of `SPRING_PROFILES_ACTIVE`, so Spring Boot never sees a profile request at all and silently falls back to the `default` profile - which points at the staging Redis instance with a 300-second TTL, exactly matching the disappearing points and stale test data.",
      explanation:
        "The log says `The following 1 profile is active: \"default\"` even though the Deployment clearly intends `prod` - and the env var is spelled `SPRING_PROFILES_ACTVE`, missing the 'I' in ACTIVE. Spring Boot doesn't validate or warn about unrecognized environment variable names; it just never finds a real profile request and uses `default`, which the ConfigMap shows points at `redis-staging.internal` with a 300s TTL - explaining both symptoms: production points connecting to a staging cache, and those points expiring and vanishing after five minutes.",
    },
    {
      id: "redis-prod-unreachable",
      label: "The production Redis cluster is unreachable, so the app can't be storing points correctly.",
      explanation:
        "There's no connection failure anywhere in the logs - the app connects successfully to `redis-staging.internal` without any error, which is a *different* host entirely, not a failed connection to the intended production one.",
    },
    {
      id: "ttl-misconfigured-in-prod",
      label: "The production profile's Redis TTL is misconfigured to 300 seconds, causing points to expire early.",
      explanation:
        "The 300-second TTL shown in the logs is explicitly logged as coming from the `default` profile, not `prod` - the `prod` block in the ConfigMap doesn't even set a TTL override, meaning the active profile is the wrong one entirely, not a bad value within the right one.",
    },
    {
      id: "two-replicas-different-configs",
      label: "The two replicas have drifted and are running with different configurations.",
      explanation:
        "Both replicas come from the same Deployment spec with the same (misspelled) environment variable, so they'd behave identically - there's no evidence of replica-to-replica drift, just a shared, single-character typo affecting all instances equally.",
    },
  ],
  correctOptionId: "env-var-name-typo",
  resolution: `The pod's own startup log says it plainly: \`The following 1 profile is
active: "default"\` - not \`prod\`, despite the Deployment clearly intending
that. The cause is a one-character typo in the Deployment's environment
variable name: \`SPRING_PROFILES_ACTVE\` instead of
\`SPRING_PROFILES_ACTIVE\`. Spring Boot doesn't validate environment
variable names or warn about unrecognized ones - it simply never receives
a profile activation request and falls back to its \`default\` profile.

\`loyalty-points-api-notes\` shows exactly what that default profile points
at: \`redis-staging.internal\`, with a 300-second TTL, instead of the real
\`redis-prod.internal\` host the \`prod\` profile block configures. That
explains both symptoms precisely - production traffic silently writing
into the staging Redis cluster (where old test data was still sitting),
and every point balance quietly expiring and vanishing five minutes after
being written, because the \`default\` profile's TTL was only ever meant
for local development convenience.

The fix is a one-character correction to the manifest:

\`\`\`yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    value: prod
\`\`\`

To stop this exact typo from happening silently again, it's worth adding
a startup assertion that fails fast if the \`default\` profile is ever
active outside local development:

\`\`\`yaml
spring:
  datasource:
    url: \${DB_URL:?refusing to start: no profile-specific config was loaded}
\`\`\`

A single-character mismatch between the environment variable Kubernetes
sets and the one Spring Boot actually reads is one of the quietest
failure modes there is: nothing throws, nothing crashes, and the app
comes up looking perfectly healthy - it's just silently running the wrong
configuration for its environment.`,
};
