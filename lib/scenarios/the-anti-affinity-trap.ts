import type { Scenario } from "./types";

export const theAntiAffinityTrap: Scenario = {
  id: "the-anti-affinity-trap",
  title: "The Anti-Affinity Trap",
  subtitle: "auth-service can't scale past 4 replicas since last week's node pool downsize",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "affinity", "scheduling"],
  briefing: `"auth-service" was scaled from 4 to 6 replicas ahead of an expected
traffic increase. Four pods are Running. The other two have been Pending
ever since - not for a few seconds, indefinitely.`,
  constraints: [
    "The cluster overall has free CPU and memory capacity - this isn't a general resource shortage.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "auth-service", namespace: "auth", labels: { app: "auth-service" } },
        spec: {
          replicas: 6,
          template: {
            spec: {
              affinity: {
                podAntiAffinity: {
                  requiredDuringSchedulingIgnoredDuringExecution: [
                    { labelSelector: { matchLabels: { app: "auth-service" } }, topologyKey: "kubernetes.io/hostname" },
                  ],
                },
              },
              containers: [{ name: "auth-service", image: "registry.internal/auth-service:4.0.1" }],
            },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 6, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "auth-service-5e6f7g8h9-i0j1k", namespace: "auth", labels: { app: "auth-service" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "10m", message: "0/4 nodes are available: 4 node(s) didn't satisfy existing pods anti-affinity rules." },
        ],
        age: "15m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nodepool-notes", namespace: "auth" },
        spec: {
          data: {
            "notes.md":
              "Nodepool was downsized from 6 nodes to 4 nodes last week as a cost\noptimization - considered safe at the time since overall CPU/memory\nutilization was well under 50%.\n",
          },
        },
        age: "6d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod auth-service-5e6f7g8h9-i0j1k -n auth` - the FailedScheduling message is specifically about anti-affinity, not resources.",
    "`kubectl get deployment auth-service -n auth -o yaml` - look at `affinity.podAntiAffinity`, specifically `topologyKey` and whether it's `required` or `preferred`.",
    "`requiredDuringSchedulingIgnoredDuringExecution` with `topologyKey: kubernetes.io/hostname` means: no two pods matching this selector may ever share the same node, as a hard requirement. How many nodes does the cluster have now, versus how many replicas want to run?",
  ],
  options: [
    {
      id: "hard-anti-affinity-exceeds-node-count",
      label:
        "auth-service has a hard (`required`) pod anti-affinity rule that forbids two of its pods from ever sharing a node - which worked fine with 6 nodes for 6 replicas, but last week's downsize to 4 nodes means at most 4 replicas can ever be scheduled at once, no matter how much free capacity exists on those nodes.",
      explanation:
        "The event's wording - \"didn't satisfy existing pods anti-affinity rules\" - is specific to anti-affinity, not a resource shortage, and the Deployment's `requiredDuringSchedulingIgnoredDuringExecution` rule with `topologyKey: kubernetes.io/hostname` is a hard one-pod-per-node constraint. `nodepool-notes` confirms the cluster went from 6 nodes to 4 last week. With a hard one-per-node rule, exactly 4 pods can ever run at once regardless of how much spare CPU or memory those 4 nodes have - the 5th and 6th replicas have no node left that doesn't already have a pod matching the anti-affinity selector on it.",
    },
    {
      id: "not-enough-resources",
      label: "The remaining 4 nodes don't have enough resources to fit 6 replicas.",
      explanation:
        "Overall cluster utilization is confirmed well under 50%, and the scheduling failure message specifically cites unsatisfied anti-affinity rules, not insufficient CPU or memory - resource capacity isn't the constraint here at all.",
    },
    {
      id: "deployment-max-surge-too-low",
      label: "The Deployment's rolling update `maxSurge` setting is too conservative to allow scaling up.",
      explanation:
        "`maxSurge` governs how many *extra* pods can exist temporarily during a rolling update of existing pods - this is a scale-up to a higher replica count, not a rolling update, and the new pods are failing to schedule at all, not being throttled by a surge limit.",
    },
    {
      id: "image-pull-rate-limited",
      label: "The container registry is rate-limiting image pulls for the new replicas.",
      explanation:
        "The new pods are stuck in `Pending` and haven't been assigned to a node at all - image pulling only happens after a pod is scheduled onto a node, so a registry rate limit couldn't be the cause of a pod that never gets that far.",
    },
  ],
  correctOptionId: "hard-anti-affinity-exceeds-node-count",
  resolution: `The event's specific wording - "didn't satisfy existing pods
anti-affinity rules" - points straight at the Deployment's own
\`podAntiAffinity\` config: a *hard* rule
(\`requiredDuringSchedulingIgnoredDuringExecution\`) forbidding two
auth-service pods from ever sharing a node, keyed on
\`kubernetes.io/hostname\`. That's a strict one-pod-per-node ceiling. It was
invisible as a constraint back when the cluster had 6 nodes for 6
replicas - one pod per node fit perfectly. \`nodepool-notes\` confirms the
node count dropped to 4 last week as a cost optimization, evaluated purely
on CPU/memory utilization headroom, without anyone considering how it
interacted with this Deployment's scheduling rule. With only 4 nodes and
a hard one-per-node requirement, a 5th or 6th replica has no legal node to
land on no matter how idle those 4 nodes are - "spare capacity" doesn't
help when the constraint isn't about capacity at all.

Two ways to resolve it, depending on intent. If the anti-affinity rule's
goal - spreading pods for resilience - still matters more than hitting the
exact replica count, soften it to a preference instead of a hard
requirement:

\`\`\`yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector: { matchLabels: { app: auth-service } }
          topologyKey: kubernetes.io/hostname
\`\`\`

which lets the scheduler double up on a node only when there's truly no
alternative, instead of refusing outright. Otherwise, the nodepool needs
to go back to at least 6 nodes to honor the hard rule at the desired
replica count. Either way, a hard anti-affinity rule and a nodepool size
are coupled decisions - changing one without checking the other is exactly
how a "safe," utilization-based downsize silently caps how far a
Deployment can ever scale.`,
};
