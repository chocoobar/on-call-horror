import type { Scenario } from "../types";

export const theSvcPortThatDidntMatchTargetPort: Scenario = {
  id: "the-svc-port-that-didnt-match-target-port",
  title: "The Service Port Aimed At Nothing",
  subtitle: "the container redeployed on a new port. the Service never heard about it.",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["service", "targetport", "deployment"],
  briefing: `"notification-sender" was just upgraded to a new base image that changed
its internal listening port from 8080 to 9090, as part of a routine
framework upgrade. The pods deploy cleanly and pass readiness checks.
Every caller through its Service now gets connection refused immediately.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notification-sender", namespace: "notify2", labels: { app: "notification-sender" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                { name: "notification-sender", image: "registry.internal/notification-sender:5.0.0", ports: [{ containerPort: 9090 }], readinessProbe: { httpGet: { path: "/healthz", port: 9090 } } },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "18m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notification-sender-7h8i9j-x1y2z", namespace: "notify2", labels: { app: "notification-sender" } },
        status: { phase: "Running", containerStatuses: [{ name: "notification-sender", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "18m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "notification-sender", namespace: "notify2" },
        spec: { type: "ClusterIP", clusterIP: "10.96.33.71", selector: { app: "notification-sender" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "1y",
        events: [
          { type: "Warning", reason: "FailedForwarding", age: "12m", message: "connection to endpoint 10.244.5.9:8080 refused" },
        ],
      },
    ],
  },
  hints: [
    "`kubectl get deploy notification-sender -n notify2 -o yaml` - what port does the container itself listen on now, per its readiness probe and `containerPort`?",
    "`kubectl get svc notification-sender -n notify2 -o yaml` - what `targetPort` is the Service still configured to forward to?",
    "The readiness probe passes because it checks the *correct*, new port (9090) directly - but the Service is still sending traffic to the *old* port (8080), which nothing is listening on anymore.",
  ],
  options: [
    {
      id: "targetport-still-8080-container-now-9090",
      label:
        "The container's new base image now listens on port 9090 (confirmed by its own `containerPort` and readiness probe, both updated and passing), but the Service's `targetPort` is still set to the old port, 8080 - the Service forwards every connection to a port nothing is listening on anymore, producing an immediate connection refused, while the readiness probe (checking the correct, new port directly) has no trouble at all.",
      explanation:
        "The Deployment's container spec shows `containerPort: 9090` and a readiness probe against port 9090, both passing - the pod is genuinely healthy on its new port. The Service's `targetPort`, however, is still `8080`, confirmed by its own `FailedForwarding` event showing a refused connection to `10.244.5.9:8080` - exactly the old, no-longer-listened-on port. The mismatch is entirely in the Service definition, which nobody updated as part of the framework upgrade.",
    },
    {
      id: "readiness-probe-misconfigured",
      label: "The readiness probe is misconfigured and reporting false positives.",
      explanation:
        "The readiness probe is checking the correct, currently-listening port (9090) and is reporting accurately - the pod really is ready and healthy on that port. The failure is entirely in the Service's `targetPort` still pointing at the old, no-longer-used port.",
    },
    {
      id: "image-upgrade-broke-app-startup",
      label: "The new base image has a bug that prevents the application from actually starting correctly.",
      explanation:
        "The pods are confirmed Running, Ready, with zero restarts, and the readiness probe against the new port passes consistently - the application is starting and running correctly, just on a different port than the Service is configured to forward to.",
    },
    {
      id: "networkpolicy-blocking-9090",
      label: "A NetworkPolicy is blocking traffic to port 9090 specifically.",
      explanation:
        "The Service's own event shows a connection being refused on port 8080, not any traffic being blocked on port 9090 at all - a NetworkPolicy issue would produce a different symptom (a dropped/timed-out connection to the *correct* port), not a refused connection to the *wrong*, unused one.",
    },
  ],
  correctOptionId: "targetport-still-8080-container-now-9090",
  resolution: `The Deployment's container spec confirms the new image listens on port
9090 now (\`containerPort: 9090\`, and a readiness probe against that same
port passing cleanly) - the framework upgrade changed the application's
listening port as intended, and the pod itself is genuinely healthy. The
Service, however, was never updated to match: its \`targetPort\` is still
\`8080\`, the old port, and its own \`FailedForwarding\` event confirms
exactly that - a connection refused against \`10.244.5.9:8080\`, a port
nothing is listening on anymore. Every caller going through the Service
gets an immediate refusal, while the pod itself passes every health check
Kubernetes runs directly against its real, correct port.

The fix is updating the Service's \`targetPort\` to match the container's
new listening port:

\`\`\`yaml
spec:
  ports:
    - port: 80
      targetPort: 9090
\`\`\`

Any change to a container's listening port needs to be paired with an
update to every Service (and Ingress backend) referencing it via
\`targetPort\` - the Kubernetes readiness/liveness probes and the Service's
own routing are configured completely independently of each other, so one
passing tells you nothing about whether the other was updated to match.`,
};
