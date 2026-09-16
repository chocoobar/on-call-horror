import type { Scenario } from "./types";

export const theHeadlessServiceThatWasntHeadless: Scenario = {
  id: "the-headless-service-that-wasnt-headless",
  title: "The Headless Service That Wasn't Headless",
  subtitle: "three Cassandra-style nodes, and every client only ever talks to one of them",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["service", "headless", "dns"],
  briefing: `"graph-store" runs as a 3-node peer cluster where each client is supposed
to discover and connect to all three nodes directly via DNS, for its own
client-side load balancing and failover. Instead, every client - no
matter which pod they were routed to on their first connection - keeps
sending all of its traffic to that same single node, permanently, even
after that node gets busy or restarts.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "graph-store", namespace: "graph", labels: { app: "graph-store" } },
        spec: { replicas: 3, serviceName: "graph-store" },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "graph-store", namespace: "graph" },
        spec: { type: "ClusterIP", clusterIP: "10.96.71.30", selector: { app: "graph-store" }, ports: [{ port: 9042 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "graph-store-client-notes", namespace: "graph" },
        spec: {
          data: {
            "notes.md":
              "graph-store's client library is designed to do its own peer discovery\nand load balancing across all nodes, by resolving the Service's DNS name\nand expecting to get back *every* backing pod's individual IP as\nseparate A records, then connecting to each one directly and\nindependently. A normal ClusterIP Service, however, has `clusterIP` set\nto an actual virtual IP - resolving its DNS name returns just that one\nvirtual IP, which kube-proxy then internally load-balances across pods\nper individual *connection*, not per request. A client that resolves\nonce and holds a single long-lived connection to that one virtual IP\nends up pinned, via kube-proxy's own connection-level load balancing,\nto whichever single pod it was routed to on that first connection - for\nas long as the connection stays open, regardless of how many separate\nnodes actually exist behind the Service.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get svc graph-store -n graph -o yaml` - what's the value of `spec.clusterIP`? Is it a real virtual IP address, or the special value `None`?",
    "`kubectl get configmap graph-store-client-notes -n graph -o yaml` - what does graph-store's client library actually expect DNS resolution of the Service name to return?",
    "A regular ClusterIP Service resolves to one virtual IP and load-balances per-connection at the kube-proxy layer - a client wanting to discover and connect to *every* backing pod individually needs DNS to return every pod's own IP, which only a headless Service (`clusterIP: None`) provides.",
  ],
  options: [
    {
      id: "should-be-headless-service",
      label:
        "graph-store's Service is a normal ClusterIP Service, which resolves to a single virtual IP that kube-proxy load-balances per-connection - but graph-store's client library expects to resolve every individual pod's IP via DNS and connect to each one directly for its own peer discovery and load balancing, which only a headless Service (`clusterIP: None`) actually provides; as a regular ClusterIP Service, every client's long-lived connection gets pinned to whichever single pod it was first routed to, with no way to discover or reach the other nodes at all.",
      explanation:
        "`graph-store-client-notes` explains the exact mismatch: the client library is built around resolving DNS to get back every backing pod's individual IP as separate A records - behavior specific to a headless Service. This Service has a real `clusterIP` (`10.96.71.30`), not `None`, so DNS resolution returns just that one virtual IP, and kube-proxy's own per-connection load balancing pins each client to a single pod for the life of its connection - exactly the observed symptom of every client permanently sticking to one node regardless of that node's health.",
    },
    {
      id: "statefulset-pod-dns-not-configured",
      label: "The StatefulSet's individual pod DNS entries were never properly configured.",
      explanation:
        "A StatefulSet automatically gets per-pod DNS entries (`graph-store-0`, `graph-store-1`, `graph-store-2`, etc.) once paired with a proper headless governing Service - that machinery works out of the box and doesn't need manual configuration; the actual gap is that the Service itself isn't headless, so client-side discovery via the *Service's* own DNS name doesn't behave the way graph-store's client library expects.",
    },
    {
      id: "session-affinity-misconfigured",
      label: "The Service has `sessionAffinity: ClientIP` enabled, pinning clients to one pod.",
      explanation:
        "The Service doesn't set `sessionAffinity` at all (defaulting to `None`) - the pinning being observed isn't from session affinity at the Service level, it's a structural consequence of a long-lived connection to a single resolved ClusterIP being load-balanced once, at connection time, by kube-proxy.",
    },
    {
      id: "graph-store-client-bug",
      label: "graph-store's client library has a bug and isn't actually attempting to reconnect to other nodes.",
      explanation:
        "The client library is working exactly as designed - it just needs DNS to actually return multiple individual pod IPs to have anything to reconnect to or discover in the first place, which the current, non-headless Service configuration never provides regardless of how correctly the client behaves.",
    },
  ],
  correctOptionId: "should-be-headless-service",
  resolution: `\`graph-store-client-notes\` explains the mismatch directly: graph-store's
client library is built to do its own multi-node discovery by resolving
the Service's DNS name and expecting back a separate A record for every
backing pod, then connecting to each independently. That behavior is
specific to a headless Service. This Service, however, has a real
\`clusterIP\` (\`10.96.71.30\`) rather than the special value \`None\` -
resolving its DNS name returns just that single virtual IP, and
kube-proxy load-balances per-connection across the backing pods
internally, invisible to the client. A client holding a long-lived
connection to that one virtual IP stays pinned, via kube-proxy's own
connection-level balancing, to whichever single pod it happened to be
routed to when the connection was first established - exactly the
observed behavior of every client sticking to one node indefinitely.

The fix is making the Service headless, so DNS resolution returns every
individual pod's IP directly, matching what the client library expects:

\`\`\`yaml
apiVersion: v1
kind: Service
metadata:
  name: graph-store
  namespace: graph
spec:
  clusterIP: None
  selector:
    app: graph-store
  ports:
    - port: 9042
\`\`\`

With \`clusterIP: None\`, a DNS lookup for \`graph-store.graph.svc.cluster.local\`
returns an A record per ready pod, letting graph-store's client library
discover and connect to all three nodes directly, exactly as it was
designed to. This is the standard pattern for any peer-discovery-capable
client (Cassandra, etcd, and similar clustered systems) running behind a
Kubernetes Service - a regular ClusterIP Service is the wrong fit
whenever a client needs to see every backing pod individually rather than
being load-balanced transparently.`,
};
