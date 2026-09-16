import type { Scenario } from "../types";

export const theRenamedPropertyThatStillWorked: Scenario = {
  id: "the-renamed-property-that-still-worked",
  title: "The Renamed Property That Still 'Worked'",
  subtitle: "content-personalization-api quietly reverted to its simplest ranking algorithm weeks ago and nobody noticed",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "spring-boot", "configuration"],
  briefing: `A quarterly engagement review flagged that "content-personalization-api"'s
click-through rates have been flat at baseline for weeks - the same
performance as its old, deprecated "basic" ranking algorithm, even though
the "ml-ranked" algorithm was supposedly rolled out over a month ago and
nobody reported any errors or rollback since.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "content-personalization-api", namespace: "growth", labels: { app: "content-personalization-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "content-personalization-api", image: "registry.internal/content-personalization-api:8.1.0", env: [{ name: "RANKING_ALGORITHM", value: "ml-ranked" }] },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "35d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "content-personalization-api-3y4z5a6b7-c8d9e", namespace: "growth", labels: { app: "content-personalization-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "content-personalization-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "content-personalization-api": [
            "2026-09-15T09:00:01.110Z INFO  o.s.c.a.ConditionEvaluationReport - BasicRankerConfig#basicRanker matched: @ConditionalOnProperty (ranking.algorithm=basic) matchIfMissing=true, property not found under key 'ranking.algorithm'",
            "2026-09-15T09:00:01.220Z INFO  c.e.growth.RankingController - active ranker: BasicRanker",
          ],
        },
        age: "35d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "content-personalization-api-notes", namespace: "growth" },
        spec: {
          data: {
            "notes.md":
              "A refactor five weeks ago renamed the effective configuration key\nfrom `RANKING_ALGORITHM` / `ranking.algorithm` to a nested form,\n`content.ranking.algorithm`, as part of grouping all content-related\nsettings under one prefix - but the Deployment manifest's environment\nvariable was never updated to match, and still sets the old\n`RANKING_ALGORITHM` name. `BasicRankerConfig`'s `@ConditionalOnProperty`\nchecks the NEW key (`ranking.algorithm` was itself later further renamed\nto `content.ranking.algorithm`) with `matchIfMissing = true` - so\nwhenever that specific key isn't found, it silently defaults to the\nbasic ranker instead of failing to start or logging a clear warning.",
          },
        },
        age: "35d",
      },
    ],
  },
  hints: [
    "`kubectl logs content-personalization-api-3y4z5a6b7-c8d9e -n growth` - the condition evaluation report says the property wasn't found, and `matchIfMissing=true` decided the outcome. What environment variable does the Deployment actually set, versus what key is the condition checking?",
    "`kubectl get configmap content-personalization-api-notes -n growth -o yaml` - did the configuration key name itself change at some point? Was the Deployment manifest updated to match?",
    "`matchIfMissing = true` means 'if this property is absent, act as though the condition matched anyway' - a renamed key with the old name still set somewhere is functionally identical, from the condition's point of view, to the property never being set at all.",
  ],
  options: [
    {
      id: "config-key-renamed-but-deployment-env-var-never-updated",
      label:
        "The configuration key was renamed from `ranking.algorithm` to `content.ranking.algorithm` as part of a refactor, but the Deployment manifest's `RANKING_ALGORITHM` environment variable was never updated to the new nested key form - so from the application's point of view, `content.ranking.algorithm` was never set at all, and `BasicRankerConfig`'s `@ConditionalOnProperty(..., matchIfMissing = true)` silently falls back to the basic ranker instead of failing loudly, exactly as it's been doing since the rename shipped.",
      explanation:
        "The condition evaluation report is explicit: `property not found under key 'ranking.algorithm'` with `matchIfMissing=true`, resulting in `BasicRankerConfig` matching and `BasicRanker` becoming the active implementation. `content-personalization-api-notes` explains why the property is missing despite the Deployment clearly setting `RANKING_ALGORITHM=ml-ranked`: the effective key itself was renamed during a refactor to `content.ranking.algorithm`, and the manifest's environment variable was never updated to match the new name - so the value the team believes is configuring the ranker was, for five weeks, simply not read by anything at all.",
    },
    {
      id: "ml-ranked-model-silently-failing-to-load",
      label: "The ML ranking model itself is silently failing to load, causing a runtime fallback to the basic ranker.",
      explanation:
        "The condition evaluation report shows the decision being made entirely at Spring's bean-wiring stage, before the application even starts serving requests - `BasicRankerConfig` is selected because of a missing configuration property, not because of any runtime failure loading a model file or ML dependency.",
    },
    {
      id: "click-through-rate-tracking-broken",
      label: "The click-through rate tracking/analytics pipeline itself is broken and under-reporting engagement.",
      explanation:
        "The evidence directly shows which ranking algorithm is actually active in production (`BasicRanker`, confirmed by the application's own condition evaluation and controller log) - the flat engagement numbers are consistent with genuinely still running the old, simpler algorithm, not with a broken measurement pipeline.",
    },
    {
      id: "environment-variable-value-typo",
      label: "The value `\"ml-ranked\"` itself has a typo and doesn't match what the ranker expects.",
      explanation:
        "The condition evaluation report says the property was `not found`, not that it was found with an unrecognized value - this points at the environment variable's *name* no longer matching what the application reads at all (due to the key rename), not at a typo in the value being set.",
    },
  ],
  correctOptionId: "config-key-renamed-but-deployment-env-var-never-updated",
  resolution: `The application's own condition evaluation report explains the outcome
directly: \`property not found under key 'ranking.algorithm'\`, combined
with \`matchIfMissing=true\`, resulted in \`BasicRankerConfig\` matching and
\`BasicRanker\` becoming the active implementation - confirmed by
\`RankingController\`'s own log line, \`active ranker: BasicRanker\`. The
Deployment clearly sets \`RANKING_ALGORITHM=ml-ranked\`, which makes the
"property not found" message look contradictory at first.

\`content-personalization-api-notes\` resolves the contradiction: five
weeks ago, a refactor renamed the effective configuration key itself,
grouping content-related settings under a new nested prefix -
\`content.ranking.algorithm\` instead of the old \`ranking.algorithm\`. The
Deployment manifest's environment variable, \`RANKING_ALGORITHM\`, maps
(via Spring's relaxed binding) to the *old* key name - which was never
updated to reflect the rename. From the application's perspective,
\`content.ranking.algorithm\` has never been set at all, not since the
refactor shipped; \`matchIfMissing = true\` on \`BasicRankerConfig\` then
quietly and successfully falls back to the basic ranker, with no error,
no warning, and no indication anything was misconfigured - exactly the
kind of silent regression a quarterly metrics review, rather than an
alert, was needed to catch.

The fix is updating the Deployment's environment variable to the new key
name:

\`\`\`yaml
env:
  - name: CONTENT_RANKING_ALGORITHM
    value: "ml-ranked"
\`\`\`

and, to prevent the next rename from being this silent, giving the
fallback condition a visible log line of its own regardless of
\`matchIfMissing\`:

\`\`\`java
@PostConstruct
void warnIfUsingFallbackRanker() {
    if (rankerConfig.isFallback()) {
        log.warn("using BASIC ranker - content.ranking.algorithm not set; expected ml-ranked in production");
    }
}
\`\`\`

Any \`@ConditionalOnProperty\` using \`matchIfMissing = true\` needs a plan
for what happens when the key it checks is renamed - relying purely on
the condition's own silence to signal "everything's fine" means a rename
in one place (application code) and a stale reference in another
(deployment manifests) can drift apart for weeks with zero visible signal
that anything changed.`,
};
