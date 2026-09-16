import type { Scenario } from "../types";

export const deathByLivenessProbe: Scenario = {
  id: "death-by-liveness-probe",
  title: "Death by Liveness Probe",
  subtitle: "catalog-indexer restarts forever and never finishes starting up",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "probes", "startup"],
  briefing: `"catalog-indexer" needs to load a large product index into memory before
it can serve anything - that normally takes about 40 seconds. Since this
morning's deploy, it never gets there: it restarts before finishing, every
single time, and just loops.`,
  constraints: [
    "The container isn't crashing on its own - every restart is a Kubernetes-initiated kill, not the process exiting by itself.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "catalog-indexer", namespace: "catalog", labels: { app: "catalog-indexer" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "catalog-indexer",
                  image: "registry.internal/catalog-indexer:5.3.0",
                  livenessProbe: { httpGet: { path: "/healthz", port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10, failureThreshold: 3 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "catalog-indexer-1a2b3c4d5-e6f7g", namespace: "catalog", labels: { app: "catalog-indexer" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "catalog-indexer", ready: false, restartCount: 14, state: { waiting: { reason: "CrashLoopBackOff" } } }],
        },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "20s", message: "Liveness probe failed: HTTP probe failed with statuscode: 500" },
          { type: "Normal", reason: "Killing", age: "18s", message: "Container catalog-indexer failed liveness probe, will be restarted" },
        ],
        logs: {
          "catalog-indexer": [
            "2026-09-15T09:00:00.100Z INFO  c.e.catalog.IndexLoader - loading product index (this takes ~40s)...",
            "2026-09-15T09:00:35.204Z INFO  c.e.catalog.IndexLoader - still loading, 82% done...",
          ],
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get pod catalog-indexer-1a2b3c4d5-e6f7g -n catalog -o yaml` - look at `livenessProbe.initialDelaySeconds` and `failureThreshold`/`periodSeconds` together, then compare against how long startup actually takes per the logs.",
    "The probe starts checking at 5 seconds in, and gives up after 3 failures 10 seconds apart - that's a fixed ~35-second window before Kubernetes decides the container is unhealthy and kills it.",
    "The logs show the app is still mid-startup ('still loading, 82% done') right around when the kill happens - it isn't stuck or broken, it just needs more time than the probe allows.",
  ],
  options: [
    {
      id: "liveness-too-aggressive-for-startup",
      label:
        "The liveness probe starts at 5 seconds and only allows ~35 seconds total before restarting the container, but the app needs about 40 seconds to finish loading its index - Kubernetes kills it right as it's about to become healthy, every time, forever.",
      explanation:
        "The math lines up exactly: `initialDelaySeconds: 5` plus `failureThreshold: 3` at `periodSeconds: 10` gives roughly 35 seconds before the probe gives up, and the logs show the app is still loading (82% done) well past that point. This isn't a broken app - the probe's timing budget is simply shorter than the app's real startup time, so it never survives long enough to pass a single check.",
    },
    {
      id: "index-loader-bug",
      label: "IndexLoader has a bug that hangs indefinitely partway through loading.",
      explanation:
        "There's no evidence of a hang - the app was making real, incremental progress ('82% done') right up until it got killed. Given uninterrupted time it would very plausibly finish; the restarts are the reason it never gets the chance to prove that.",
    },
    {
      id: "not-enough-cpu",
      label: "The pod doesn't have enough CPU to load the index in a reasonable time.",
      explanation:
        "Nothing here indicates a resource constraint - 40 seconds is stated as the normal, expected load time for this index even under healthy conditions. The problem is a probe timing budget shorter than that normal startup time, not a resource shortage making it abnormally slow.",
    },
    {
      id: "wrong-healthz-port",
      label: "The liveness probe is checking the wrong port.",
      explanation:
        "The probe does reach something on port 8080 - it gets a real HTTP 500 response, not a connection failure - which means the port is correct and the app is listening; it's just correctly reporting itself as not-yet-ready while it's still loading.",
    },
  ],
  correctOptionId: "liveness-too-aggressive-for-startup",
  resolution: `\`livenessProbe.initialDelaySeconds: 5\` plus \`failureThreshold: 3\` at
\`periodSeconds: 10\` gives the container roughly 35 seconds from the moment
it starts before Kubernetes gives up and restarts it. The app's own logs
show it's a completely normal, ~40-second startup that was 82% done when
it got killed - it isn't hanging, it just needs slightly more runway than
the probe allows, and it never gets a second chance because every restart
resets the clock back to zero.

The fix is giving the probe a timing budget that actually covers real
startup time - either loosen the liveness probe directly, or (the cleaner
modern approach) add a dedicated \`startupProbe\` that liveness/readiness
don't even begin checking until it passes:

\`\`\`yaml
startupProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 5
  failureThreshold: 18   # up to 90s to finish starting
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
\`\`\`

A \`startupProbe\` exists exactly for this situation: slow-starting
containers get as long as they need to come up once, without permanently
loosening the liveness probe's ability to catch a real hang once the app
is actually running.`,
};
