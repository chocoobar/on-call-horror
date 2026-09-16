import type { Scenario } from "../types";

export const theFsgroupMismatch: Scenario = {
  id: "the-fsgroup-mismatch",
  title: "The fsGroup Mismatch",
  subtitle: "upload-processor can read its shared volume fine but can't write a single file to it",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "volumes", "permissions"],
  briefing: `"upload-processor" reads incoming files from a shared PVC and is supposed
to write processed output back to the same volume. Since it was switched
to run as a non-root user last week, it can list and read everything on
the volume just fine - but every write it attempts fails.`,
  constraints: [
    "The PersistentVolumeClaim itself is Bound and mounted correctly - this isn't a mounting or binding problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "upload-processor", namespace: "media", labels: { app: "upload-processor" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              securityContext: { runAsUser: 1500, runAsNonRoot: true },
              containers: [{ name: "upload-processor", image: "registry.internal/upload-processor:3.3.0", volumeMounts: [{ name: "shared", mountPath: "/data" }] }],
              volumes: [{ name: "shared", persistentVolumeClaim: { claimName: "uploads-shared" } }],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: "uploads-shared", namespace: "media" },
        spec: { storageClassName: "nfs-shared", accessModes: ["ReadWriteMany"] },
        status: { phase: "Bound" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "upload-processor-0d1e2f3g4-h5i6j", namespace: "media", labels: { app: "upload-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "upload-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "upload-processor": [
            "2026-09-15T09:30:00.100Z INFO  proc.Worker - reading /data/incoming/photo_88213.jpg - OK (2.1MB)",
            "2026-09-15T09:30:01.220Z ERROR proc.Worker - write /data/processed/photo_88213_thumb.jpg: permission denied",
          ],
        },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "uploads-volume-notes", namespace: "media" },
        spec: {
          data: {
            "notes.md":
              "The /data volume's underlying NFS export is configured with directories\nowned by group 2000, mode 0775 - group-writable, so any process whose\nsupplementary groups include GID 2000 can write, and anyone else can\nonly read. Before last week's change, upload-processor ran as root,\nwhich bypasses this check entirely. The pod spec added `runAsUser: 1500`\nbut no `fsGroup` or `supplementalGroups` - UID 1500 isn't a member of\nGID 2000 by default.\n",
          },
        },
        age: "7d",
      },
    ],
  },
  hints: [
    "`kubectl logs upload-processor-0d1e2f3g4-h5i6j -n media` - reads succeed, only writes fail, with a plain permission error.",
    "`kubectl get deployment upload-processor -n media -o yaml` - check `securityContext` for `runAsUser` versus `fsGroup`/`supplementalGroups`.",
    "`kubectl get configmap uploads-volume-notes -n media -o yaml` - what group actually owns the writable directories on this volume, and is the container's user a member of it?",
  ],
  options: [
    {
      id: "missing-fsgroup-for-writable-group",
      label:
        "The shared volume's writable directories are group-owned by GID 2000 with mode 0775 - previously upload-processor ran as root and bypassed permission checks entirely, but last week's change set `runAsUser: 1500` without adding `fsGroup: 2000` (or an equivalent supplemental group), so UID 1500 can read (mode allows read for others) but isn't in the group that's allowed to write.",
      explanation:
        "The log shows the exact split: reads succeed, writes fail with \"permission denied.\" `uploads-volume-notes` explains precisely why - the volume's write permission is gated on group membership (GID 2000, mode 0775), root always bypassed that check, and the new `runAsUser: 1500` has no accompanying `fsGroup` or `supplementalGroups` to put it in the group that's actually allowed to write. Reads working while writes fail is the signature of a mode-0775-style permission split, not a broken mount.",
    },
    {
      id: "pvc-accessmode-wrong",
      label: "The PVC's `ReadWriteMany` access mode doesn't actually support write operations from multiple pods.",
      explanation:
        "`ReadWriteMany` explicitly means multiple pods *can* mount the volume with read-write access simultaneously - that's exactly what it's for, and the PVC is confirmed `Bound`. The failure is a Unix filesystem permission check at the OS level, not an access-mode limitation.",
    },
    {
      id: "storageclass-readonly",
      label: "The `nfs-shared` StorageClass provisions volumes as read-only by default.",
      explanation:
        "If the volume were read-only at the mount or storage-class level, reads and writes would both be affected the same way (or the mount itself would be marked read-only) - here reads succeed cleanly and only writes are rejected, which points at a Unix permission/ownership issue specific to the writing user, not a blanket read-only volume.",
    },
    {
      id: "application-write-path-wrong",
      label: "upload-processor is writing to a path that doesn't exist on the volume.",
      explanation:
        "The error is explicitly \"permission denied,\" not a \"no such file or directory\" error - the path exists and is being reached, the process attempting to create a file there is simply not authorized to do so given its current user/group.",
    },
  ],
  correctOptionId: "missing-fsgroup-for-writable-group",
  resolution: `The log tells the story precisely: reads succeed, writes fail with
"permission denied." \`uploads-volume-notes\` explains the mechanism - the
volume's writable directories are owned by group 2000 with mode 0775
(group-writable, world/other-readable). Before last week, upload-processor
ran as root, which bypasses Unix permission checks entirely, so this
never mattered. The change to \`runAsUser: 1500\` was a correct security
improvement on its own, but it wasn't paired with anything that puts UID
1500 into GID 2000 - without that, the OS-level permission check on the
volume correctly denies the write, exactly as it's designed to for any
user outside that group.

The fix is adding \`fsGroup\` (or, depending on the volume type,
\`supplementalGroups\`) so the container's process actually belongs to the
group the volume expects for writes:

\`\`\`yaml
securityContext:
  runAsUser: 1500
  runAsNonRoot: true
  fsGroup: 2000
\`\`\`

\`fsGroup\` also retroactively changes group ownership of files the kubelet
manages on supported volume types, and is added as a supplemental group
to the container's process - either way, UID 1500 running with GID 2000
attached now satisfies the 0775 group-write check that was blocking it.
This is a common gap when hardening a workload to run as non-root:
switching the *user* is only half the change if the underlying storage's
permissions were implicitly relying on root's ability to bypass them.`,
};
