import type { Scenario } from "./types";

export const theForbiddenController: Scenario = {
  id: "the-forbidden-controller",
  title: "The Forbidden Controller",
  subtitle: "backup-scheduler hasn't created a single VolumeSnapshot in three days",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "rbac", "controller"],
  briefing: `"backup-scheduler" is an in-house controller that watches PVCs and creates
scheduled VolumeSnapshots for them. Its pod has been Running the whole
time, no restarts, no crash. Nobody's gotten a snapshot in three days, and
nothing about that shows up as an alert or a red status anywhere.`,
  constraints: [
    "The controller's pod itself is healthy the entire time - the process never crashes or exits.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "backup-scheduler", namespace: "backup-system", labels: { app: "backup-scheduler" } },
        spec: { replicas: 1, template: { spec: { serviceAccountName: "backup-scheduler", containers: [{ name: "backup-scheduler", image: "registry.internal/backup-scheduler:4.0.0" }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "backup-scheduler-5x6y7z8a9-b0c1d", namespace: "backup-system", labels: { app: "backup-scheduler" } },
        status: { phase: "Running", containerStatuses: [{ name: "backup-scheduler", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "backup-scheduler": [
            "2026-09-15T03:00:00.010Z INFO  scheduler.Loop - starting snapshot cycle for 14 PVCs",
            "2026-09-15T03:00:00.220Z ERROR scheduler.Loop - failed to create VolumeSnapshot for pvc/orders-db-data: volumesnapshots.snapshot.storage.k8s.io is forbidden: User \"system:serviceaccount:backup-system:backup-scheduler\" cannot create resource \"volumesnapshots\" in API group \"snapshot.storage.k8s.io\" in the namespace \"orders\"",
            "2026-09-15T03:00:00.221Z ERROR scheduler.Loop - cycle finished: 0/14 snapshots created, 14 errors",
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRole",
        metadata: { name: "backup-scheduler-role" },
        spec: {
          rules: [
            { apiGroups: [""], resources: ["persistentvolumeclaims"], verbs: ["get", "list", "watch"] },
            { apiGroups: ["snapshot.storage.k8s.io"], resources: ["volumesnapshots"], verbs: ["get", "list", "watch"] },
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "backup-scheduler-changelog", namespace: "backup-system" },
        spec: {
          data: {
            "notes.md":
              "Three days ago, backup-scheduler's ClusterRole was regenerated from an\nupdated Helm chart as part of an unrelated dependency bump. The new\nchart's default RBAC rules only grant read access (get/list/watch) to\nvolumesnapshots - the `create` verb needed to actually make new\nsnapshots was present in the old, hand-maintained ClusterRole but got\ndropped in the regenerated one.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl logs backup-scheduler-5x6y7z8a9-b0c1d -n backup-system` - the controller logs its own failures clearly, they just aren't wired to any alert.",
    "The error is a `Forbidden` RBAC denial naming a specific verb, resource, and ServiceAccount - `kubectl get clusterrole backup-scheduler-role -o yaml` to check what verbs it actually grants.",
    "Compare the ClusterRole's `volumesnapshots` rule against what the controller is actually trying to do (create vs. just read).",
  ],
  options: [
    {
      id: "clusterrole-missing-create-verb",
      label:
        "backup-scheduler-role was regenerated from an updated Helm chart three days ago and only grants `get`, `list`, `watch` on volumesnapshots - the `create` verb the controller actually needs to make new snapshots was in the old hand-maintained role but got dropped in the regeneration, so every snapshot attempt is rejected by RBAC while the controller pod itself stays perfectly healthy and never crashes.",
      explanation:
        "The pod's own log shows the exact RBAC denial: \"cannot create resource 'volumesnapshots'... is forbidden,\" naming the `backup-scheduler` ServiceAccount specifically. The current ClusterRole confirms it: `volumesnapshots` only has `get, list, watch`, no `create`. `backup-scheduler-changelog` explains why now - a chart regeneration 3 days ago (matching the 3-day gap in snapshots) replaced the old, correctly-permissioned role with one missing the create verb. The controller keeps running and logging errors, but nothing surfaces those errors as a visible failure anywhere outside its own logs.",
    },
    {
      id: "pvc-selector-mismatch",
      label: "backup-scheduler's PVC label selector stopped matching any PVCs.",
      explanation:
        "The controller's own log shows it starting a cycle \"for 14 PVCs\" - it's finding and selecting PVCs correctly. The failures happen afterward, specifically when attempting to create the VolumeSnapshot resource for each one, which is an authorization failure, not a selection problem.",
    },
    {
      id: "snapshot-storageclass-deleted",
      label: "The underlying VolumeSnapshotClass used for these snapshots was deleted.",
      explanation:
        "A missing VolumeSnapshotClass would produce a different error, referencing the snapshot class itself once a VolumeSnapshot object was actually being created - here, the request to create the VolumeSnapshot object is rejected by RBAC before it would ever reach snapshot-class validation.",
    },
    {
      id: "controller-crashlooping",
      label: "backup-scheduler's pod is crash-looping and failing to run its scheduled cycle.",
      explanation:
        "The pod shows `restartCount: 0` and `ready: true` with `state: running` - it isn't crashing at all. It runs its full cycle every time, logs detailed errors for all 14 PVCs, and just never succeeds at the one privileged operation it needs.",
    },
  ],
  correctOptionId: "clusterrole-missing-create-verb",
  resolution: `The controller's own log is precise: a \`Forbidden\` error naming the
\`backup-scheduler\` ServiceAccount and the specific missing permission -
\`create\` on \`volumesnapshots.snapshot.storage.k8s.io\`. The current
ClusterRole confirms it grants only \`get, list, watch\` on that resource,
no \`create\`. \`backup-scheduler-changelog\` explains the timing exactly: a
Helm chart regeneration three days ago (bundled into an unrelated
dependency bump) replaced the previous, correctly-scoped ClusterRole with
the chart's own default rules, which happen to omit the create verb this
controller actually depends on. The pod itself never crashes because
there's nothing wrong with the process - it runs its cycle, hits an
authorization wall on every single attempt, logs it, and moves on,
which is exactly the kind of failure that stays invisible unless someone
is watching controller logs specifically.

The fix is restoring the missing verb to the ClusterRole:

\`\`\`yaml
rules:
  - apiGroups: ["snapshot.storage.k8s.io"]
    resources: ["volumesnapshots"]
    verbs: ["get", "list", "watch", "create"]
\`\`\`

and, since this came from a regenerated Helm chart, making sure that
whatever future chart bumps happen don't silently regress custom RBAC
rules again - either by keeping this as an explicit override on top of
the chart's defaults, or by diffing generated RBAC against the previous
version before applying it. A controller that fails purely on
authorization looks completely healthy by every standard Kubernetes
health signal, so it's worth alerting on the controller's own
error-rate logs, not just its pod status.`,
};
