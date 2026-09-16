import type { Scenario } from "../types";

export const theNodeLocalDnsCacheStale: Scenario = {
  id: "the-node-local-dns-cache-stale",
  title: "The Node-Local Cache That Didn't Get The Memo",
  subtitle: "the Service exists now. pods on exactly one node still insist it doesn't",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "nodelocaldns", "caching"],
  briefing: `A brand-new internal service, "feature-flags," was created twenty minutes
ago. Every pod across the cluster resolves and reaches it fine, except
for pods scheduled on one specific node, "node-7," which get DNS
resolution failures for its hostname consistently, even now.`,
  constraints: [
    "A pod freshly scheduled onto node-7 right now still fails to resolve feature-flags's hostname, ruling out a one-time timing fluke.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "feature-flags", namespace: "platform3", labels: { app: "feature-flags" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "feature-flags", namespace: "platform3" },
        spec: { type: "ClusterIP", clusterIP: "10.96.80.15", selector: { app: "feature-flags" }, ports: [{ port: 80 }] },
        age: "19m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-worker-node7-a1b2c3", namespace: "checkout", labels: { app: "checkout-worker" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-worker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "checkout-worker": [
            "2026-09-15T12:20:01.010Z ERROR c.e.checkout.FeatureFlagClient - java.net.UnknownHostException: feature-flags.platform3.svc.cluster.local",
          ],
        },
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nodelocaldns-notes", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "This cluster runs NodeLocalDNS - a DNS caching agent as a DaemonSet on\nevery node, intercepting pod DNS queries locally before they'd otherwise\ngo to cluster CoreDNS, to reduce load and latency. Each node's\nNodeLocalDNS instance maintains its own independent negative-response\ncache, separate from CoreDNS's own cache. node-7's NodeLocalDNS pod\nhappened to receive a query for `feature-flags`'s hostname moments\nbefore the Service was actually created (from an unrelated speculative\nhealth-check probe), cached the resulting NXDOMAIN with a longer\nnegative-cache TTL than this NodeLocalDNS build's default due to a\ncluster-wide override applied months ago for an unrelated stability fix,\nand has kept serving that stale negative answer to every pod on node-7\never since - independent of CoreDNS's own, already-correct view, and\nindependent of every other node's own NodeLocalDNS cache, which never\nhappened to receive that same unlucky early query.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "This is isolated to exactly one node, not one namespace or one pod's own age - what runs per-node that could cache a DNS answer independently from the rest of the cluster?",
    "`kubectl get configmap nodelocaldns-notes -n kube-system -o yaml` - does this cluster run a node-local DNS caching layer, and does each node maintain its own separate cache?",
    "A pod freshly scheduled onto node-7 right now *still* fails - so this isn't about when any particular pod started, it's about something cached at the node level itself, unrelated to pod age.",
  ],
  options: [
    {
      id: "node7-nodelocaldns-cached-negative-response",
      label:
        "node-7's NodeLocalDNS instance happened to receive and cache a negative (NXDOMAIN) response for feature-flags's hostname moments before the Service was actually created, and a cluster-wide negative-cache TTL override applied months ago for an unrelated fix makes that cached failure long-lived - every pod on node-7, regardless of when it started, gets served that same stale cached failure from node-7's own independent cache, while every other node's NodeLocalDNS instance, never having received that same unlucky early query, answers correctly.",
      explanation:
        "`nodelocaldns-notes` explains the per-node caching architecture directly: each node's NodeLocalDNS instance maintains its own independent cache, separate from CoreDNS and from every other node's own cache. node-7's instance specifically cached an early NXDOMAIN before the Service existed, with an extended negative-cache TTL from a prior, unrelated cluster-wide config change keeping that stale answer alive well past when it should have expired. This matches the failure being tied strictly to which *node* a pod runs on (confirmed by a freshly-scheduled pod on node-7 still failing) rather than to any pod's own age or namespace.",
    },
    {
      id: "coredns-hasnt-propagated-to-node7",
      label: "CoreDNS itself hasn't propagated the new Service to node-7 specifically.",
      explanation:
        "CoreDNS's own view of the cluster is backed live by the Kubernetes API and isn't scoped or partitioned per node - it doesn't have a separate, node-specific state that could be stale for just one node. The node-specific staleness points instead at a caching layer that genuinely does maintain independent per-node state, which is exactly what NodeLocalDNS does.",
    },
    {
      id: "node7-has-a-different-kubelet-version",
      label: "node-7 is running an outdated kubelet version with a DNS-related bug.",
      explanation:
        "There's no indication of a kubelet version difference, and DNS resolution behavior isn't something the kubelet itself directly governs - it's handled by whatever DNS resolution/caching stack runs on the node (here, NodeLocalDNS), which is exactly where the actual, confirmed staleness lives.",
    },
    {
      id: "feature-flags-endpoints-not-populated-on-node7",
      label: "feature-flags's Endpoints object hasn't been populated with pod IPs reachable from node-7 specifically.",
      explanation:
        "Endpoints objects aren't scoped or filtered per node - every node sees the identical, cluster-wide Endpoints list for a given Service. The failure here is a DNS resolution failure (`UnknownHostException`) happening before any connection or Endpoints lookup would even be relevant, consistent with a caching issue at the name-resolution layer, not an Endpoints population issue.",
    },
  ],
  correctOptionId: "node7-nodelocaldns-cached-negative-response",
  resolution: `\`nodelocaldns-notes\` explains the architecture behind this: NodeLocalDNS
runs as a DaemonSet, with each node maintaining its own independent DNS
cache - separate from CoreDNS's own cache and from every other node's
NodeLocalDNS instance. node-7's instance happened to receive a query for
feature-flags's hostname (from an unrelated speculative health-check
probe) just moments before the Service was actually created, cached the
resulting NXDOMAIN, and - due to a cluster-wide negative-cache TTL
override applied months ago for an unrelated stability fix - has kept
that stale negative answer alive far longer than NodeLocalDNS's own
default would normally allow. Every pod scheduled on node-7 since then,
regardless of its own age, gets served that same cached failure from
node-7's own local cache, while every other node's independent cache,
never having received that same unlucky early query, answers correctly
- exactly matching the failure being tied strictly to which node a pod
lands on.

The fix for the immediate incident is clearing node-7's NodeLocalDNS
cache directly:

\`\`\`bash
kubectl delete pod -n kube-system -l k8s-app=node-local-dns --field-selector spec.nodeName=node-7
# NodeLocalDNS DaemonSet pod restarts with a clean cache on node-7
\`\`\`

More durably, it's worth revisiting the cluster-wide extended negative-
cache TTL override from the earlier stability fix - a long negative-cache
TTL trades faster recovery from exactly this kind of transient early-
query race for reduced load from repeated failed lookups, and the
tradeoff is worth reconsidering now that it's caused a real, if narrow,
outage. This is also a good case for adding a lightweight periodic health
check on NodeLocalDNS's own cache correctness per node, since this class
of single-node DNS staleness is easy to miss - it looks, from most
dashboards, like an isolated, unrelated pod-level failure rather than a
node-level caching issue.`,
};
