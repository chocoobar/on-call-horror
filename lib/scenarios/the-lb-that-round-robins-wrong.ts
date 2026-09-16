import type { Scenario } from "./types";

export const theLbThatRoundRobinsWrong: Scenario = {
  id: "the-lb-that-round-robins-wrong",
  title: "The Load Balancer That Round-Robins Wrong",
  subtitle: "four identical pods. one of them is doing four times the work.",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["load-balancer", "weighted-routing", "traffic-distribution"],
  briefing: `"image-resizer" runs four identical replicas behind a cloud LoadBalancer
Service. CPU graphs show one pod consistently running two to three times
hotter than the other three, to the point it's the only one ever getting
throttled. Nobody changed the Deployment's resource requests or replica
count recently.`,
  constraints: [
    "All four pods are running the identical image and identical resource requests/limits - confirmed by diffing their pod specs.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "image-resizer", namespace: "media2", labels: { app: "image-resizer" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "image-resizer",
          namespace: "media2",
          annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-target-group-attributes": "load_balancing.algorithm.type=weighted_random",
          },
        },
        spec: { type: "LoadBalancer", selector: { app: "image-resizer" }, ports: [{ port: 443, targetPort: 8443 }] },
        status: { loadBalancer: { ingress: [{ hostname: "abcd1234.elb.us-east-1.amazonaws.com" }] } },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "target-group-notes", namespace: "media2" },
        spec: {
          data: {
            "notes.md":
              "The ALB target group behind image-resizer's LoadBalancer Service has a\nper-target 'weight' attribute, which by default is 1 for every\nregistered target - but one target (the pod currently scheduled on\nnode-2) was manually set to weight 5 several weeks ago during a one-off\nload test, and that override was never reverted. A weighted-random\nload-balancing algorithm sends traffic to each target in proportion to\nits configured weight, so that one target now receives roughly 5x the\ntraffic share of any of the other three targets, which still sit at the\ndefault weight of 1.\n",
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "All four pods are confirmed identical in spec - so whatever's causing the imbalance has to live outside the pods themselves, at the load-balancing layer.",
    "`kubectl get configmap target-group-notes -n media2 -o yaml` - does every target in the load balancer's target group have the same weight?",
    "A weighted-random (or weighted round-robin) algorithm distributes traffic in proportion to each target's configured weight, not evenly by default - a leftover manual override on just one target would keep skewing its share indefinitely.",
  ],
  options: [
    {
      id: "leftover-weight-override-from-load-test",
      label:
        "One target in the ALB's target group was manually set to weight 5 during an old load test and never reverted, while the other three targets remain at the default weight of 1 - with the target group's weighted-random algorithm, that one target now receives roughly five times the traffic share of any other pod, explaining the persistent, disproportionate CPU load on exactly one of four otherwise-identical replicas.",
      explanation:
        "`target-group-notes` confirms the leftover weight override directly: one target stuck at weight 5 from an old load test, versus the default weight of 1 on the other three. Since all four pods are confirmed identical in spec, and the load balancer uses a weighted-random algorithm that distributes traffic proportionally to weight, this fully explains the sustained, disproportionate load on exactly one pod with no application-level difference at all.",
    },
    {
      id: "one-pod-on-slower-node",
      label: "The hot pod happens to be scheduled on a slower or resource-constrained node.",
      explanation:
        "All four pods run identical resource requests and limits, and there's no indication of node-level resource contention - the imbalance is in how much *traffic* one pod receives, not in how capable its node is of handling a normal, evenly-distributed share.",
    },
    {
      id: "session-affinity-enabled",
      label: "Session affinity (sticky sessions) is pinning a disproportionate number of clients to one pod.",
      explanation:
        "There's no session affinity configuration on this Service or its target group - and the target group's own weight configuration already fully explains the skew, proportional to the leftover weight-5 override on one specific target rather than any session-pinning behavior.",
    },
    {
      id: "dns-caching-favoring-one-ip",
      label: "Client-side DNS caching is causing most clients to resolve to one pod's IP directly.",
      explanation:
        "Clients connect to the LoadBalancer's own hostname, not directly to any individual pod IP - DNS resolution for the load balancer itself has no bearing on which backend target it internally routes a given connection to, which is governed entirely by the target group's own weighted algorithm.",
    },
  ],
  correctOptionId: "leftover-weight-override-from-load-test",
  resolution: `\`target-group-notes\` explains the imbalance precisely: during an old load
test, one target in the ALB's target group was manually bumped to weight
5 to intentionally concentrate traffic on it for testing purposes - and
that override was simply never reverted afterward. The other three
targets sit at the default weight of 1. With the target group configured
for a weighted-random load-balancing algorithm, traffic is distributed
in proportion to each target's weight, meaning the overridden target now
receives roughly five times the traffic share of any of its three
identical siblings - fully explaining the sustained, disproportionate CPU
load with nothing different about the pod itself.

The fix is resetting the target's weight back to the default, matching
every other target in the group:

\`\`\`bash
aws elbv2 modify-target-group-attributes \\
  --target-group-arn <arn> \\
  --attributes Key=load_balancing.algorithm.type,Value=weighted_random

# and per-target weight reset via target registration:
aws elbv2 register-targets --target-group-arn <arn> \\
  --targets Id=<hot-target-id>,Port=8443,AvailabilityZone=all
\`\`\`

(registering a target again without an explicit weight resets it to the
group's default). Worth treating any manual load-balancer weight override
made for a one-off test as something that needs an explicit, tracked
follow-up to revert - it leaves no trace in the Kubernetes Service or
Deployment objects at all, only in the cloud load balancer's own
target-group configuration.`,
};
