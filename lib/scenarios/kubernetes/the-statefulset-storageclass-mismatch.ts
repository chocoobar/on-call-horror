import type { Scenario } from "../types";

export const theStatefulsetStorageclassMismatch: Scenario = {
  id: "the-statefulset-storageclass-mismatch",
  title: "The StatefulSet StorageClass Mismatch",
  subtitle: "scaling elastic-search up by two nodes leaves both stuck Pending forever",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "statefulset", "storage"],
  briefing: `"elastic-search" was scaled from 3 to 5 replicas to handle a growing
index. The first 3 have run fine for a year. The 2 new ones,
\`elastic-search-3\` and \`elastic-search-4\`, have been stuck Pending since
the scale-up an hour ago, each with an unbound PVC.`,
  constraints: [
    "The cluster has plenty of available storage capacity overall - this isn't about running out of disk space.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "elastic-search", namespace: "search", labels: { app: "elastic-search" } },
        spec: {
          replicas: 5,
          serviceName: "elastic-search",
          volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { storageClassName: "ssd-fast", accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "500Gi" } } } }],
        },
        status: { readyReplicas: 3, updatedReplicas: 5, currentReplicas: 5 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "data-elastic-search-3", namespace: "search" },
        spec: { storageClassName: "ssd-fast", accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "500Gi" } } },
        status: { phase: "Pending" },
        events: [
          { type: "Warning", reason: "ProvisioningFailed", age: "58m", message: "storageclass.storage.k8s.io \"ssd-fast\" not found" },
        ],
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "storageclass-migration-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "6 months ago, the storage team migrated from a StorageClass named\n`ssd-fast` to a newer, better-tuned one named `ssd-fast-v2`, and deleted\nthe old `ssd-fast` StorageClass object once all *existing* PVCs using it\nhad finished migrating or were confirmed already Bound (a Bound PVC\nkeeps working fine even after its StorageClass object is deleted - only\n*new* PVC creation actually needs the StorageClass object to still\nexist). elastic-search's original 3 PVCs were created before the\nmigration and are already Bound, so they're unaffected. But\nelastic-search's `volumeClaimTemplates` in its spec was never updated to\nreference `ssd-fast-v2` - any *new* PVC created for a scale-up, like\ntoday's, still asks for a StorageClass that no longer exists at all.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl describe pvc data-elastic-search-3 -n search` - the `ProvisioningFailed` event names the exact problem.",
    "`kubectl get storageclass` - does `ssd-fast` actually still exist as an object in the cluster?",
    "The original 3 replicas work fine - what's different about a *new* PVC being created now versus the ones already Bound a year ago?",
  ],
  options: [
    {
      id: "storageclass-deleted-after-migration-template-not-updated",
      label:
        "The `ssd-fast` StorageClass was deleted 6 months ago after the storage team migrated everyone to `ssd-fast-v2`, safe at the time because every *existing* PVC using it was already Bound (a Bound PVC keeps working after its StorageClass object is gone) - but elastic-search's `volumeClaimTemplates` was never updated to the new class name, so today's scale-up tries to create brand-new PVCs still requesting a StorageClass that no longer exists, which fails provisioning outright while the original 3 already-Bound replicas remain completely unaffected.",
      explanation:
        "The PVC's own event is explicit: `storageclass.storage.k8s.io \"ssd-fast\" not found`. `storageclass-migration-notes` explains exactly why this only affects new replicas: the migration was considered complete and safe based on existing PVCs already being Bound, which doesn't require the StorageClass object to persist - but nothing caught that elastic-search's StatefulSet spec itself still referenced the old, now-deleted class name for any *future* PVC creation, which is precisely what a scale-up triggers.",
    },
    {
      id: "insufficient-storage-capacity",
      label: "The underlying storage backend has run out of capacity for new 500Gi volumes.",
      explanation:
        "The scenario confirms ample available storage capacity cluster-wide, and the PVC's own event is specific and different from a capacity error - it names a StorageClass that doesn't exist at all, which is a configuration/reference problem, not a capacity shortfall.",
    },
    {
      id: "statefulset-replica-count-race",
      label: "Scaling a StatefulSet's replica count too quickly causes a race condition in PVC creation.",
      explanation:
        "There's no race condition here - the PVC creation request itself is well-formed and reaches the provisioner correctly, it's simply requesting a StorageClass object that was deleted six months ago. The failure is deterministic and would happen on every single scale-up attempt, not intermittently as a race would suggest.",
    },
    {
      id: "rbac-blocking-pvc-creation",
      label: "RBAC permissions are blocking the StatefulSet controller from creating new PVCs.",
      explanation:
        "An RBAC denial produces a `Forbidden` error naming the blocked verb/resource/user, not a `ProvisioningFailed` event citing a specific missing StorageClass by name - the PVC object itself was successfully created, it's the provisioning step afterward that fails on a StorageClass reference that no longer exists.",
    },
  ],
  correctOptionId: "storageclass-deleted-after-migration-template-not-updated",
  resolution: `The PVC's own event names the problem exactly: \`storageclass.storage.k8s.io
"ssd-fast" not found\`. \`storageclass-migration-notes\` explains how a
storage migration six months ago left this landmine: \`ssd-fast\` was
retired in favor of \`ssd-fast-v2\`, and the old StorageClass object was
deleted once every *existing* PVC using it was confirmed Bound - a
reasonable, safe-at-the-time call, since a Bound PVC doesn't need its
StorageClass object to keep existing to keep working. What nobody
updated was elastic-search's own \`volumeClaimTemplates\`, which still
names the now-deleted \`ssd-fast\`. The original 3 replicas, whose PVCs
were created and Bound before the migration, are completely unaffected -
it's only today's scale-up, which needs to create genuinely *new* PVCs,
that hits a StorageClass reference pointing at nothing.

The fix is updating the StatefulSet's volume claim template to the
current StorageClass name:

\`\`\`yaml
volumeClaimTemplates:
  - metadata: { name: data }
    spec:
      storageClassName: ssd-fast-v2   # was: ssd-fast
      accessModes: [ReadWriteOnce]
      resources: { requests: { storage: 500Gi } }
\`\`\`

Note that \`volumeClaimTemplates\` is immutable on an existing StatefulSet
- this requires deleting and recreating the StatefulSet object with
\`--cascade=orphan\` (to avoid touching the already-Bound PVCs and their
Pods) before reapplying with the corrected template, so the existing 3
replicas' storage is preserved untouched while new replicas get the
corrected class. More broadly, a StorageClass migration should include
an audit of every StatefulSet's volumeClaimTemplates referencing the old
name, not just confirming existing PVCs are safely Bound - a workload
that hasn't scaled since the migration can carry this exact landmine
silently for months before anyone notices.`,
};
