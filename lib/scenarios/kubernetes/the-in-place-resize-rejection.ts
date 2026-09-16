import type { Scenario } from "../types";

export const theInPlaceResizeRejection: Scenario = {
  id: "the-in-place-resize-rejection",
  title: "The In-Place Resize Rejection",
  subtitle: "bumping search-ranker's memory request didn't restart the pod, and didn't change anything either",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "resize", "resources"],
  briefing: `To avoid a disruptive restart during peak hours, an engineer used
Kubernetes' in-place pod resize feature to bump "search-ranker"'s memory
request and limit upward without recreating the pod - it's been
approaching its old memory limit and throttling. The command returned
success. The pod's actual behavior hasn't changed at all; it's still
hitting the same old ceiling.`,
  constraints: [
    "The pod was not restarted or recreated at any point - it's confirmed to be the exact same running process throughout.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "search-ranker-0e1f2g3h4", namespace: "search", labels: { app: "search-ranker" } },
        spec: {
          containers: [{ name: "search-ranker", image: "registry.internal/search-ranker:3.0.0", resources: { requests: { memory: "1Gi" }, limits: { memory: "1Gi" } }, resizePolicy: [{ resourceName: "memory", restartPolicy: "NotRequired" }] }],
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "search-ranker", ready: true, restartCount: 0, state: { running: {} } }],
          resize: "Infeasible",
        },
        events: [
          { type: "Warning", reason: "ResizeInfeasible", age: "3m", message: "Node didn't have enough capacity: memory, requested: 1073741824, capacity: 536870912" },
        ],
        age: "5h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-ranker-resize-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "search-ranker's node, `worker-dense-11`, is heavily packed with other\npods' requests already - it only has about 512Mi of genuinely\nunreserved allocatable memory left. The in-place resize requested\nraising this container's memory request+limit from 1Gi to 2Gi (an\nincrease of 1Gi), which the node cannot accommodate given what's already\nreserved by every other pod's own requests, even though the *resize\nfeature itself* and the container's `resizePolicy` (NotRequired restart)\nare both working correctly. An in-place resize is still subject to the\nsame node-capacity check a brand-new pod would face - it just fails\ndifferently (marking the resize `Infeasible` on the existing pod)\nrather than failing to schedule a new one.\n",
          },
        },
        age: "3m",
      },
    ],
  },
  hints: [
    "`kubectl get pod search-ranker-0e1f2g3h4 -n search -o yaml` - check `status.resize`. Does it say the resize actually succeeded?",
    "`kubectl describe pod search-ranker-0e1f2g3h4 -n search` - the `ResizeInfeasible` event names a specific numeric shortfall.",
    "An in-place resize still has to fit within the node's actual remaining allocatable capacity - what happens when the requested increase is bigger than what's actually free?",
  ],
  options: [
    {
      id: "node-lacks-capacity-for-resize",
      label:
        "The in-place resize request itself was accepted and processed correctly, but `worker-dense-11` only has about 512Mi of genuinely unreserved memory left after every other pod's own requests, and the resize asked for a full 1Gi increase - more than the node can accommodate - so Kubernetes correctly marked the resize `Infeasible` and left the container running unchanged at its original 1Gi limit rather than attempting an increase the node can't actually back.",
      explanation:
        "`status.resize: Infeasible` on the pod is explicit that the resize was evaluated and rejected, not silently ignored or still pending. The `ResizeInfeasible` event gives the exact numbers: requesting roughly 1GiB more than the roughly 512MiB of capacity actually available on the node. `search-ranker-resize-notes` confirms the node really is that tightly packed. In-place resize is still bound by the same node-capacity constraint a brand-new pod's scheduling decision would face - the container simply doesn't get resized when there isn't room, and continues running exactly as it was before the attempt.",
    },
    {
      id: "resizepolicy-requires-restart",
      label: "The container's `resizePolicy` requires a restart for memory changes, and none was performed.",
      explanation:
        "The `resizePolicy` explicitly shows `restartPolicy: NotRequired` for memory - a restart isn't needed for this resize to apply in principle. The actual blocker, per the pod's own `status.resize: Infeasible` and the matching event, is node capacity, not a restart requirement.",
    },
    {
      id: "feature-gate-not-enabled",
      label: "In-place pod resize isn't actually enabled on this cluster, so the request was silently ignored.",
      explanation:
        "If the feature were disabled, the resize request would likely be rejected outright at the API level as an unrecognized/immutable field change, rather than being accepted and evaluated all the way to a specific `status.resize: Infeasible` outcome with a detailed capacity-shortfall event - this is the feature working and correctly reporting why it can't proceed.",
    },
    {
      id: "container-application-caching-old-limit",
      label: "The application inside the container cached its old memory limit at startup and won't respect the new value regardless.",
      explanation:
        "The resize never actually applied at the Kubernetes level in the first place (`status.resize: Infeasible`), so there's no new limit for the application to have missed or cached incorrectly - the container is still running under its original, unchanged 1Gi limit exactly as before the resize attempt.",
    },
  ],
  correctOptionId: "node-lacks-capacity-for-resize",
  resolution: `\`status.resize: Infeasible\` on the pod is unambiguous: the resize request
was received and evaluated, not silently dropped or still pending. The
\`ResizeInfeasible\` event spells out the exact shortfall - requesting
roughly 1GiB more memory than the roughly 512MiB actually free on
\`worker-dense-11\`. \`search-ranker-resize-notes\` confirms the node is
genuinely that tightly packed with other pods' own requests. In-place
resize doesn't bypass node capacity limits - it's still bound by the same
constraint a brand-new pod's scheduling decision would face, it just
surfaces the failure differently (marking the existing pod's resize
infeasible) rather than failing to schedule a fresh pod. The container
kept running the entire time under its original 1Gi limit, exactly as
expected.

There's no way to force a resize onto a node that doesn't have the
capacity - the real fix is one of:

- Request a smaller increase that actually fits within the ~512Mi
  currently free (a partial improvement now, full fix later), or
- Move search-ranker to a less densely-packed node (via a real pod
  restart/reschedule, since in-place resize by definition never moves a
  pod to a different node), or
- Free up capacity on \`worker-dense-11\` by rebalancing other workloads
  off it first, then retry the in-place resize.

\`\`\`bash
kubectl patch pod search-ranker-0e1f2g3h4 -n search --subresource resize \\
  --patch '{"spec":{"containers":[{"name":"search-ranker","resources":{"requests":{"memory":"1.4Gi"},"limits":{"memory":"1.4Gi"}}}]}}'
\`\`\`

In-place resize is a genuinely useful way to avoid a disruptive restart,
but it's not a way around node capacity math - a resize that needs more
room than a densely packed node has left will always need either a
smaller ask or a different node.`,
};
