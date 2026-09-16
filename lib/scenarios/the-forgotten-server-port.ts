import type { Scenario } from "./types";

export const theForgottenServerPort: Scenario = {
  id: "the-forgotten-server-port",
  title: "The Forgotten Server Port",
  subtitle: "returns-service never goes ready after a routine port change, even though the app clearly starts fine",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 10,
  tags: ["java25", "spring-boot", "kubernetes"],
  briefing: `A small cleanup PR standardized "returns-service" to use port 9090
instead of the default 8080, to match a new internal convention. The
deploy went out, the pod logs show the app starting up without any
errors at all - but it never becomes ready, and traffic sent to it just
times out.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "returns-service", namespace: "commerce", labels: { app: "returns-service" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "returns-service",
                  image: "registry.internal/returns-service:2.2.2",
                  ports: [{ containerPort: 9090 }],
                  readinessProbe: { httpGet: { path: "/actuator/health/readiness", port: 8080 }, periodSeconds: 5 },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "returns-service-2c3d4e5f6-g7h8i", namespace: "commerce", labels: { app: "returns-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "returns-service", ready: false, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "1m", message: "Readiness probe failed: Get \"http://10.244.3.14:8080/actuator/health/readiness\": dial tcp 10.244.3.14:8080: connect: connection refused" },
        ],
        logs: {
          "returns-service": [
            "2026-09-15T13:40:01.114Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 9090 (http)",
            "2026-09-15T13:40:01.220Z INFO  o.s.b.SpringApplication - Started ReturnsServiceApplication",
          ],
        },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "returns-service-config", namespace: "commerce" },
        spec: { data: { "application.yaml": "server:\n  port: 9090\n" } },
        age: "20m",
      },
    ],
  },
  hints: [
    "`kubectl logs returns-service-2c3d4e5f6-g7h8i -n commerce` - `Tomcat started on port 9090`. Now check what port the Deployment's `readinessProbe` is actually configured to hit.",
    "`connect: connection refused` on the readiness probe means nothing is listening on the port it tried - not that the app crashed or the endpoint returned an error.",
    "The PR that changed `server.port` in `application.yaml` - did it update every other place in the manifest that also hardcodes a port number?",
  ],
  options: [
    {
      id: "readiness-probe-still-points-at-old-port",
      label:
        "`application.yaml` was correctly updated to `server.port: 9090`, and the app starts and listens there just fine - but the Deployment's `readinessProbe.httpGet.port` was never updated and still targets the old default of `8080`, so every probe gets a connection-refused (nothing is listening there anymore), and the pod can never report ready even though it's completely healthy.",
      explanation:
        "The application log confirms Tomcat started successfully on the new port: `Tomcat started on port 9090 (http)`. The readiness probe failure, meanwhile, shows `connect: connection refused` against port `8080` specifically - the old default the app no longer listens on at all. The port change was applied in `application.yaml` (confirmed by `returns-service-config`) but the Deployment's own `readinessProbe.httpGet.port: 8080` was left unchanged, so the probe is checking a port nothing is bound to anymore.",
    },
    {
      id: "app-crashed-after-logging-started",
      label: "The application crashed immediately after logging that it started successfully.",
      explanation:
        "`restartCount` is `0` and the container is still in a `Running` state with no crash or termination event - the application is up and stable; the readiness probe is simply checking the wrong port entirely, not detecting a real crash.",
    },
    {
      id: "service-selector-mismatch",
      label: "The Kubernetes Service's label selector doesn't match the pod's labels.",
      explanation:
        "The readiness failure is a `connect: connection refused` at the pod's own IP address on a specific port, from the readiness probe (kubelet talking directly to the pod), not a Service routing issue - a Service selector mismatch would show up as no endpoints registered, not a per-pod probe failure like this.",
    },
    {
      id: "network-policy-blocking-probe",
      label: "A NetworkPolicy is blocking the kubelet's readiness probe traffic to the pod.",
      explanation:
        "A blocked NetworkPolicy typically produces a timeout, not an immediate `connection refused` - a refused connection specifically means the destination host responded that nothing is listening on that port, consistent with the app simply not binding to 8080 anymore.",
    },
  ],
  correctOptionId: "readiness-probe-still-points-at-old-port",
  resolution: `The application log shows a completely clean, successful startup:
\`Tomcat started on port 9090 (http)\`, followed immediately by \`Started
ReturnsServiceApplication\`. The readiness probe failure, on the other
hand, is explicit about which port it tried and what happened:
\`connect: connection refused\` against \`10.244.3.14:8080\` - the pod's own
IP, but the *old* port. \`connection refused\` specifically means something
answered "nothing is listening here," which is exactly what you'd expect
once the app moved its listener to 9090 and nothing is bound to 8080
anymore.

The port migration was only half-applied: \`application.yaml\` was
correctly updated (\`server.port: 9090\`, confirmed by \`returns-service-config\`),
and the application itself picked that up without any issue. But the
Deployment manifest's own \`readinessProbe.httpGet.port\` still hardcodes
the old default, \`8080\` - a value that lives entirely separately from the
application's own config and has to be updated by hand alongside it.

The fix is updating the probe (and any liveness/startup probes, and the
container's declared \`ports\`) to match the new port consistently:

\`\`\`yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 9090
  periodSeconds: 5
\`\`\`

Any change to \`server.port\` needs to be grepped across the whole manifest
- probes, the container's \`ports\` list, and the Service's \`targetPort\` all
hardcode the port number independently of the application's own config,
and Kubernetes won't warn about a mismatch until a probe starts failing
against a perfectly healthy app.`,
};
