import type { Scenario } from "../types";

export const theReadinessProbeThatAskedTooMuch: Scenario = {
  id: "the-readiness-probe-that-asked-too-much",
  title: "The Readiness Probe That Asked Too Much",
  subtitle: "recommendation-api pods flap between ready and not-ready every few minutes, healthy or not",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "actuator", "kubernetes"],
  briefing: `"recommendation-api" pods keep dropping out of the load balancer's rotation
for 10-20 seconds at a time, several times an hour, even though nobody can
find anything actually wrong with the service - no errors, no slow
responses to real traffic. It just periodically stops passing its own
readiness check.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-api", namespace: "personalization", labels: { app: "recommendation-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "recommendation-api", image: "registry.internal/recommendation-api:5.5.0", readinessProbe: { httpGet: { path: "/actuator/health/readiness", port: 8080 }, periodSeconds: 10, timeoutSeconds: 2, failureThreshold: 1 } },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "recommendation-api-3t4u5v6w7-x8y9z", namespace: "personalization", labels: { app: "recommendation-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "recommendation-api", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "3m", message: "Readiness probe failed: Get \"http://10.244.1.22:8080/actuator/health/readiness\": context deadline exceeded" },
        ],
        logs: {
          "recommendation-api": [
            "2026-09-15T11:00:00.114Z INFO  c.e.personalization.MlModelHealthIndicator - pinging model-scoring-service for health check",
            "2026-09-15T11:00:02.410Z WARN  c.e.personalization.MlModelHealthIndicator - model-scoring-service health ping took 2380ms (probe timeoutSeconds=2)",
          ],
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "recommendation-api-notes", namespace: "personalization" },
        spec: {
          data: {
            "MlModelHealthIndicator.java.excerpt":
              "@Component\npublic class MlModelHealthIndicator implements HealthIndicator {\n    @Override\n    public Health health() {\n        // synchronous call to a downstream ML scoring service, included\n        // in the readiness group's aggregate health\n        boolean up = modelScoringClient.ping();\n        return up ? Health.up().build() : Health.down().build();\n    }\n}\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod recommendation-api-3t4u5v6w7-x8y9z -n personalization` - `context deadline exceeded` on the readiness probe. How does the probe's own `timeoutSeconds` compare to how long `MlModelHealthIndicator` actually takes sometimes?",
    "`kubectl get configmap recommendation-api-notes -n personalization -o yaml` - is `MlModelHealthIndicator` checking recommendation-api's own health, or a downstream service's?",
    "`failureThreshold: 1` on the Deployment's readiness probe means a single slow response is enough to flip a pod to not-ready - even if the app itself is otherwise completely fine.",
  ],
  options: [
    {
      id: "custom-health-indicator-pings-slow-downstream",
      label:
        "`MlModelHealthIndicator` is a custom readiness health check that synchronously pings `model-scoring-service` and rolls that result into the readiness aggregate; when that downstream ping occasionally takes longer than the probe's own 2-second timeout, the probe fails - and with `failureThreshold: 1`, a single slow (not even failed) downstream ping is enough to flip a perfectly healthy pod out of rotation for a cycle.",
      explanation:
        "The pod's own log shows exactly this: a health ping to `model-scoring-service` taking 2380ms, just over the probe's own `timeoutSeconds: 2`, immediately followed by the Kubernetes event `context deadline exceeded`. `recommendation-api-notes` confirms `MlModelHealthIndicator` makes a real synchronous network call as part of readiness, coupling this pod's own readiness state to a downstream service's occasional latency - with `failureThreshold: 1`, there's zero tolerance for even one slow ping before the pod is pulled from rotation.",
    },
    {
      id: "model-scoring-service-is-unreliable",
      label: "model-scoring-service itself is unreliable and needs to be fixed on its own end.",
      explanation:
        "Even a perfectly stable downstream service will occasionally have a response take slightly over two seconds under normal network jitter - the actual problem here is coupling this pod's own readiness to that downstream's latency with zero tolerance (`failureThreshold: 1`), not the downstream being unreliable per se.",
    },
    {
      id: "not-enough-cpu-for-readiness-checks",
      label: "The pod doesn't have enough CPU to process readiness checks promptly under load.",
      explanation:
        "The delay is explicitly attributed to a downstream network ping (`model-scoring-service health ping took 2380ms`), not to CPU contention within the pod itself - there's no indication real traffic to the service is slow or CPU-starved at all.",
    },
    {
      id: "wrong-readiness-path-configured",
      label: "The readiness probe is pointed at the wrong path entirely.",
      explanation:
        "`/actuator/health/readiness` is the correct, standard Spring Boot Actuator readiness path and it is responding - just too slowly on occasion, due to what it aggregates - which is a different problem from the probe being misconfigured to hit the wrong endpoint.",
    },
  ],
  correctOptionId: "custom-health-indicator-pings-slow-downstream",
  resolution: `The pod's own log shows the mechanism directly: \`MlModelHealthIndicator\`
pings \`model-scoring-service\` as part of its health check, and that ping
occasionally takes 2380ms - just over the readiness probe's own
\`timeoutSeconds: 2\`. The Kubernetes event that follows, \`context deadline
exceeded\`, is Kubernetes giving up on a readiness call that took too long
to respond, not a report that the application was actually broken.

\`recommendation-api-notes\` shows why a downstream service's occasional
latency becomes this pod's own readiness flapping: \`MlModelHealthIndicator\`
makes a real, synchronous network call to \`model-scoring-service\` and
rolls the result into the readiness health aggregate. Any latency on that
downstream call becomes latency on *this* pod's readiness response. With
\`failureThreshold: 1\` on the probe, there's no tolerance at all - one
slow ping, for any reason, pulls an otherwise perfectly healthy pod out
of the load balancer's rotation for a cycle.

Two changes fix this: readiness shouldn't depend on a downstream's
liveness at all (that's what circuit breakers and timeouts on the actual
request path are for), and the probe itself should tolerate the
occasional slow response:

\`\`\`java
@Component
public class MlModelHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        // readiness reflects this app's own ability to serve traffic,
        // not a downstream's current latency
        return Health.up().build();
    }
}
\`\`\`

\`\`\`yaml
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
\`\`\`

A downstream dependency being occasionally slow is a resilience concern
for the request path (timeouts, circuit breakers, fallbacks) - it
shouldn't also decide whether a perfectly capable pod gets pulled from
rotation.`,
};
