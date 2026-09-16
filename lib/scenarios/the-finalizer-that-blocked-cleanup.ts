import type { Scenario } from "./types";

export const theFinalizerThatBlockedCleanup: Scenario = {
  id: "the-finalizer-that-blocked-cleanup",
  title: "The Finalizer That Blocked Cleanup",
  subtitle: "decommissioning old-crm-sync has been stuck for two days with no progress at all",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "finalizer", "deletion"],
  briefing: `"old-crm-sync" is being decommissioned as part of a vendor migration.
Unlike a normal cascade delete, this Application has sat completely
unchanged for two days after deletion was requested - not even partial
progress, unlike a typical "stuck on one leftover resource" case. Nothing
in "kubectl get events" for its namespace shows any activity at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-finalizer-that-blocked-cleanup",
          namespace: "argocd",
          annotations: { "deletion-requested-at": "2026-09-13T10:00:00Z" },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/old-crm-sync.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "crm-sync" },
          syncPolicy: {},
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "app-controller-notes", namespace: "crm-sync" },
        spec: {
          data: {
            "notes.md":
              "Zero cascade-deletion progress has happened at all - no resources have\nbeen removed, and the Application's own deletionTimestamp was never even\nset (`kubectl get application old-crm-sync -n argocd -o\njsonpath='{.metadata.deletionTimestamp}'` returns empty). This is\ndifferent from a cascade stuck partway through: nothing started at all.\nSeparately, `kubectl logs deploy/argocd-application-controller -n\nargocd | grep old-crm-sync` shows repeated log lines:\n'error processing application old-crm-sync: rpc error: code =\nUnavailable desc = connection error: desc = \"transport: Error while\ndialing: dial tcp: lookup crm-sync-vendor-api.internal on\n10.0.0.10:53: server misbehaving\"' - the application-controller pod\nitself has been crash-looping/repeatedly failing to even reconcile this\nApplication at all (unrelated to deletion specifically, a DNS resolution\nfailure while evaluating one of this Application's own live resources'\nhealth checks that calls out to an external endpoint), which means the\ndelete request it received was never even processed in the first place.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get application old-crm-sync -n argocd -o jsonpath='{.metadata.deletionTimestamp}'` - has deletion even actually started at the API level?",
    "`kubectl logs deploy/argocd-application-controller -n argocd | grep old-crm-sync` for what the controller itself is actually doing (or failing to do) with this specific Application.",
    "A finalizer blocking a cascade delete usually shows *some* partial progress (most resources gone, one or two stuck) - zero progress at all points somewhere further upstream, at the controller processing the Application in the first place.",
  ],
  options: [
    {
      id: "controller-failing-to-reconcile-due-to-dns",
      label:
        "The application-controller is repeatedly failing to reconcile this specific Application at all, due to a DNS resolution failure while evaluating one of its live resources' health checks - since the controller never successfully processes the Application in this state, the delete request it received two days ago was never actually picked up, which is why there's zero cascade progress rather than a cascade stuck partway through.",
      explanation:
        "`app-controller-notes` shows the deletionTimestamp was never even set, meaning the delete request never actually reached processing - consistent with the controller's own logs showing repeated failures reconciling this exact Application due to a DNS lookup failure on an external endpoint one of its resources' health checks depends on. Because the controller can't successfully process this Application in its current state at all, the delete simply never got picked up - a fundamentally different (and further upstream) situation than a cascade stuck on one leftover resource.",
    },
    {
      id: "finalizer-blocking-stuck-cascade",
      label: "The standard resources-finalizer.argocd.argoproj.io finalizer is stuck partway through a cascade delete.",
      explanation:
        "A finalizer stuck partway through a cascade would show real, if incomplete, progress - some resources gone, one or two holdouts. Here nothing has happened at all, and the Application's own deletionTimestamp was never set in the first place, which points to the delete never being processed rather than a cascade that started and then got stuck.",
    },
    {
      id: "rbac-blocks-delete-crm",
      label: "ArgoCD's ServiceAccount lacks RBAC permission to delete this Application's resources.",
      explanation:
        "An RBAC denial would still show the deletionTimestamp getting set and the controller attempting (and failing with Forbidden errors on) individual resource deletions - here the controller's logs show it isn't successfully reconciling this Application at all, for an unrelated DNS reason, before it would ever get to attempting resource-level deletes.",
    },
    {
      id: "owner-references-missing-crm",
      label: "The Application's managed resources are missing proper ownerReferences, so cascade delete can't find them.",
      explanation:
        "There's no sign the controller has even begun evaluating this Application's managed resources for deletion - the controller's own logs show it's failing to reconcile the Application at all due to a DNS error, well before ownerReferences or resource discovery would come into play.",
    },
  ],
  correctOptionId: "controller-failing-to-reconcile-due-to-dns",
  resolution: `The Application's own \`metadata.deletionTimestamp\` was never set - the
delete request never actually got processed, which rules out a cascade
stuck partway through (that would show real, if incomplete, progress).
\`app-controller-notes\` explains why: the argocd-application-controller's
own logs show repeated failures reconciling this exact Application,
tracing to a DNS resolution failure on an internal hostname that one of
its live resources' own health check calls out to. Because the
controller can't successfully process this Application at all in its
current state, the delete request it received two days ago simply never
got picked up - the block is upstream of finalizers or cascade logic
entirely, in basic reconciliation.

Fix by resolving the underlying DNS failure so the controller can
actually process the Application again. If \`crm-sync-vendor-api.internal\`
is a vendor endpoint that's intentionally being decommissioned along with
this Application (plausible, given it's mid-migration), the cleanest path
is removing whatever custom health check or resource depends on
resolving it before requesting deletion, so reconciliation can proceed
independent of a target that may no longer need to exist:

\`\`\`
kubectl get configmap argocd-cm -n argocd -o yaml | grep -A3 crm-sync
# remove/adjust any custom health check referencing the vendor endpoint
\`\`\`

Once the controller can successfully reconcile this Application again
(DNS resolves, or the dependency is removed), the pending delete request
finally processes, the deletionTimestamp gets set, and the normal cascade
delete proceeds through its resources - at which point it's a standard
teardown rather than a mysteriously stalled one.`,
};
