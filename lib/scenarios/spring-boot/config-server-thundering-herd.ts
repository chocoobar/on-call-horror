import type { Scenario } from "../types";

export const configServerThunderingHerd: Scenario = {
  id: "config-server-thundering-herd",
  title: "Config Server Thundering Herd",
  subtitle: "a two-minute config-server restart took down twelve unrelated services",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "spring-cloud-config", "startup"],
  briefing: `A routine rolling restart of the shared "config-server" (Spring Cloud
Config) was scheduled for a quiet maintenance window. It took about two
minutes end to end. Twelve unrelated services across the platform
crash-looped during that window and took several more minutes to recover
even after config-server was back.`,
  constraints: [
    "None of the twelve affected services have anything to do with each other functionally - the only thing they share is depending on config-server at startup.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "config-server", namespace: "platform", labels: { app: "config-server" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-api", namespace: "shipping", labels: { app: "shipping-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipping-api-4t5u6v7w8-x9y0z", namespace: "shipping", labels: { app: "shipping-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipping-api", ready: true, restartCount: 3, state: { running: {} } }] },
        logs: {
          "shipping-api": [
            "2026-09-15T03:00:00.010Z INFO  o.s.c.c.c.ConfigServicePropertySourceLocator - Fetching config from server at : http://config-server:8888",
            "2026-09-15T03:00:00.011Z WARN  o.s.c.c.c.ConfigServicePropertySourceLocator - Could not locate PropertySource, retrying...",
            "2026-09-15T03:00:00.012Z ERROR o.s.boot.SpringApplication - Application run failed",
            "java.lang.IllegalStateException: Could not locate PropertySource and the fail fast property is set, failing",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "config-client-notes", namespace: "shipping" },
        spec: {
          data: {
            "notes.md":
              "Every service in this platform sets\n`spring.cloud.config.fail-fast: true`, so any service that starts up\nwhile config-server is unreachable exits immediately rather than\nstarting with defaults. `spring.cloud.config.retry` is not configured\nat all, so there's no built-in backoff/retry around the initial config\nfetch - a service that hits config-server during its brief restart\nwindow fails permanently on that one attempt and goes into a normal\nKubernetes restart-with-backoff loop instead of Spring Cloud Config's\nown, much faster, built-in retry.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs shipping-api-4t5u6v7w8-x9y0z -n shipping` - `fail-fast` is doing exactly what its name says. What happens to an application that fails this fast when the thing it depends on is only briefly unavailable?",
    "`kubectl get configmap config-client-notes -n shipping -o yaml` - is there any retry/backoff configured around the initial config fetch, separate from Kubernetes' own container restart backoff?",
    "Twelve unrelated services all restarting around the same two-minute window, for the same reason, points at a shared dependency's brief unavailability being amplified by how each service reacts to it - not twelve unrelated coincidences.",
  ],
  options: [
    {
      id: "fail-fast-with-no-retry-amplifies-brief-outage",
      label:
        "Every service has `spring.cloud.config.fail-fast: true` with no `spring.cloud.config.retry` configured, so any service instance that happens to start during config-server's brief restart window fails immediately and permanently on that one attempt, falling back to Kubernetes' much slower container-restart backoff instead of Spring Cloud Config's own fast internal retry - turning a two-minute config-server blip into several extra minutes of crash-looping across every service unlucky enough to start during that window.",
      explanation:
        "The log shows exactly this behavior: one failed fetch attempt, then an immediate `IllegalStateException` and application shutdown - no retry attempted before giving up. `config-client-notes` confirms `fail-fast` is on everywhere with no `retry` configuration to soften it. Once a Spring Boot process using fail-fast dies instead of retrying, restarting it becomes Kubernetes' job via its own crash-loop backoff (starting at seconds, doubling upward) rather than Spring Cloud Config's own fast, tight internal retry loop - which is exactly why recovery took noticeably longer than config-server's own two-minute restart window, across every service that happened to restart or redeploy something during that window.",
    },
    {
      id: "config-server-storage-corrupted",
      label: "config-server's underlying git-backed config storage got corrupted during the restart.",
      explanation:
        "config-server itself came back up successfully and is reporting healthy - there's no indication its config data was corrupted or lost. The affected services failed because they couldn't reach it *during* a brief window, not because it returned bad data once reachable again.",
    },
    {
      id: "network-partition-during-restart",
      label: "A network partition separated the twelve services from config-server independent of its restart.",
      explanation:
        "The timing correlates precisely with config-server's own scheduled restart window, and its own pods show a completely normal rolling update - there's no separate networking incident needed to explain client-side failures that align exactly with the dependency being briefly unavailable by design during a rollout.",
    },
    {
      id: "twelve-services-coincidentally-deployed",
      label: "Twelve unrelated services coincidentally had their own deploys scheduled in the same window.",
      explanation:
        "These are described as crash-loops of already-running services during the maintenance window, not fresh deploys - and twelve unrelated teams' deploys all coincidentally landing in the same maintenance window is a far less likely explanation than a shared dependency's restart being the common trigger.",
    },
  ],
  correctOptionId: "fail-fast-with-no-retry-amplifies-brief-outage",
  resolution: `\`shipping-api\`'s log shows the whole failure in three lines: one config
fetch attempt, one warning that it couldn't locate a PropertySource, and
then immediate, permanent failure - \`fail-fast\` doing exactly what it's
named for, with no retry attempted in between.
\`config-client-notes\` confirms this is the platform-wide default: every
service fails fast on the very first unsuccessful config fetch, and none
of them have \`spring.cloud.config.retry\` configured to soften that with a
quick internal backoff. Config-server's own two-minute rolling restart is
completely normal and expected - the problem is entirely in how clients
react to a dependency being briefly unavailable during that normal
window. A service that happens to start (a pod reschedule, an unrelated
deploy, a routine restart) during those two minutes doesn't retry and
recover a few seconds later; it dies immediately and falls into
Kubernetes' own container-restart backoff, which starts much slower than
Spring Cloud Config's built-in retry would have and compounds with every
subsequent failure - turning a two-minute blip into several extra minutes
of crash-looping, once per affected service.

The fix is enabling Spring Cloud Config's own retry so a brief config-server
restart doesn't immediately fail the whole application:

\`\`\`yaml
spring:
  cloud:
    config:
      fail-fast: true
      retry:
        initial-interval: 1000
        max-attempts: 6
        max-interval: 5000
\`\`\`

With retry enabled, a service starting during config-server's brief
restart window quietly retries a handful of times over a few seconds and
proceeds normally once config-server is back - instead of dying instantly
and needing a much slower, uncoordinated Kubernetes restart to recover.
\`fail-fast\` without \`retry\` configured is a common gap: it's meant to
catch a genuinely broken or missing config-server, but with no retry
budget it also fires on the shortest, most routine kind of unavailability.`,
};
