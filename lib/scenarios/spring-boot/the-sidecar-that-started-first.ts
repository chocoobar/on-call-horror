import type { Scenario } from "../types";

export const theSidecarThatStartedFirst: Scenario = {
  id: "the-sidecar-that-started-first",
  title: "The Sidecar That Started First",
  subtitle: "loyalty-api returns a burst of connection-pool errors in the first few seconds after every rollout",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "istio", "startup"],
  briefing: `Since the Istio sidecar was enabled for "loyalty-api", every rollout
produces a brief burst of failed requests in the first few seconds after
a new pod joins the load balancer - not connection refused, but real
500s from inside the application itself, complaining it can't reach its
own database yet. The pod's readiness probe clearly passed before it
started receiving traffic.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "loyalty-api", namespace: "loyalty", labels: { app: "loyalty-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "loyalty-api", image: "registry.internal/loyalty-api:5.0.0", readinessProbe: { httpGet: { path: "/actuator/health/readiness", port: 8080 }, periodSeconds: 3, initialDelaySeconds: 2 } },
                { name: "istio-proxy", image: "registry.internal/istio-proxy:1.22.0" },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "loyalty-api-0v1w2x3y4-z5a6b", namespace: "loyalty", labels: { app: "loyalty-api" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "loyalty-api", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-15T08:00:01Z" } } },
            { name: "istio-proxy", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-15T08:00:00Z" } } },
          ],
        },
        logs: {
          "loyalty-api": [
            "2026-09-15T08:00:03.010Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
            "2026-09-15T08:00:03.110Z INFO  o.s.b.a.h.HealthEndpointAutoConfiguration - readiness probe reporting UP (DataSource bean not part of readiness group)",
            "2026-09-15T08:00:04.884Z ERROR c.e.loyalty.PointsController - HikariPool-1 - Connection is not available, request timed out after 200ms.",
            "2026-09-15T08:00:04.886Z ERROR c.e.loyalty.PointsController - unhandled exception, returning 500",
            "2026-09-15T08:00:07.220Z INFO  c.z.h.HikariDataSource - HikariPool-1 - Start completed, pool size 10",
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "loyalty-api-notes", namespace: "loyalty" },
        spec: {
          data: {
            "notes.md":
              "This service's readiness group deliberately excludes the `db`\nHealthIndicator (added a while back to avoid readiness flapping during\nbrief database blips). Istio's own sidecar injection makes `istio-proxy`\nready almost immediately, well before HikariCP finishes establishing its\ninitial connection pool - and once *both* the app container and the\nsidecar report ready, Istio's own Envoy proxy starts forwarding real\ntraffic into the pod immediately, without waiting for HikariCP's\nasynchronous pool initialization (which happens on a background thread\nand can take a few seconds) to actually finish.",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl logs loyalty-api-0v1w2x3y4-z5a6b -n loyalty` - the readiness probe reports UP nearly a second before the connection failure, and HikariCP doesn't report `Start completed` until several seconds *after* that. What's `DataSource` doing during that gap?",
    "`kubectl get configmap loyalty-api-notes -n loyalty -o yaml` - is the database health indicator part of this service's readiness group? If not, what does readiness actually verify?",
    "HikariCP establishes its initial connection pool asynchronously in the background by default - readiness passing (or the app being 'up') doesn't guarantee the pool has finished warming up yet.",
  ],
  options: [
    {
      id: "readiness-excludes-db-and-traffic-arrives-before-pool-warm",
      label:
        "The `db` HealthIndicator was deliberately excluded from this service's readiness group (to avoid flapping on brief database blips), so readiness reports UP as soon as Tomcat starts - regardless of whether HikariCP's initial connection pool has finished warming up; since HikariCP establishes its pool asynchronously in the background and can take a few seconds, and Istio starts forwarding real traffic the moment both containers report ready, a handful of requests land in that gap and fail with a connection-pool timeout before the pool is actually usable.",
      explanation:
        "The logs show readiness reporting UP at 08:00:03.110, a connection pool failure less than two seconds later, and HikariCP not reporting `Start completed` until 08:00:07.220 - readiness passed roughly four seconds before the pool was actually ready to serve a connection. `loyalty-api-notes` confirms the `db` indicator is deliberately excluded from the readiness group, so readiness never actually verified the database was reachable at all - it only confirmed Tomcat itself was listening, which happened well before HikariCP's own asynchronous pool warm-up finished.",
    },
    {
      id: "istio-proxy-forwarding-before-app-ready",
      label: "istio-proxy is forwarding traffic to the app container before the app itself is actually ready at all.",
      explanation:
        "The application's own container status and log confirm readiness genuinely passed (`readiness probe reporting UP`) before the failures occur - the sidecar isn't jumping ahead of a real readiness check, it's correctly waiting for readiness and then routing traffic to a pod that readiness itself never actually verified was fully usable.",
    },
    {
      id: "hikaricp-pool-size-too-small",
      label: "HikariCP's pool size of 10 connections is too small for the traffic each new pod receives.",
      explanation:
        "The failure isn't about running out of an already-established pool of connections under load - it's a pool that hasn't finished initializing at all yet (`Start completed` logs several seconds later), which a larger pool size wouldn't fix, since the pool would still take time to establish its first connections regardless of its target size.",
    },
    {
      id: "database-server-briefly-unreachable",
      label: "The database server itself is briefly unreachable right as new pods start up.",
      explanation:
        "HikariCP successfully completes its pool startup a few seconds later with no retry or connectivity error logged - this isn't a database availability problem, it's a timing gap between when the application (per its own, database-excluded readiness check) is marked ready and when its connection pool actually finishes initializing.",
    },
  ],
  correctOptionId: "readiness-excludes-db-and-traffic-arrives-before-pool-warm",
  resolution: `The timestamps tell the story precisely: readiness reports \`UP\` at
\`08:00:03.110\`, the first connection-pool failure happens under two
seconds later at \`08:00:04.884\`, and HikariCP doesn't report \`Start
completed\` until \`08:00:07.220\` - more than four seconds *after*
readiness had already passed. Readiness said "ready" well before the
database connection pool was actually usable.

\`loyalty-api-notes\` explains why readiness could pass without that being
true: the \`db\` \`HealthIndicator\` was deliberately excluded from this
service's readiness group at some point in the past, specifically to
avoid readiness flapping during brief, harmless database blips. That
decision means readiness now only ever confirms Tomcat itself is
listening - it says nothing at all about whether HikariCP's initial
connection pool, which establishes itself asynchronously in the
background and can take a few seconds, has actually finished warming up.
Istio's sidecar has no visibility into that either; once both the app
container and \`istio-proxy\` report ready, Envoy begins forwarding real
traffic immediately, landing a handful of requests squarely in the gap
between "Tomcat is listening" and "the database is actually reachable."

The fix is putting the database indicator back into the readiness group,
so readiness genuinely reflects whether the pod can serve a real request:

\`\`\`yaml
management:
  endpoint:
    health:
      group:
        readiness:
          include: readinessState, db
\`\`\`

If the earlier flapping concern is still valid, HikariCP's own
\`initialization-fail-timeout\` and a short, bounded retry are a better fix
for that than excluding the database from readiness altogether -
readiness is supposed to mean "this pod can actually do its job," and
silently narrowing what it checks just moves the failure from a slower
rollout to a burst of real errors on live traffic.`,
};
