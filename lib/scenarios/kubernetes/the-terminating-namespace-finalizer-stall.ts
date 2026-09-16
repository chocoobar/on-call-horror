import type { Scenario } from "../types";

export const theTerminatingNamespaceFinalizerStall: Scenario = {
  id: "the-terminating-namespace-finalizer-stall",
  title: "The Terminating Namespace Finalizer Stall",
  subtitle: "a namespace deletion from last week is still \"in progress\", blocking a name reuse today",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "namespace", "finalizers"],
  briefing: `Someone tried to create a fresh "staging-crm" namespace today for a new
project and got an error that it already exists - but \`kubectl get
namespace\` shows it stuck in \`Terminating\`, a state it's apparently been
in since a cleanup a week ago. Nobody's been able to get it to actually
finish deleting since.`,
  constraints: [
    "There are no ordinary Pods, Deployments, Services, or other standard workload objects left in the namespace - the usual suspects for a stuck namespace are already gone.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: "staging-crm", finalizers: ["kubernetes"], deletionTimestamp: "2026-09-08T14:00:00Z" },
        status: { phase: "Terminating", conditions: [{ type: "NamespaceContentRemaining", status: "True", message: "Some content in the namespace has finalizers remaining: custom.internal/crm-license-check in 1 resource instances" }] },
        age: "7d",
      },
      {
        apiVersion: "crm.internal/v1",
        kind: "CrmTenant",
        metadata: { name: "staging-crm-tenant", namespace: "staging-crm", finalizers: ["custom.internal/crm-license-check"], deletionTimestamp: "2026-09-08T14:00:05Z" },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "crm-operator-decommission-notes", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "The `CrmTenant` custom resource type and its controller (`crm-operator`)\nwere both fully decommissioned and removed from the cluster 6 days ago,\none day after `staging-crm`'s deletion was first requested - the\nCrmTenant object shown above is a leftover instance that still carries\nthe finalizer `custom.internal/crm-license-check`, which only\ncrm-operator ever knew how to remove (it made an external license-server\nAPI call to release a seat, then cleared its own finalizer). With\ncrm-operator gone, nothing will ever remove that finalizer, which blocks\nthe CrmTenant object's own deletion, which in turn is exactly the\n'content remaining' blocking the namespace's own finalizer\n(`kubernetes`, the built-in one responsible for ensuring all namespaced\ncontent is gone before finishing namespace deletion) from ever clearing.\n",
          },
        },
        age: "6d",
      },
    ],
  },
  hints: [
    "`kubectl get namespace staging-crm -o yaml` - check `status.conditions` for `NamespaceContentRemaining`. It usually names exactly what's still stuck inside.",
    "The condition message names a specific finalizer on a specific kind of resource - `kubectl get crmtenant -n staging-crm` (or the relevant custom resource) to find it directly.",
    "Is the controller that owns that specific finalizer even still running anywhere in the cluster?",
  ],
  options: [
    {
      id: "orphaned-crmtenant-finalizer-blocks-namespace-deletion",
      label:
        "A single leftover `CrmTenant` custom resource inside `staging-crm` still carries the finalizer `custom.internal/crm-license-check`, but the `crm-operator` controller that owned and knew how to clear that finalizer was fully decommissioned and removed from the cluster days ago - with nothing left to remove it, the CrmTenant object itself can never finish deleting, which is exactly the \"content remaining\" the namespace's own built-in `kubernetes` finalizer is waiting on before it can let the namespace deletion complete.",
      explanation:
        "The namespace's own `NamespaceContentRemaining` condition names the exact blocker: a finalizer, `custom.internal/crm-license-check`, on one remaining resource instance. `crm-operator-decommission-notes` explains why it'll never clear on its own: the controller responsible for it was removed from the cluster entirely, one day after the namespace deletion was first requested, leaving an object whose only path to being finalized (an external license-server API call, then clearing its own finalizer) no longer has anything capable of performing it.",
    },
    {
      id: "namespace-has-hidden-running-pods",
      label: "There are still hidden, running Pods in the namespace that haven't fully terminated.",
      explanation:
        "The scenario explicitly confirms all ordinary workload objects (Pods, Deployments, Services) are already gone - the namespace's own condition specifically attributes the block to a finalizer on a custom resource, a distinct and different mechanism from lingering standard workloads.",
    },
    {
      id: "kube-apiserver-itself-stuck",
      label: "The kube-apiserver's own namespace-deletion controller is stuck or malfunctioning.",
      explanation:
        "The namespace deletion process (the namespace lifecycle controller, part of the control plane) is working exactly as designed - it's correctly refusing to complete deletion while content with an unresolved finalizer remains, per its own accurate status condition. The malfunction is in the missing custom controller that owned the specific stuck finalizer, not in the core namespace-deletion machinery itself.",
    },
    {
      id: "rbac-blocking-namespace-deletion",
      label: "RBAC permissions are preventing the namespace from finishing its deletion.",
      explanation:
        "Namespace deletion, once initiated, proceeds via the control plane's own internal namespace lifecycle controller, not via ongoing user-permission checks - an RBAC issue would block *initiating* deletion or interacting with objects, not the background finalization process, and the namespace's own condition already gives a specific, different, finalizer-based reason.",
    },
  ],
  correctOptionId: "orphaned-crmtenant-finalizer-blocks-namespace-deletion",
  resolution: `The namespace's own \`status.conditions\` gives the exact answer:
\`NamespaceContentRemaining\`, naming the finalizer
\`custom.internal/crm-license-check\` on one remaining resource. That
finalizer belongs to a \`CrmTenant\` custom resource, and \`crm-operator-decommission-notes\`
explains why it's permanently stuck: the \`crm-operator\` controller that
owned this finalizer - responsible for calling an external license
server to release a seat before clearing it - was fully removed from the
cluster six days ago, one day after this namespace's deletion was first
requested. With that controller gone, nothing will ever call the
license-release API or clear the finalizer, so the CrmTenant object can
never finish its own deletion, and the namespace's built-in \`kubernetes\`
finalizer (which specifically exists to ensure all namespaced content is
gone before completing namespace deletion) waits on it forever.

There's no live fix from this read-only console, but the standard
recovery, once it's confirmed acceptable that the external license seat
this finalizer would have released won't be released automatically
(likely requiring a manual cleanup call to the license server, or simply
accepting an orphaned seat if it doesn't matter for a decommissioned
system), is removing the finalizer directly from the stuck object:

\`\`\`bash
kubectl patch crmtenant staging-crm-tenant -n staging-crm \\
  --type=json -p '[{"op": "remove", "path": "/metadata/finalizers/0"}]'
\`\`\`

Once that clears, the CrmTenant object finishes deleting, the
namespace's \`NamespaceContentRemaining\` condition resolves, and the
namespace itself completes its own deletion shortly after - freeing up
the \`staging-crm\` name for reuse. The broader process gap: decommissioning
a custom controller should always include a check for any existing
custom resource instances it manages, anywhere in the cluster, and
either let it clean them up gracefully first or explicitly strip its
finalizers as part of the decommission - not just remove the controller
and leave behind objects whose only path to deletion depended on it.`,
};
