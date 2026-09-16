import type { Scenario } from "./types";

export const twoServicesSameSelector: Scenario = {
  id: "two-services-same-selector",
  title: "Two Services, One Selector",
  subtitle: "half the calls to the admin port land on the public port instead",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["service", "selector", "ports"],
  briefing: `"queue-worker" exposes a public work-submission port and a separate,
internal-only admin/metrics port, each meant to go through its own
Service. Since a recent change, calls to the admin Service intermittently
get routed to endpoints that don't actually speak the admin protocol,
producing garbled, unparseable responses about a third of the time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "queue-worker", namespace: "queue", labels: { app: "queue-worker" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "queue-worker", ports: [{ containerPort: 8080, name: "public" }, { containerPort: 9100, name: "admin" }] }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "queue-worker-public", namespace: "queue" },
        spec: { type: "ClusterIP", clusterIP: "10.96.5.10", selector: { app: "queue-worker" }, ports: [{ name: "public", port: 80, targetPort: 8080 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "queue-worker-admin", namespace: "queue" },
        spec: { type: "ClusterIP", clusterIP: "10.96.5.11", selector: { app: "queue-worker" }, ports: [{ name: "admin", port: 9100, targetPort: 9100 }] },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "queue-worker-networking-notes", namespace: "queue" },
        spec: {
          data: {
            "notes.md":
              "Both `queue-worker-public` and `queue-worker-admin` use the identical\nselector `app: queue-worker`, matching all 3 replica pods. Each Service\nhas its own `targetPort` (8080 for public, 9100 for admin) - which is\ncorrect on its own - but every one of queue-worker's pods legitimately\nlistens on *both* ports simultaneously, since it's one process serving\ntwo protocols on two ports. That part works fine for either Service\nindividually. The actual problem: a client library used by internal\ncallers of the admin Service does its own client-side connection pooling\nkeyed only by the Service's ClusterIP - and a recent change deployed a\nsidecar proxy in front of queue-worker's pods that, due to a shared\nUnix-domain-socket misconfiguration, occasionally serves the *public*\nService's connection pool a socket actually backed by the *admin*\nService's target port mapping, and vice versa, whenever both Services'\nEndpoints happen to resolve to the same pod IP in the same connection-\nreuse window.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get svc -n queue -o wide` - both Services select `app: queue-worker` and both resolve to the exact same three pod IPs, just with different ports configured on the Service side.",
    "`kubectl get configmap queue-worker-networking-notes -n queue -o yaml` - what's specifically breaking, given that each Service's own port mapping is individually correct?",
    "The mixing happens at connection-reuse time in a recently-added sidecar proxy layer, not because either Service's own selector or port config is wrong on its own.",
  ],
  options: [
    {
      id: "sidecar-proxy-socket-confusion-across-shared-endpoints",
      label:
        "Both Services correctly select the same pods and each has its own correct `targetPort`, but a recently-deployed sidecar proxy in front of queue-worker's pods has a Unix-domain-socket misconfiguration that occasionally crosses connections between the public and admin target-port mappings whenever both Services' Endpoints resolve to the same pod IP within a reused connection window - producing garbled admin responses when a connection meant for the admin port actually lands on the public one.",
      explanation:
        "`queue-worker-networking-notes` confirms each Service's selector and `targetPort` are individually correct - the issue is specifically the newly-added sidecar proxy's socket handling crossing wires between the two target ports when both Services share the same backing pod IPs, which happens because both Services intentionally select the exact same set of pods (each pod really does serve both ports). This matches the intermittent, roughly-a-third-of-calls symptom, since it depends on connection-pool timing rather than being a consistent misrouting.",
    },
    {
      id: "should-not-share-selector",
      label: "Two Services should never share an identical selector, and that alone is the misconfiguration.",
      explanation:
        "Two Services legitimately sharing a selector while exposing different ports of the same multi-port pods is a normal, supported, and common pattern in Kubernetes (it's exactly how a pod serving multiple protocols on different ports is usually split into separate logical Services) - the actual defect here is the sidecar proxy's own socket-handling bug layered on top, not the shared selector itself.",
    },
    {
      id: "targetport-mismatch-between-services",
      label: "One of the two Services has its `targetPort` set incorrectly, pointing at the wrong container port.",
      explanation:
        "Both Services' `targetPort` values are confirmed individually correct - public at 8080, admin at 9100, matching the container's own named ports exactly. The crossing happens downstream of correct Service-level configuration, inside the sidecar proxy's connection handling.",
    },
    {
      id: "dns-caching-mixing-service-ips",
      label: "DNS caching is causing clients to resolve the admin Service's hostname to the public Service's ClusterIP.",
      explanation:
        "The two Services have distinct, stable ClusterIPs that don't change or get confused with each other at the DNS layer - the crossing described happens at the connection/socket level inside the newly-added sidecar proxy, not in how either Service's hostname resolves.",
    },
  ],
  correctOptionId: "sidecar-proxy-socket-confusion-across-shared-endpoints",
  resolution: `\`queue-worker-networking-notes\` narrows this down precisely: both Services
correctly select the same three pods (by design - each pod really does
serve both a public and an admin port from one process) and each
Service's own \`targetPort\` mapping is individually correct. The actual
defect is in the sidecar proxy deployed three days ago in front of
queue-worker's pods - a Unix-domain-socket misconfiguration that, when
both Services' Endpoints resolve to the same pod IP within a reused
connection-pool window, can occasionally hand a caller a socket backed
by the wrong target port mapping. That's exactly why it's intermittent
(dependent on connection reuse timing) and specific to the admin Service
(whichever side happens to get the crossed socket sees garbled traffic
for its expected protocol).

The fix is correcting the sidecar's socket routing to key strictly by
target port rather than by shared pod identity:

\`\`\`yaml
# sidecar proxy config
listeners:
  - name: public
    socketPath: /var/run/queue-worker/public.sock
    upstreamPort: 8080
  - name: admin
    socketPath: /var/run/queue-worker/admin.sock
    upstreamPort: 9100
\`\`\`

ensuring each listener has its own dedicated, non-shared socket path
tied to a single upstream port, rather than any shared/reused socket that
could be handed out for either port depending on timing. Splitting one
multi-port pod across two logically separate Services is a normal
pattern - the risk here came specifically from introducing a proxy layer
in front of both without keeping their connection paths fully
independent.`,
};
