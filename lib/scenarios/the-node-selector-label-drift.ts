import type { Scenario } from "./types";

export const theNodeSelectorLabelDrift: Scenario = {
  id: "the-node-selector-label-drift",
  title: "The Node Selector Label Drift",
  subtitle: "batch-etl's pods went from scheduling instantly to never scheduling at all, overnight",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "scheduling", "labels"],
  briefing: `"batch-etl" pins itself to a specific node pool via \`nodeSelector\` to
stay off shared general-purpose nodes. It's scheduled instantly there for
months. As of this morning, every new pod sits Pending indefinitely, and
nobody touched batch-etl's own manifest.`,
  constraints: [
    "The target node pool's nodes are confirmed healthy, Ready, and have plenty of free capacity right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "batch-etl", namespace: "data", labels: { app: "batch-etl" } },
        spec: {
          replicas: 4,
          template: { spec: { nodeSelector: { "workload-pool": "etl-dedicated" }, containers: [{ name: "batch-etl", image: "registry.internal/batch-etl:5.5.0" }] } },
        },
        status: { readyReplicas: 0, updatedReplicas: 4, availableReplicas: 0 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "batch-etl-5g6h7i8j9-k0l1m", namespace: "data", labels: { app: "batch-etl" } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "2m", message: "0/4 nodes are available: 4 node(s) didn't match Pod's node affinity/selector." },
        ],
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "etl-node-01", labels: { "kubernetes.io/hostname": "etl-node-01", "workload-pool-name": "etl-dedicated" } },
        status: { conditions: [{ type: "Ready", status: "True" }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "node-labeling-automation-notes", namespace: "data" },
        spec: {
          data: {
            "notes.md":
              "An overnight cluster-config-management automation run relabeled every\nnode in the `etl-dedicated` pool - the old label key `workload-pool` was\nreplaced with `workload-pool-name` as part of a cluster-wide labeling\nconvention standardization (a mostly-unrelated effort meant to align\nlabel key names across all node pools). batch-etl's `nodeSelector` still\nreferences the old key, `workload-pool: etl-dedicated`, which now\nmatches nothing - the nodes carry the *value* `etl-dedicated` under a\ndifferent key entirely.\n",
          },
        },
        age: "10h",
      },
    ],
  },
  hints: [
    "`kubectl describe pod batch-etl-5g6h7i8j9-k0l1m -n data` - the FailedScheduling event says the node selector doesn't match any node, not that there's no capacity.",
    "`kubectl get nodes --show-labels` for the ETL pool - do the labels there still use the exact same key the Deployment's `nodeSelector` expects?",
    "`kubectl get deployment batch-etl -n data -o yaml` - check `nodeSelector` key name character-for-character against the node's actual labels.",
  ],
  options: [
    {
      id: "node-label-key-renamed-by-automation",
      label:
        "An overnight cluster-labeling standardization run renamed the ETL node pool's label key from `workload-pool` to `workload-pool-name` - batch-etl's `nodeSelector` still references the old key name, `workload-pool: etl-dedicated`, which no longer matches any node at all, even though the *value* `etl-dedicated` is still present, just under a different key entirely, so every pod fails scheduling despite the target nodes being healthy and idle.",
      explanation:
        "The scheduling event's wording - \"didn't match Pod's node affinity/selector\" - is specific to a selector mismatch, not insufficient resources, and the target nodes are confirmed healthy with free capacity. `node-labeling-automation-notes` explains the exact mechanism: an automated relabeling run changed the label *key* (not the value) on every node in the pool overnight, and batch-etl's Deployment manifest, untouched itself, still selects on the old key name - a `nodeSelector` requires an exact key-and-value match, so even a label carrying the right value under a different key doesn't count.",
    },
    {
      id: "node-pool-scaled-to-zero",
      label: "The `etl-dedicated` node pool was scaled down to zero nodes overnight.",
      explanation:
        "`etl-node-01` is confirmed present, labeled, and `Ready: True` with capacity available - the node pool itself hasn't shrunk. The scheduling failure is specifically about a label selector mismatch, not an absence of nodes to schedule onto.",
    },
    {
      id: "taint-added-to-etl-nodes",
      label: "A new taint was added to the ETL nodes overnight, and batch-etl lacks a matching toleration.",
      explanation:
        "The scheduling event's wording is specifically about a selector/affinity mismatch, the standard phrasing for a `nodeSelector` or `nodeAffinity` failure - a taint-related scheduling failure would instead reference nodes having taints the pod doesn't tolerate, a distinctly different and differently-worded event.",
    },
    {
      id: "deployment-selector-vs-template-mismatch",
      label: "The Deployment's own `spec.selector` no longer matches its pod template's labels.",
      explanation:
        "A Deployment-level selector/template label mismatch is rejected immediately at apply time by the API server's own validation, as an entirely different and immediate error - it wouldn't allow the Deployment to apply successfully and then produce pods that fail scheduling later, which is what's happening here.",
    },
  ],
  correctOptionId: "node-label-key-renamed-by-automation",
  resolution: `The scheduling event's exact phrasing - "didn't match Pod's node
affinity/selector" - points at a selector mismatch, not a capacity or
taint issue, and the target nodes are confirmed healthy and idle.
\`node-labeling-automation-notes\` explains what changed overnight: a
cluster-wide label-key standardization effort renamed the ETL pool's
label key from \`workload-pool\` to \`workload-pool-name\`, while keeping the
same value (\`etl-dedicated\`). batch-etl's own manifest was never touched
and still selects on the old key - and a \`nodeSelector\` match requires
both the key and the value to line up exactly, so a node carrying the
right value under a renamed key satisfies nothing. This is exactly the
kind of change that looks harmless from the node-labeling side (the
*meaning* of the label didn't change, just its key name) while silently
breaking every workload that pins to it by the old key.

The fix is updating batch-etl's `nodeSelector` to the new key name:

\`\`\`yaml
spec:
  template:
    spec:
      nodeSelector:
        workload-pool-name: etl-dedicated   # was: workload-pool
\`\`\`

Since automation is what renamed the label in the first place, it's
worth checking whether any other Deployments, DaemonSets, or
nodeAffinity rules across the cluster still reference the old
\`workload-pool\` key for this or other node pools - a label-key rename
initiative should audit every consumer of the old key, not just confirm
the nodes themselves were relabeled successfully, since the workloads
depending on that key have no way to know it changed until they simply
stop scheduling.`,
};
