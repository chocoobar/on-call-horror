import type { Scenario } from "../types";

export const hairpinNatLoopbackFailure: Scenario = {
  id: "hairpin-nat-loopback-failure",
  title: "The Call That Couldn't Reach Itself",
  subtitle: "every other caller reaches the Service fine. calls from its own pods to their own Service just hang.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["hairpin-nat", "service", "cni"],
  briefing: `"session-cache" pods were recently updated to call back into their own
Service's ClusterIP (rather than localhost) for a new self-healthcheck
feature meant to validate end-to-end routing. Every other caller reaches
session-cache's Service without any issue. The self-healthcheck calls -
a pod calling its own Service, which happens to route back to that exact
same pod - hang indefinitely.`,
  constraints: [
    "The self-healthcheck call intermittently succeeds when the Service happens to route it to a *different* pod than the one making the call - it only ever hangs when a pod's request loops back to itself.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-cache", namespace: "cache2", labels: { app: "session-cache" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "session-cache-3p4q5r-s6t7u", namespace: "cache2", labels: { app: "session-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "session-cache", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "session-cache": [
            "2026-09-15T10:30:01.010Z INFO  c.e.cache.SelfCheck - probing own Service at session-cache.cache2.svc.cluster.local:6379",
            "2026-09-15T10:30:31.040Z ERROR c.e.cache.SelfCheck - self-healthcheck timed out after 30000ms",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "session-cache", namespace: "cache2" },
        spec: { type: "ClusterIP", clusterIP: "10.96.15.9", selector: { app: "session-cache" }, ports: [{ port: 6379, targetPort: 6379 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "hairpin-nat-notes", namespace: "cache2" },
        spec: {
          data: {
            "notes.md":
              "This cluster's CNI plugin implements Service load-balancing via DNAT\n(destination NAT) - a pod's request to a Service's ClusterIP gets its\ndestination address rewritten to a chosen backend pod's real IP. When\nthe chosen backend happens to be the *same* pod that originated the\nrequest, the packet's source and (post-NAT) destination both end up as\nthat same pod's own IP - a 'hairpin' routing case. Correctly handling\nthis requires the CNI to also apply source NAT (masquerading the source\nas the node's own IP) on hairpinned traffic, so the reply routes back\nthrough the same path rather than the kernel just handing the packet\nback to the same interface it arrived on and getting confused about a\nconnection that appears to originate and terminate at the identical\naddress. This CNI's hairpin-mode/masquerade setting for exactly this\ncase was never enabled on this node pool, which was provisioned with a\ncustom, mostly-default CNI config months before this self-healthcheck\nfeature was ever conceived of needing it.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "The self-healthcheck only fails when a pod's request to the Service happens to route back to that exact same pod - what's structurally different about that specific case versus routing to any of the other replicas?",
    "`kubectl get configmap hairpin-nat-notes -n cache2 -o yaml` - how does this CNI implement Service routing, and what extra step does it need for traffic that loops back to its own origin?",
    "A pod sending a packet to a Service address that then gets DNAT'd back to that same pod's own IP is a classic 'hairpin' routing case - does the CNI's config here actually handle that specific case, or only routing between distinct pods?",
  ],
  options: [
    {
      id: "hairpin-masquerade-not-enabled-on-cni",
      label:
        "This CNI implements Service routing via DNAT, rewriting a request's destination to a chosen backend pod's IP - when that backend happens to be the same pod that sent the request, correctly handling the resulting 'hairpin' case requires also masquerading the source address, which this node pool's CNI configuration never enabled; without it, the loopback packet confuses the kernel's own connection tracking and the request just hangs, exactly matching it only failing when a pod's call routes back to itself and working fine whenever it lands on a different pod.",
      explanation:
        "`hairpin-nat-notes` explains the exact mechanism and confirms hairpin masquerading was never enabled on this specific node pool's CNI configuration. The observed symptom lines up precisely: calls succeed whenever the Service happens to route to a different pod (a normal DNAT case, no hairpin involved) and hang specifically and only when routed back to the originating pod itself (the unhandled hairpin case) - a distinction that wouldn't exist if the problem were anything about the Service or pods generally rather than this one specific routing topology.",
    },
    {
      id: "session-cache-app-deadlock-on-self-call",
      label: "session-cache's own application code deadlocks when handling a request that originated from itself.",
      explanation:
        "The failure is confirmed to be a network-level timeout (the request never appears to be received or answered at all within 30 seconds) rather than an application-level deadlock producing some kind of response or observable hang inside the app itself - and the pattern (succeeding for other pods, failing only for self-routed calls) points at the routing path, not application logic that's identical regardless of which pod is called.",
    },
    {
      id: "service-selector-excludes-originating-pod",
      label: "The Service's selector somehow excludes the pod that's making the self-healthcheck call from its own Endpoints.",
      explanation:
        "All 3 pods are confirmed healthy and included as valid Endpoints for the Service (evidenced by calls succeeding whenever routed to any pod, including implicitly this one when called by a different pod) - the selector isn't excluding anything; the issue is specific to the network path taken when a pod's own request happens to be routed back to itself.",
    },
    {
      id: "targetport-firewalled-locally",
      label: "The pod's own local firewall (iptables rules inside the container) blocks inbound traffic on its own targetPort.",
      explanation:
        "There's no pod-local firewall configuration described or indicated here, and this failure mode is specifically and consistently tied to the hairpin routing case (self-to-self via the Service) rather than any general inbound restriction, which would also block traffic from other pods reaching this one - which isn't observed at all.",
    },
  ],
  correctOptionId: "hairpin-masquerade-not-enabled-on-cni",
  resolution: `\`hairpin-nat-notes\` explains the underlying mechanism: this CNI
implements Kubernetes Service routing via DNAT, rewriting a request's
destination address from the Service's ClusterIP to a chosen backend
pod's real IP. When that chosen backend happens to be the very pod that
sent the request, the resulting packet has both its source and
(post-DNAT) destination pointing at the same pod's own IP - a hairpin
routing case that needs the CNI to also masquerade the source address so
the kernel's connection tracking doesn't get confused about a connection
that appears to both originate and terminate at the identical address.
This node pool's CNI configuration never enabled that hairpin/masquerade
handling, since it was provisioned months before this self-healthcheck
feature (the first thing to actually exercise self-to-self Service
calls) was ever conceived. That's exactly why the failure is isolated to
only the self-routed case: any call that happens to land on a different
pod is a completely ordinary DNAT case that's always worked fine.

The fix is enabling hairpin/masquerade handling in the CNI's own
configuration for this node pool - the specific mechanism depends on the
CNI in use, but for a common case like Calico or a kube-proxy iptables
setup:

\`\`\`bash
# kube-proxy iptables mode: ensure hairpin masquerading is on
# (usually via --masquerade-all or the CNI's own hairpin-mode setting)
kubectl -n kube-system edit configmap kube-proxy-config
# set: iptables.masqueradeAll: true
\`\`\`

or, for a CNI with its own dedicated setting (e.g. Calico's
\`FELIX_INTERFACE_PREFIX\`/masquerade rules, or the kubelet's own
\`--hairpin-mode\` flag on older setups), enabling the equivalent
hairpin-NAT option there. This is a well-known edge case for any pod
that needs to call back into its own Service - it's easy to miss in a
CNI configuration that was otherwise working perfectly for every normal,
pod-to-different-pod routing scenario until something specifically
needed the self-referential path.`,
};
