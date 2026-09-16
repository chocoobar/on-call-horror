import type { Scenario } from "./types";

export const theVpaOomLoop: Scenario = {
  id: "the-vpa-oom-loop",
  title: "The VPA OOM Loop",
  subtitle: "inference-cache gets OOMKilled, VPA \"fixes\" it, and it gets OOMKilled again, in an endless cycle",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "vpa", "oom"],
  briefing: `"inference-cache" has a VerticalPodAutoscaler in \`Auto\` mode meant to
keep its memory request tuned to actual usage. For the last several
hours it's been stuck in a cycle: OOMKilled, VPA bumps the memory
request, pod restarts, runs fine briefly, OOMKilled again - each time at
a slightly higher memory ceiling than the last, never actually
stabilizing.`,
  constraints: [
    "There's no memory leak in the traditional sense - each individual pod's memory usage plateaus rather than growing unboundedly right up until the kill.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inference-cache", namespace: "ml-serving", labels: { app: "inference-cache" } },
        spec: { replicas: 1, template: { spec: { containers: [{ name: "inference-cache", image: "registry.internal/inference-cache:3.0.0", resources: { requests: { memory: "2Gi" }, limits: { memory: "2Gi" } } }] } } },
        status: { readyReplicas: 0, updatedReplicas: 1, availableReplicas: 0 },
        age: "6mo",
      },
      {
        apiVersion: "autoscaling.k8s.io/v1",
        kind: "VerticalPodAutoscaler",
        metadata: { name: "inference-cache-vpa", namespace: "ml-serving" },
        spec: { targetRef: { kind: "Deployment", name: "inference-cache" }, updatePolicy: { updateMode: "Auto" } },
        status: { recommendation: { containerRecommendations: [{ containerName: "inference-cache", target: { memory: "2.6Gi" }, lowerBound: { memory: "1.8Gi" }, upperBound: { memory: "2.6Gi" } }] } },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "inference-cache-3q4r5s6t7", namespace: "ml-serving", labels: { app: "inference-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "inference-cache", ready: false, restartCount: 6, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }] },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inference-cache-design-notes", namespace: "ml-serving" },
        spec: {
          data: {
            "notes.md":
              "inference-cache maintains an in-process LRU model cache sized as a\n*percentage of available container memory* (85%) rather than a fixed\nabsolute size - a design intended to make good use of however much\nmemory it's given. Every time VPA raises the memory request/limit\nfollowing an OOM, the app sees more \"available\" memory on its next\nstart and correspondingly grows its LRU cache larger too, eventually\nconsuming most of the new, higher ceiling again over time - which\nVPA's own recommendation window (based on recent historical peak usage)\nthen reads as \"needs even more,\" recommending a further increase, which\nthe app responds to by growing its cache further still. The two systems\nare each behaving completely sensibly on their own terms, but together\nthey form a feedback loop with no natural equilibrium.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get vpa inference-cache-vpa -n ml-serving -o yaml` - check the recommendation history/trend, if visible, or just the current target versus what the container's limit already is.",
    "The app's memory usage doesn't grow unboundedly within one pod's lifetime - so what's actually different between each successive pod incarnation?",
    "`kubectl get configmap inference-cache-design-notes -n ml-serving -o yaml` - does the application size anything based on how much memory it's been given, rather than a fixed amount?",
  ],
  options: [
    {
      id: "cache-sized-as-percentage-feeds-back-into-vpa",
      label:
        "inference-cache sizes its own in-process LRU cache as a percentage (85%) of whatever memory it's been allocated, rather than a fixed size - so every time VPA raises the memory limit following an OOM, the app responds by growing its cache to match the new higher ceiling, eventually consuming most of it again, which VPA's own recommendation logic then reads as needing an even higher limit, and the two systems reinforce each other in a feedback loop with no natural stopping point rather than either one being individually broken.",
      explanation:
        "`inference-cache-design-notes` names the mechanism directly: a memory-percentage-based cache sizing strategy that was designed to make good use of available memory, interacting destructively with a VPA that's designed to size memory based on observed usage - each system is behaving exactly as intended in isolation, but together they form a genuine feedback loop, which explains both the pattern (OOM, bump, stabilize briefly, OOM again at a higher ceiling) and why there's no traditional memory leak within any single pod's lifetime (each pod's usage does plateau, just at whatever new ceiling it was given).",
    },
    {
      id: "inference-cache-has-memory-leak",
      label: "inference-cache has a genuine memory leak that VPA is failing to compensate for correctly.",
      explanation:
        "The scenario explicitly confirms each individual pod's memory usage plateaus rather than growing unboundedly - a genuine leak would show continuously climbing usage within a single pod's lifetime right up until the kill, not a stable plateau at a level that happens to shift upward between separate pod incarnations.",
    },
    {
      id: "vpa-recommendation-algorithm-buggy",
      label: "The VPA's own recommendation algorithm has a bug causing it to overestimate needed memory.",
      explanation:
        "VPA's recommendation logic is working as designed - it's correctly observing genuinely higher recent peak usage each time and recommending accordingly. The recommendations aren't wrong given the data VPA is seeing; the data itself is being actively shaped by the application's own cache-sizing behavior in response to VPA's previous recommendation.",
    },
    {
      id: "node-memory-pressure-external",
      label: "External memory pressure from other pods on the same node is causing these OOM kills.",
      explanation:
        "The pod's own `lastState.terminated.reason: OOMKilled` at `exitCode: 137` is a per-container cgroup kill tied to its own limit, not a node-level pressure eviction (which would show as `phase: Failed, reason: Evicted` on the pod itself) - this is the container exceeding its own memory limit, not external pressure from neighboring pods.",
    },
  ],
  correctOptionId: "cache-sized-as-percentage-feeds-back-into-vpa",
  resolution: `\`inference-cache-design-notes\` explains a genuine, non-obvious feedback
loop: the application sizes its in-process LRU cache as 85% of whatever
memory it's been given, a design meant to make efficient use of
available headroom. VPA, in \`Auto\` mode, observes actual usage and
raises the memory request/limit to match. Individually, both behaviors
are completely sensible - but together, every VPA-driven increase gives
the app more memory to grow its cache into, which it does, consuming
most of the new ceiling again over time; VPA's recommendation window
then reads that as genuinely higher demand and raises the limit further
still. There's no traditional leak within any single pod's lifetime
(each one's usage does plateau, exactly as the scenario notes) - the
"growth" is happening across pod incarnations, driven by the interaction
between the two systems, with no natural equilibrium for either to
settle into on its own.

The fix has to break the feedback loop rather than tune either system in
isolation. The most direct fix is decoupling the application's cache
sizing from its allocated memory - giving it a fixed, explicit cache size
budget (via config or an env var) instead of a percentage of "available"
memory:

\`\`\`yaml
env:
  - name: CACHE_MAX_SIZE_MB
    value: "1536"   # fixed budget, independent of container memory limit
\`\`\`

so the application no longer reacts to VPA's own changes. Alternatively
(or additionally), switching VPA to \`updateMode: "Off"\` or \`"Initial"\` -
recommendation-only, reviewed and applied manually - removes the
automatic side of the loop, letting a human set a stable memory
ceiling once real usage patterns are understood, without either system
continuously reacting to the other. Any application whose own resource
usage is a function of the resources it's been given is fundamentally
unsafe to pair with an autoscaler that adjusts those same resources based
on observed usage - the two need to be decoupled, not tuned harder.`,
};
