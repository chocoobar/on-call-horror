import type { Scenario } from "./types";

export const theHostnetworkPortCollision: Scenario = {
  id: "the-hostnetwork-port-collision",
  title: "The hostNetwork Port Collision",
  subtitle: "packet-sniffer's second replica on a node never starts, and the error makes no sense at first glance",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "hostnetwork", "scheduling"],
  briefing: `"packet-sniffer" needs direct access to a node's network interfaces, so it
runs with \`hostNetwork: true\`. After bumping its DaemonSet-like
Deployment from 1 to 2 replicas per node for redundancy, the second
replica on every node fails immediately - the first one on each node is
completely fine.`,
  constraints: [
    "This Deployment intentionally isn't a DaemonSet - it's meant to allow more than one replica per node, unlike a typical one-per-node pattern.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "packet-sniffer", namespace: "network-tools", labels: { app: "packet-sniffer" } },
        spec: {
          replicas: 6,
          template: { spec: { hostNetwork: true, containers: [{ name: "packet-sniffer", image: "registry.internal/packet-sniffer:2.0.0", ports: [{ containerPort: 9200, hostPort: 9200 }] }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 6, availableReplicas: 3 },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "packet-sniffer-5f6g7h8i9-j0k1l", namespace: "network-tools", labels: { app: "packet-sniffer" } },
        spec: { nodeName: "worker-07" },
        status: { phase: "Running", containerStatuses: [{ name: "packet-sniffer", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "packet-sniffer-5f6g7h8i9-m2n3o", namespace: "network-tools", labels: { app: "packet-sniffer" } },
        spec: { nodeName: "worker-07" },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "FailedScheduling", age: "35m", message: "0/1 nodes are available: 1 node(s) didn't have free ports for the requested pod ports." },
        ],
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "hostnetwork-port-notes", namespace: "network-tools" },
        spec: {
          data: {
            "notes.md":
              "With `hostNetwork: true`, a pod's containerPort is bound directly to\nthe *node's own* network namespace - there's no per-pod network\nisolation to allow two pods on the same node to both bind the same\nport, unlike normal pod networking where each pod gets its own IP.\npacket-sniffer's container listens on a fixed port, 9200, with no way\nto configure a different port per replica. The first pod on each node\nsuccessfully claims port 9200 on that node; any second pod scheduled to\nthe same node for the same fixed port has nowhere to bind, and the\nscheduler correctly refuses to even place it there once it detects the\nconflict.\n",
          },
        },
        age: "40m",
      },
    ],
  },
  hints: [
    "`kubectl describe pod packet-sniffer-5f6g7h8i9-m2n3o -n network-tools` - the scheduling failure specifically mentions ports, not general resource capacity.",
    "`kubectl get deployment packet-sniffer -n network-tools -o yaml` - check `hostNetwork` and the container's port configuration together.",
    "With `hostNetwork: true`, a pod's port is a port on the *node itself* - what happens when two pods on the same node both want to bind the exact same fixed port?",
  ],
  options: [
    {
      id: "hostnetwork-fixed-port-collision-same-node",
      label:
        "With `hostNetwork: true`, packet-sniffer's fixed port 9200 is bound directly on the node's own network namespace rather than a per-pod isolated one - the first pod scheduled to a given node successfully claims that port, but any second pod the Deployment tries to place on the same node has nowhere to bind the identical fixed port, so the scheduler correctly refuses to schedule it there at all, which is exactly what the port-specific `FailedScheduling` event describes and why only ever one replica per node ever comes up.",
      explanation:
        "The scheduling event's wording is specific: \"didn't have free ports for the requested pod ports\" - a port conflict, not a general resource shortage. `hostnetwork-port-notes` explains why this is structural rather than transient: `hostNetwork: true` means the port genuinely belongs to the node, not the pod, so two pods on the same node both trying to bind the same fixed port 9200 is a real conflict the scheduler correctly detects and blocks, one pod at a time landing successfully on each node while every additional one fails identically.",
    },
    {
      id: "insufficient-node-capacity",
      label: "The nodes don't have enough CPU/memory capacity for a second replica.",
      explanation:
        "The scheduling event specifically cites a port conflict, not insufficient CPU or memory - a resource-capacity failure would produce a differently-worded event about CPU/memory rather than \"didn't have free ports,\" which is a distinct and specific scheduler check.",
    },
    {
      id: "deployment-antiaffinity-missing",
      label: "The Deployment needs a pod anti-affinity rule to properly spread replicas across nodes.",
      explanation:
        "Anti-affinity would help *encourage* spreading pods across different nodes, but it wouldn't be the root cause here - even with perfect spreading, this Deployment explicitly wants 2 replicas *per node*, and the actual, structural blocker for the second one landing on the same node is the fixed hostNetwork port, not a lack of spread preference.",
    },
    {
      id: "service-not-matching-hostnetwork-pods",
      label: "A Service in front of packet-sniffer isn't correctly routing to `hostNetwork` pods.",
      explanation:
        "There's no Service-routing symptom here at all - the second pod never even gets scheduled, let alone reaches a point where Service routing would matter. The failure happens entirely at the scheduling stage, specifically due to a port conflict on the node.",
    },
  ],
  correctOptionId: "hostnetwork-fixed-port-collision-same-node",
  resolution: `The scheduling event is specific: "didn't have free ports for the
requested pod ports" - a port conflict, not a CPU/memory shortage.
\`hostnetwork-port-notes\` explains why this is a structural, permanent
limit rather than something that resolves with more nodes or more
waiting: \`hostNetwork: true\` binds a pod's port directly onto the node's
own network namespace, with none of the per-pod network isolation normal
pod networking provides. packet-sniffer's container has a single fixed
port, 9200, with no per-replica configurability - the first pod scheduled
to any given node successfully claims that port on the node, and every
subsequent pod the Deployment tries to place on that same node has
nowhere left to bind the identical port, so the scheduler correctly and
permanently refuses to schedule it there.

Two possible fixes, depending on why 2-per-node redundancy was wanted in
the first place. If the goal was genuinely "more than one instance
capturing traffic on the same node" (rather than just "more total
capacity somewhere"), each replica needs a distinct port, coordinated
somehow across the pods sharing a node - awkward and fragile with plain
`hostNetwork`, typically requiring a startup script that probes for a
free port in a range rather than a single hardcoded value. If instead
the real goal was broader coverage or capacity rather than strict
per-node duplication, the simpler and much more common fix is running
exactly one replica per node (a natural fit for a DaemonSet, which this
intentionally isn't, per the scenario, but worth revisiting) and scaling
horizontal capacity by adding more nodes instead of stacking pods on
existing ones. Given \`hostNetwork\`'s port collision is a hard, permanent
node-level constraint, the fix has to change either the port strategy or
the node-density assumption - it can't be resolved by anything at the
Kubernetes scheduling layer alone.`,
};
