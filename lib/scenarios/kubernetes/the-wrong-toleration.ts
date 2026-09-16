import type { Scenario } from "../types";

export const theWrongToleration: Scenario = {
  id: "the-wrong-toleration",
  title: "The Wrong Toleration",
  subtitle: "ml-scorer's pods have been Pending since the GPU nodepool migration",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "scheduling", "taints"],
  briefing: `Platform migrated GPU workloads to a new, dedicated nodepool last night
to isolate them from general workloads. Since then, "ml-scorer" - which
has always run on GPU nodes - has zero running pods. All three replicas
sit Pending.`,
  constraints: [
    "The new GPU nodepool has plenty of free capacity - three GPU nodes are sitting completely idle right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ml-scorer", namespace: "ml", labels: { app: "ml-scorer" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              nodeSelector: { "workload-type": "gpu" },
              containers: [{ name: "ml-scorer", image: "registry.internal/ml-scorer:2.3.0" }],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 3, availableReplicas: 0 },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ml-scorer-2b3c4d5e6-f7g8h", namespace: "ml", labels: { app: "ml-scorer" } },
        status: { phase: "Pending" },
        events: [
          {
            type: "Warning",
            reason: "FailedScheduling",
            age: "3m",
            message: "0/9 nodes are available: 3 node(s) had untolerated taint {dedicated: gpu}, 6 node(s) didn't match Pod's node affinity/selector.",
          },
        ],
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gpu-migration-notes", namespace: "ml" },
        spec: {
          data: {
            "notes.md":
              "Last night's GPU nodepool migration:\n- New GPU nodes labeled `workload-type: gpu` (ml-scorer's nodeSelector\n  already matches this - unchanged from before).\n- New GPU nodes also tainted `dedicated=gpu:NoSchedule`, to keep\n  non-GPU workloads off them. This taint is new as of last night.\n- Old GPU nodes (untainted, no dedicated pool) were decommissioned\n  this morning.\n",
          },
        },
        age: "10h",
      },
    ],
  },
  hints: [
    "`kubectl describe pod ml-scorer-2b3c4d5e6-f7g8h -n ml` - the FailedScheduling event lists two separate reasons. Which one applies to the GPU nodes specifically?",
    "`kubectl get deployment ml-scorer -n ml -o yaml` - does the pod template have anything that lets it run on a *tainted* node, versus just a `nodeSelector` that says which nodes it'd *like*?",
    "A `nodeSelector` and a toleration do two different jobs: `nodeSelector` says which nodes a pod is willing to run on; a toleration says a pod is allowed onto a node that would otherwise actively repel it via a taint. A pod needs both when a node has a matching label *and* a taint.",
  ],
  options: [
    {
      id: "missing-toleration",
      label:
        "The new GPU nodes are tainted `dedicated=gpu:NoSchedule` as of last night's migration, and ml-scorer's pod spec has a `nodeSelector` matching the GPU label but no toleration for that taint - the nodeSelector gets it interested in the right nodes, but the untolerated taint actively repels it from all of them.",
      explanation:
        "`gpu-migration-notes` confirms the taint is new as of last night, added specifically to keep non-GPU workloads off these nodes - exactly the kind of change that silently breaks an existing workload that was never updated to tolerate it. The scheduling event's \"untolerated taint {dedicated: gpu}\" for 3 nodes is the direct, specific signal: those are the GPU nodes, and ml-scorer's pod spec has no `tolerations` entry at all, so the taint blocks it outright regardless of how well its `nodeSelector` matches.",
    },
    {
      id: "gpu-nodes-full",
      label: "The GPU nodes are already at full capacity from other workloads.",
      explanation:
        "The GPU nodepool is confirmed to have three completely idle nodes right now - there's no capacity constraint here, the pods are being actively blocked from landing on those nodes at all, not queued behind other work.",
    },
    {
      id: "node-selector-label-typo",
      label: "ml-scorer's `nodeSelector` has a typo and doesn't match the GPU nodes' actual label.",
      explanation:
        "`gpu-migration-notes` confirms the new nodes are labeled `workload-type: gpu`, which matches ml-scorer's `nodeSelector` exactly and is explicitly called out as unchanged from before - the label matching is fine, it's the new taint that's blocking scheduling.",
    },
    {
      id: "image-not-gpu-compatible",
      label: "ml-scorer's container image isn't built for the new GPU nodes' driver version.",
      explanation:
        "The pods are stuck in `Pending`, meaning they were never scheduled onto a node and never even attempted to start a container - an image/driver incompatibility would only be able to surface after a pod actually lands on a node and tries to run.",
    },
  ],
  correctOptionId: "missing-toleration",
  resolution: `The scheduling event spells out two separate failures for two separate
groups of nodes: 6 nodes don't match the \`nodeSelector\` at all (the
non-GPU nodes, expected), and 3 nodes - the actual GPU nodes - are
rejected specifically for an "untolerated taint \`{dedicated: gpu}\`".
\`gpu-migration-notes\` confirms this taint is brand new as of last night's
migration, added deliberately to keep non-GPU workloads off the dedicated
pool - but nobody updated ml-scorer's pod spec to tolerate it. Its
\`nodeSelector\` still correctly targets \`workload-type: gpu\` (that part
never changed), but a \`nodeSelector\` only expresses a preference for where
a pod *can* go - it does nothing to override a taint that's actively
saying "don't schedule anything here unless it explicitly tolerates this."

The fix is adding a matching toleration to the pod spec:

\`\`\`yaml
spec:
  template:
    spec:
      nodeSelector:
        workload-type: gpu
      tolerations:
        - key: dedicated
          operator: Equal
          value: gpu
          effect: NoSchedule
\`\`\`

Taints and tolerations exist specifically so a nodepool can repel
workloads by default and only admit the ones that opt in - any time a
platform team adds a new taint to isolate a nodepool, every workload that
already runs there needs a matching toleration added in the same change,
or it silently loses its ability to schedule the moment the taint lands.`,
};
