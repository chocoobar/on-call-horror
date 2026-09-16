import type { Scenario } from "./types";

export const theActuatorPortCollision: Scenario = {
  id: "the-actuator-port-collision",
  title: "The Actuator Port Collision",
  subtitle: "expense-approvals-api's management endpoints go dark the moment the new sidecar was added",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "actuator", "kubernetes"],
  briefing: `A metrics-forwarding sidecar was added to "expense-approvals-api"'s pod
spec yesterday to scrape Prometheus metrics on a separate port from
application traffic. Since then, the liveness probe (which hits the
actuator management port directly) has been failing intermittently, and
metrics scraping keeps returning connection refused about half the time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "expense-approvals-api", namespace: "finance", labels: { app: "expense-approvals-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "expense-approvals-api",
                  image: "registry.internal/expense-approvals-api:4.1.0",
                  env: [{ name: "MANAGEMENT_SERVER_PORT", value: "9464" }],
                  livenessProbe: { httpGet: { path: "/actuator/health/liveness", port: 9464 } },
                },
                {
                  name: "metrics-sidecar",
                  image: "registry.internal/metrics-forwarder:1.0.0",
                  env: [{ name: "LISTEN_PORT", value: "9464" }],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "expense-approvals-api-5g6h7i8j9-k0l1m", namespace: "finance", labels: { app: "expense-approvals-api" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "expense-approvals-api", ready: false, restartCount: 2, state: { running: {} } },
            { name: "metrics-sidecar", ready: true, restartCount: 0, state: { running: {} } },
          ],
        },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "2m", message: "Liveness probe failed: Get \"http://10.244.2.19:9464/actuator/health/liveness\": connect: connection refused" },
        ],
        logs: {
          "expense-approvals-api": [
            "2026-09-15T09:00:01.114Z ERROR o.s.b.web.embedded.tomcat.TomcatWebServer - Management server: address already in use: bind (port 9464)",
          ],
          "metrics-sidecar": [
            "2026-09-15T09:00:00.884Z INFO  metrics-forwarder - listening on :9464",
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "expense-approvals-api-notes", namespace: "finance" },
        spec: {
          data: {
            "notes.md":
              "Containers in the same pod share a single network namespace, so\nthey share the same set of available ports - two containers cannot\nsuccessfully bind to the same port number at once. Whichever container\nhappens to start binding first wins; the other fails to bind and, if it's\nthe application's own management server, that half of the app simply\nnever comes up while the main application port keeps working fine.",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl logs expense-approvals-api-5g6h7i8j9-k0l1m -c expense-approvals-api -n finance` - `address already in use: bind (port 9464)`. What else in this pod might already be using that exact port?",
    "`kubectl logs expense-approvals-api-5g6h7i8j9-k0l1m -c metrics-sidecar -n finance` - what port is the sidecar listening on?",
    "`kubectl get configmap expense-approvals-api-notes -n finance -o yaml` - all containers in a pod share one network namespace and therefore one port space. Two containers configured to use the same port number will collide.",
  ],
  options: [
    {
      id: "management-port-collides-with-sidecar-port",
      label:
        "The application's `MANAGEMENT_SERVER_PORT` (9464) was set to the same port the new `metrics-sidecar` container listens on, and because containers in a pod share one network namespace, only one of them can actually bind that port - the sidecar wins the race consistently enough that the application's own management server (and therefore its liveness probe, which targets that same port) fails to bind at all, intermittently taking the app container down while the main application port keeps working.",
      explanation:
        "The application container's log is explicit: `address already in use: bind (port 9464)`. The sidecar's log confirms it's `listening on :9464` - the exact same port. `expense-approvals-api-notes` explains why this happens at all: containers sharing a pod share a network namespace and its single port space, so two containers configured for the same port number will collide, with only whichever one binds first succeeding.",
    },
    {
      id: "liveness-probe-too-strict",
      label: "The liveness probe itself is simply too aggressive for the app's actual startup time.",
      explanation:
        "The probe isn't failing because of slowness - it's failing with `connection refused`, meaning nothing is listening on that port at all on the application side, because the application's own management server never successfully bound to it in the first place.",
    },
    {
      id: "sidecar-crashlooping",
      label: "The metrics-sidecar container is crash-looping and taking the pod down with it.",
      explanation:
        "The sidecar's own container status shows `ready: true, restartCount: 0` - it's stable and running fine; it's the *application* container that's failing to become ready, specifically because its management server couldn't bind its assigned port.",
    },
    {
      id: "prometheus-scrape-config-wrong-path",
      label: "Prometheus's scrape configuration is pointed at the wrong metrics path.",
      explanation:
        "The failure here is a port bind collision inside the pod itself, happening before any external Prometheus scrape request would even reach either container - this isn't about which path is being scraped, it's about which container actually owns the port being scraped.",
    },
  ],
  correctOptionId: "management-port-collides-with-sidecar-port",
  resolution: `The application container's own startup log gives the exact failure:
\`Management server: address already in use: bind (port 9464)\`. The
sidecar container's log confirms the collision directly: \`listening on
:9464\` - the identical port. \`expense-approvals-api-notes\` explains the
underlying mechanism: every container in a pod shares a single network
namespace, and with it, a single shared port space. Two containers each
configured to use port 9464 cannot both succeed - whichever one binds
first wins, and here it's consistently (or often enough) the sidecar,
leaving the application's own management server, and the liveness probe
that depends on it, unable to come up.

Because the main application traffic port is unaffected, the app looks
"mostly fine" from outside while quietly failing its liveness probe and
losing metrics scraping - exactly the intermittent, confusing symptom
reported.

The fix is giving each container its own distinct port:

\`\`\`yaml
containers:
  - name: expense-approvals-api
    env:
      - name: MANAGEMENT_SERVER_PORT
        value: "9465"
    livenessProbe:
      httpGet: { path: /actuator/health/liveness, port: 9465 }
  - name: metrics-sidecar
    env:
      - name: LISTEN_PORT
        value: "9464"
\`\`\`

Whenever a new sidecar is added to an existing pod spec, its listening
port needs to be checked against every port the other containers already
use - application port, management port, and any other exposed port - since
Kubernetes has no built-in validation that would catch two containers
quietly configured to bind the same number.`,
};
