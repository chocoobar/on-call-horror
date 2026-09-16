import type { Scenario } from "../types";

export const nodeportCalledFromInsideCluster: Scenario = {
  id: "nodeport-called-from-inside-cluster",
  title: "NodePort Called From Inside The Cluster",
  subtitle: "an internal caller was given the NodePort URL, and it works... about a third of the time",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["service", "nodeport", "clusterip"],
  briefing: `"audit-log-writer" was recently pointed at "ledger-svc" using a NodePort
address a teammate copied from a runbook meant for external debugging. It
works sometimes and times out other times, with no obvious pattern -
roughly consistent with how many nodes are in the cluster at any given
moment.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ledger-svc", namespace: "ledger", labels: { app: "ledger-svc" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "9d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "ledger-svc", namespace: "ledger", labels: { app: "ledger-svc" } },
        spec: {
          type: "NodePort",
          clusterIP: "10.96.20.5",
          selector: { app: "ledger-svc" },
          ports: [{ port: 8080, targetPort: 8080, nodePort: 31890 }],
          externalTrafficPolicy: "Cluster",
        },
        age: "9d",
      },
      {
        apiVersion: "v1",
        kind: "Deployment",
        metadata: { name: "audit-log-writer", namespace: "audit", labels: { app: "audit-log-writer" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "audit-log-writer-9f8e7d-p1q2r", namespace: "audit", labels: { app: "audit-log-writer" } },
        status: { phase: "Running", containerStatuses: [{ name: "audit-log-writer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "audit-log-writer": [
            "2026-09-15T11:00:01.020Z INFO  c.e.audit.LedgerClient - target configured: node-3.internal:31890",
            "2026-09-15T11:00:31.050Z ERROR c.e.audit.LedgerClient - connect timed out: node-3.internal:31890",
            "2026-09-15T11:01:31.070Z INFO  c.e.audit.LedgerClient - write succeeded after retry against node-3.internal:31890",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cluster-node-notes", namespace: "audit" },
        spec: {
          data: {
            "notes.md":
              "This cluster has 3 worker nodes (node-1, node-2, node-3). A NodePort\nService opens the given port on *every* node, and kube-proxy forwards\nany connection that lands on that port to a pod backing the Service -\nregardless of whether that specific node happens to be running one of\nthe Service's pods. ledger-svc currently has 2 replicas, scheduled on\nnode-1 and node-2 only; node-3 has no local kube-proxy issue, but audit-\nlog-writer is hardcoded to always call node-3's NodePort specifically,\nand nothing about a NodePort's own behavior guarantees any particular\nnode stays reachable or that traffic that lands there gets forwarded\nquickly under load.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get svc ledger-svc -n ledger -o yaml` - what type is this Service, and what's it meant for?",
    "audit-log-writer is calling `node-3.internal:31890` specifically, every time, from inside the same cluster ledger-svc lives in. Is there a more direct way for a pod to reach a Service it shares a cluster with?",
    "A NodePort exists so *external* traffic has a fixed port to hit on any node - it's not the intended way for one pod to call another pod's Service from inside the same cluster, where ClusterIP or the Service's DNS name works directly and consistently.",
  ],
  options: [
    {
      id: "should-use-clusterip-dns-not-nodeport",
      label:
        "audit-log-writer is calling ledger-svc's NodePort (`node-3.internal:31890`) from inside the very cluster the Service lives in - NodePort is meant for external access and routes through a specific node's kube-proxy, which adds an unnecessary, less reliable hop; it should be calling the Service directly via its ClusterIP or DNS name (`ledger-svc.ledger.svc.cluster.local:8080`), which is the standard, reliable path for in-cluster calls and isn't dependent on any specific node being up or fast to forward.",
      explanation:
        "`cluster-node-notes` lays out exactly why this is fragile: audit-log-writer always targets `node-3.internal` specifically, and a NodePort's reliability for any given node depends on that node being reachable and its kube-proxy promptly forwarding to a pod that may well be scheduled on a completely different node. Calling the Service's ClusterIP or DNS name instead routes directly through the Service's own virtual IP with no dependency on a specific node at all - the standard, intended way for one in-cluster caller to reach another.",
    },
    {
      id: "ledger-svc-pods-flapping",
      label: "ledger-svc's pods are flapping/restarting, causing intermittent availability.",
      explanation:
        "ledger-svc's Deployment shows 2/2 ready replicas with no restart activity mentioned - the intermittent failures are tied to which node is targeted and its forwarding behavior, not to the backing pods themselves cycling.",
    },
    {
      id: "nodeport-range-conflict",
      label: "Another Service on the cluster is also using NodePort 31890, causing conflicts.",
      explanation:
        "Kubernetes enforces NodePort uniqueness at allocation time - two Services can't share the same NodePort number, so a port conflict wouldn't be possible here. The Service in question was successfully allocated port 31890 and keeps it exclusively.",
    },
    {
      id: "audit-log-writer-retry-logic-broken",
      label: "audit-log-writer's retry logic itself is broken and racing against a normal, short-lived timeout.",
      explanation:
        "The logs show a legitimate connect timeout followed by a successful retry - the retry logic is working as intended and recovering. The underlying issue is why the first attempt against this specific node's NodePort times out at all, not a bug in the retry mechanism itself.",
    },
  ],
  correctOptionId: "should-use-clusterip-dns-not-nodeport",
  resolution: `\`cluster-node-notes\` spells out the mismatch: ledger-svc is a NodePort
Service, currently with 2 replicas scheduled on node-1 and node-2 only.
A NodePort opens the given port on *every* node in the cluster and relies
on that node's kube-proxy to forward the connection on to a pod backing
the Service, wherever that pod actually happens to be running - useful
for letting external traffic reach the cluster via any node's address,
but an unnecessary and less reliable extra hop for traffic that's already
inside the cluster. audit-log-writer is hardcoded to always call
\`node-3.internal:31890\` specifically, and nothing about that guarantees
node-3 stays fast or reliable to forward through - hence the intermittent
timeouts that don't correlate with anything wrong on ledger-svc's own
pods.

The fix is calling the Service directly instead of routing through any
one node's NodePort:

\`\`\`yaml
# audit-log-writer's config
LEDGER_TARGET: "ledger-svc.ledger.svc.cluster.local:8080"
\`\`\`

For in-cluster callers, a Service's ClusterIP or DNS name is always the
right target - it's stable, load-balances correctly across every backing
pod regardless of node placement, and has no dependency on any specific
node's availability. NodePort (and LoadBalancer, which is built on top of
it) exists specifically for traffic originating from *outside* the
cluster.`,
};
