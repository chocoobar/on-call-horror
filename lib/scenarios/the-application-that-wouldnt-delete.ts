import type { Scenario } from "./types";

export const theApplicationThatWouldntDelete: Scenario = {
  id: "the-application-that-wouldnt-delete",
  title: "The Application That Wouldn't Delete",
  subtitle: "decommissioning legacy-invoicing has been \"in progress\" for twenty minutes",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "finalizer", "deletion"],
  briefing: `"legacy-invoicing" is being decommissioned. Its Application was deleted
via the ArgoCD UI twenty minutes ago as the first step of teardown - but
"kubectl get application legacy-invoicing -n argocd" still shows it
sitting there with a deletion timestamp set and nothing actually going
away.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "legacy-invoicing",
          namespace: "argocd",
          annotations: { "deletion-requested-at": "2026-09-15T13:40:00Z" },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/legacy-invoicing.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "legacy-invoicing" },
          syncPolicy: {},
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          conditions: [
            { type: "DeletionPending", message: "Application is pending deletion; resource-level finalizer 'resources-finalizer.argocd.argoproj.io' present" },
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoicing-deletion-notes", namespace: "legacy-invoicing" },
        spec: {
          data: {
            "notes.md":
              "This Application carries the standard\n`resources-finalizer.argocd.argoproj.io` finalizer, which tells ArgoCD to\ncascade-delete all of the Application's managed resources *before*\nremoving the Application object itself. The deletion won't complete\nuntil that cascade finishes and the finalizer is removed automatically -\nit does not mean deletion is stuck by default, only if the cascade\nitself can't finish.\n",
            "cascade-status.txt":
              "12 of 13 managed resources deleted successfully. One remaining:\nPersistentVolumeClaim invoicing-archive-data (namespace legacy-invoicing)\nis stuck Terminating - it has its own finalizer,\nkubernetes.io/pvc-protection, and a Pod named invoicing-archive-reader\n(not managed by this Application, created manually last month for a data\nexport that was never cleaned up) still has it mounted.",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl describe application legacy-invoicing -n argocd` - the condition explains the finalizer's role and that this is a cascade delete in progress.",
    "`kubectl get configmap invoicing-deletion-notes -n legacy-invoicing -o yaml` for what's actually still blocking the cascade.",
    "A PVC stuck Terminating is almost always because something still has it mounted - check for pods using it that aren't part of the Application's own manifests.",
  ],
  options: [
    {
      id: "pvc-still-mounted-by-unmanaged-pod",
      label:
        "The Application's cascade-delete finalizer is working as designed and has already removed 12 of 13 resources - it's blocked only on a PersistentVolumeClaim that's stuck Terminating because an unrelated, manually-created Pod (never part of this Application) still has it mounted.",
      explanation:
        "`cascade-status.txt` shows the cascade is 12/13 done, with the one holdout being a PVC blocked by its own `pvc-protection` finalizer because a manually-created, unmanaged Pod still mounts it. This isn't ArgoCD's deletion process malfunctioning - it's correctly waiting on a real Kubernetes-level block (the PVC can't terminate while mounted) caused by something outside the Application's own manifests entirely.",
    },
    {
      id: "argocd-finalizer-bug",
      label: "ArgoCD's cascade-delete finalizer logic is broken and never actually processes deletions.",
      explanation:
        "The cascade clearly did work - 12 of the 13 managed resources are already gone. A broken finalizer implementation wouldn't selectively succeed on 12 resources and then stall on exactly the one that has an independent, well-understood Kubernetes-level blocker (a still-mounted PVC).",
    },
    {
      id: "rbac-missing-delete-permission",
      label: "ArgoCD's ServiceAccount lacks delete permission on some resource types.",
      explanation:
        "If RBAC were blocking deletions, none of the 13 resources would have been removable, or the specific stuck resource would show a Forbidden-style error - instead the PVC's own `pvc-protection` finalizer is what's holding it, which is a mount-based protection, not a permissions issue.",
    },
    {
      id: "wrong-cascade-policy",
      label: "The Application was deleted with the wrong cascade option, so it isn't actually deleting child resources at all.",
      explanation:
        "Cascade deletion clearly is happening - 12 of 13 resources are already gone, which wouldn't be the case under a non-cascading deletion (which would leave all 13 managed resources behind and just remove the Application object, or in this case, get stuck immediately on the finalizer with zero progress).",
    },
  ],
  correctOptionId: "pvc-still-mounted-by-unmanaged-pod",
  resolution: `\`invoicing-deletion-notes\` shows the cascade is nearly done: 12 of 13
managed resources are already deleted, thanks to the
\`resources-finalizer.argocd.argoproj.io\` finalizer doing exactly its job
of tearing down everything the Application manages before letting the
Application object itself go. The one holdout is a PersistentVolumeClaim
that's stuck \`Terminating\` under its own separate
\`kubernetes.io/pvc-protection\` finalizer - because a manually-created
Pod, never part of this Application's own manifests, still has it
mounted from an unrelated data export a month ago.

The fix is cleaning up the unmanaged pod first, which lets the PVC
actually terminate, which lets the Application's finalizer finish and the
Application itself disappear:

\`\`\`
kubectl delete pod invoicing-archive-reader -n legacy-invoicing
\`\`\`

Within moments the PVC finishes terminating, the cascade completes 13/13,
and the Application object is removed automatically - no need to force-
remove the Application's own finalizer, which would have abandoned the
already-in-progress, legitimate deletion of the remaining resource
instead of actually resolving it.`,
};
