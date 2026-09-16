import type { Scenario } from "./types";

export const theTopologyAwareHintsFailure: Scenario = {
  id: "the-topology-aware-hints-failure",
  title: "The Topology-Aware Hints Failure",
  subtitle: "one zone's replicas of pricing-api are getting hammered while the other two idle",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "service", "topology"],
  briefing: `"pricing-api" runs 9 replicas, evenly spread 3 per zone via
topologySpreadConstraints - confirmed genuinely even right now. Despite
that, one zone's 3 replicas are running hot (high CPU, elevated latency)
while the other two zones' replicas sit comfortably idle. Traffic isn't
naturally skewed - the load balancer's own request counts per zone look
close to even.`,
  constraints: [
    "Pod distribution across zones is confirmed genuinely even (3/3/3) right now - this isn't a repeat of an uneven-spread problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "pricing-api", namespace: "pricing", annotations: { "service.kubernetes.io/topology-mode": "Auto" } },
        spec: { selector: { app: "pricing-api" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "3mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-api", namespace: "pricing", labels: { app: "pricing-api" } },
        spec: {
          replicas: 9,
          template: { spec: { topologySpreadConstraints: [{ maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "DoNotSchedule", labelSelector: { matchLabels: { app: "pricing-api" } } }], containers: [{ name: "pricing-api", image: "registry.internal/pricing-api:7.0.0" }] } },
        },
        status: { readyReplicas: 9, updatedReplicas: 9, availableReplicas: 9 },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "topology-hints-traffic-notes", namespace: "pricing" },
        spec: {
          data: {
            "notes.md":
              "pricing-api's Service has topology-aware routing enabled\n(`service.kubernetes.io/topology-mode: Auto`), which biases kube-proxy\ntoward keeping traffic within the same zone it originated in, to reduce\ncross-zone data transfer cost and latency - EndpointSlices carry\nper-zone routing `hints` for exactly this. This generally works well\nwhen *client* traffic itself is roughly evenly distributed per zone.\nBut the ingress/load-balancer layer sitting in front of pricing-api\ndistributes *inbound internet* traffic evenly across zones by round-robin\nat its own edge, independent of where callers geographically are - and\na disproportionate share of pricing-api's actual traffic comes from an\ninternal batch reporting job that always runs from pods physically\nlocated in one specific zone, generating zone-local traffic that\ntopology-aware routing correctly keeps local rather than spreading\nacross all 9 backend replicas evenly. The load balancer's own\nzone-level request counts look even because they only measure requests\nit distributes itself, not the batch job's zone-local traffic added on\ntop.\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get service pricing-api -n pricing -o yaml` - check `service.kubernetes.io/topology-mode`. What does topology-aware routing actually optimize for?",
    "The load balancer's own numbers only capture the traffic *it* distributes - is there any traffic reaching pricing-api that doesn't go through it at all?",
    "`kubectl get configmap topology-hints-traffic-notes -n pricing -o yaml` - is there a source of traffic that's naturally concentrated in one specific zone?",
  ],
  options: [
    {
      id: "topology-aware-routing-plus-zone-local-batch-traffic",
      label:
        "pricing-api's Service has topology-aware routing enabled, which correctly keeps same-zone traffic local to reduce cross-zone cost/latency - but a substantial share of its real traffic comes from an internal batch reporting job that always runs from one specific zone, and topology-aware routing correctly routes that zone-local traffic to that zone's own 3 replicas rather than spreading it across all 9, concentrating real load onto one-third of the fleet even though pod distribution and the load balancer's own even zone-level counts (which don't include the batch job's traffic) both look completely even.",
      explanation:
        "`topology-hints-traffic-notes` explains exactly what the load balancer's own even-looking numbers miss: they only measure traffic the load balancer itself distributes, not the batch reporting job's traffic, which originates and stays entirely zone-local by design once topology-aware routing is doing its job correctly. The mechanism is topology-aware routing working exactly as intended - keeping same-zone traffic same-zone - applied to a traffic source that isn't evenly distributed to begin with, which produces real, uneven per-zone load despite genuinely even pod placement and genuinely even load-balancer-originated traffic.",
    },
    {
      id: "topology-spread-constraint-actually-uneven",
      label: "The topologySpreadConstraint isn't actually producing an even pod distribution despite appearing to.",
      explanation:
        "The scenario explicitly confirms pod distribution is genuinely even (3/3/3) right now, verified directly - the imbalance is in *traffic per replica*, not in how many replicas exist per zone, which points at something about routing or traffic sourcing rather than pod placement.",
    },
    {
      id: "one-zone-nodes-underpowered",
      label: "The nodes in the hot zone have less CPU capacity than nodes in the other two zones.",
      explanation:
        "There's no indication of a node-capacity or hardware difference between zones - the imbalance is specifically about how much *traffic* each zone's replicas receive, which is a routing/traffic-distribution question, not a per-node compute capacity difference.",
    },
    {
      id: "readiness-probe-flapping-in-two-zones",
      label: "Replicas in the two idle zones are failing readiness checks intermittently, routing traffic away from them.",
      explanation:
        "All 9 replicas are confirmed `Ready` and `Available` - there's no readiness instability removing endpoints from rotation in any zone. The idle zones' replicas are healthy and simply receiving less traffic by design, not being excluded due to failing health checks.",
    },
  ],
  correctOptionId: "topology-aware-routing-plus-zone-local-batch-traffic",
  resolution: `\`topology-hints-traffic-notes\` explains the gap between what the load
balancer's numbers show and what's actually happening: those numbers
only capture traffic the load balancer itself distributes, evenly, by
round-robin across zones. Layered on top of that is a substantial,
separate traffic source - an internal batch reporting job - that always
runs from pods physically located in one specific zone. pricing-api's
Service has topology-aware routing enabled (\`topology-mode: Auto\`),
which is deliberately designed to keep same-zone traffic routed to
same-zone backends, reducing cross-zone data transfer cost and latency -
and it's doing exactly that correctly for the batch job's traffic,
concentrating a disproportionate share of real load onto that one zone's
3 replicas rather than spreading it across all 9. Pod distribution is
genuinely even, and load-balancer-originated traffic is genuinely even -
it's a real, additional traffic source invisible to the load balancer's
own metrics that's driving the imbalance.

This is a genuine tradeoff inherent to topology-aware routing, not a
misconfiguration to simply undo - the fix depends on what matters more.
If the batch job's cross-zone cost/latency reduction is worth the uneven
load, the actual fix is capacity planning for it: either give the hot
zone extra headroom (more replicas or beefier nodes specifically there),
or move/spread the batch job's own execution across zones so its
zone-local traffic distributes more evenly too. If topology-aware
routing's benefit doesn't outweigh the load imbalance it's causing here,
disabling it for this specific Service removes the zone-affinity
behavior entirely, trading away the cross-zone optimization for more
even load distribution:

\`\`\`yaml
metadata:
  annotations:
    service.kubernetes.io/topology-mode: "Disabled"   # was: Auto
\`\`\`

Either way, the key realization worth documenting is that "traffic looks
even" needs to be measured at every layer that actually influences
routing - a load balancer's own request counts don't capture
traffic sources that bypass it or interact with topology-aware routing
differently, like this internal batch job does.`,
};
