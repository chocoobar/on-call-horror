import type { Scenario } from "./types";

export const theOrphanedFinalizer: Scenario = {
  id: "the-orphaned-finalizer",
  title: "The Orphaned Finalizer",
  subtitle: "a pod from last month's decommissioned service is still sitting there, Terminating",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "finalizers", "cleanup"],
  briefing: `Cleaning up an old namespace, someone tried to delete a leftover pod from
"legacy-exporter" - a service decommissioned three weeks ago. The delete
command returns immediately and appears to succeed, but the pod is still
there, stuck showing \`Terminating\`, for going on twenty minutes now.`,
  constraints: [
    "The node the pod claims to be on is confirmed healthy and reachable - this isn't a lost-node situation.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: "legacy-exporter-3s4t5u6v7",
          namespace: "legacy",
          labels: { app: "legacy-exporter" },
          finalizers: ["custom.internal/detach-external-volume"],
          deletionTimestamp: "2026-09-15T09:45:00Z",
        },
        status: { phase: "Running" },
        age: "21m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "legacy-exporter-decommission-notes", namespace: "legacy" },
        spec: {
          data: {
            "notes.md":
              "legacy-exporter used a custom finalizer, `custom.internal/detach-external-volume`,\nadded by a small in-house operator that used to run in the\n`legacy-infra` namespace - its job was to make an external API call to\ndetach a proprietary storage volume before letting the pod's deletion\nproceed, then remove the finalizer itself once done. That operator's own\nDeployment was deleted three weeks ago as part of the same\ndecommissioning effort that retired legacy-exporter - nobody realized\nany *existing* pods still carried its finalizer, since new pods stopped\nbeing created around the same time. With the finalizer's owning\ncontroller gone, nothing will ever remove it, and the API server will\nnever fully delete an object that still has a finalizer listed on it,\nregardless of how long its `deletionTimestamp` has been set.\n",
          },
        },
        age: "21m",
      },
    ],
  },
  hints: [
    "`kubectl get pod legacy-exporter-3s4t5u6v7 -n legacy -o yaml` - check `metadata.finalizers`. A `deletionTimestamp` being set doesn't mean an object is actually gone.",
    "A finalizer is a promise: 'don't fully delete this object until I remove myself.' What happens if whatever was supposed to remove it doesn't exist anymore?",
    "`kubectl get configmap legacy-exporter-decommission-notes -n legacy -o yaml` - is the controller that owns this finalizer still running anywhere?",
  ],
  options: [
    {
      id: "finalizer-owning-controller-deleted",
      label:
        "The pod carries a custom finalizer, `custom.internal/detach-external-volume`, whose owning controller was itself deleted three weeks ago during the same decommissioning effort - the API server correctly refuses to fully remove the pod object while any finalizer remains listed on it, but with the controller gone, nothing will ever call in to remove that finalizer, so the pod is permanently stuck in `Terminating` limbo unless someone intervenes directly.",
      explanation:
        "The pod's own metadata shows both `deletionTimestamp` set (deletion was requested and accepted) and `finalizers: [\"custom.internal/detach-external-volume\"]` still present - the defining signature of a stuck-Terminating object: deletion was requested, but a finalizer is blocking final removal. `legacy-exporter-decommission-notes` explains why that finalizer will never clear on its own: the controller responsible for detaching the external volume and then removing its own finalizer was deleted as part of the same decommissioning work, before anyone noticed existing pods still referenced it.",
    },
    {
      id: "node-unreachable-blocking-delete",
      label: "The node the pod is scheduled on has become unreachable, preventing the kubelet from confirming deletion.",
      explanation:
        "The scenario confirms the node is healthy and reachable - a stuck-Terminating pod due to an unreachable node is a real and distinct failure mode, but it isn't what's happening here. This pod's own metadata directly shows the actual blocker: a finalizer with no controller left to remove it.",
    },
    {
      id: "rbac-blocking-pod-deletion",
      label: "RBAC permissions are blocking the delete request from actually taking effect.",
      explanation:
        "An RBAC denial would cause the delete request itself to fail immediately with a `Forbidden` error, rather than being accepted (setting `deletionTimestamp`) and then hanging indefinitely - the request clearly succeeded at the API level; it's the finalizer that's preventing final object removal afterward.",
    },
    {
      id: "pod-still-actively-serving-traffic",
      label: "The pod is still actively receiving and processing traffic, so Kubernetes is waiting for it to finish.",
      explanation:
        "Kubernetes' own deletion/termination process doesn't wait indefinitely for traffic to stop - that's what `terminationGracePeriodSeconds` bounds, typically to well under a minute or two by default. Twenty minutes and counting, combined with a finalizer still listed on the object, points specifically at the finalizer mechanism, not an unusually long graceful shutdown.",
    },
  ],
  correctOptionId: "finalizer-owning-controller-deleted",
  resolution: `The pod's own metadata shows the classic stuck-Terminating signature:
\`deletionTimestamp\` is set (the delete request was accepted 21 minutes
ago), but \`metadata.finalizers\` still lists
\`custom.internal/detach-external-volume\` - and the API server, by
design, will never complete the deletion of an object that still has any
finalizer on it, no matter how long ago deletion was requested.
\`legacy-exporter-decommission-notes\` explains why this one will never
clear itself: the small in-house operator responsible for detaching an
external volume and then removing its own finalizer was deleted three
weeks ago, as part of the very same decommissioning effort that retired
legacy-exporter - nobody realized any already-running pods still carried
a reference to a controller that no longer existed to service it.

There's no live fix from this read-only console, but the standard
recovery, once it's confirmed safe (i.e. the external volume this
finalizer was meant to protect really has been handled, or genuinely no
longer matters since the service is fully decommissioned), is removing
the finalizer directly:

\`\`\`bash
kubectl patch pod legacy-exporter-3s4t5u6v7 -n legacy \\
  --type=json -p '[{"op": "remove", "path": "/metadata/finalizers/0"}]'
\`\`\`

which immediately allows the already-pending deletion to complete. This
should be done deliberately, not routinely - a finalizer exists to
guarantee some cleanup step actually happens, and removing it manually
means explicitly accepting that step won't run. Worth also auditing for
any other objects that might carry the same now-orphaned finalizer from
before the operator was removed, since this pod is unlikely to be the
only one left over from that decommissioning.`,
};
