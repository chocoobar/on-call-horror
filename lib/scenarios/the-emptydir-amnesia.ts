import type { Scenario } from "./types";

export const theEmptydirAmnesia: Scenario = {
  id: "the-emptydir-amnesia",
  title: "The emptyDir Amnesia",
  subtitle: "session-cache loses every session the moment a pod restarts",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "storage", "volumes"],
  briefing: `Users keep getting logged out at random, and support has traced it to
"session-cache" pods restarting for routine reasons (rolling updates, the
occasional OOM) - the same behavior it's always had. What's new is that
every restart now wipes every session on that pod instead of the data
surviving like it used to.`,
  constraints: [
    "This is a single-replica-per-session model by design - sessions aren't expected to survive a *node* failure, only an ordinary pod restart on the same node.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-cache", namespace: "auth", labels: { app: "session-cache" } },
        spec: {
          replicas: 1,
          template: {
            spec: {
              containers: [{ name: "session-cache", image: "registry.internal/session-cache:1.9.0", volumeMounts: [{ name: "sessions", mountPath: "/data/sessions" }] }],
              volumes: [{ name: "sessions", emptyDir: {} }],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "session-cache-4p5q6r7s8-t9u0v", namespace: "auth", labels: { app: "session-cache" } },
        status: { phase: "Running", containerStatuses: [{ name: "session-cache", ready: true, restartCount: 3, state: { running: { startedAt: "2026-09-15T08:00:00Z" } } }] },
        logs: {
          "session-cache": [
            "2026-09-15T08:00:00.010Z INFO  cache.Store - /data/sessions is empty, starting with a cold cache",
            "2026-09-15T08:00:00.015Z WARN  cache.Store - no session data recovered from previous instance",
          ],
        },
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "session-cache-migration-notes", namespace: "auth" },
        spec: {
          data: {
            "notes.md":
              "Before the container image was rebased onto a slimmer base 3 days ago,\nsession-cache used a PersistentVolumeClaim named `session-cache-data`\nmounted at /data/sessions. The new manifest generated during that rebase\naccidentally used `emptyDir: {}` for the same mount path instead of\nreferencing the existing PVC - the app itself is unchanged and still\nwrites session files to the same path.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get deployment session-cache -n auth -o yaml` - look closely at the `volumes` section for the `sessions` volume's type.",
    "An `emptyDir` volume's contents are deleted whenever the pod is removed from a node, including a routine restart - a PVC's contents survive that.",
    "`kubectl get configmap session-cache-migration-notes -n auth -o yaml` - what did this mount used to be, before a recent change?",
  ],
  options: [
    {
      id: "emptydir-instead-of-pvc",
      label:
        "session-cache's volume mount at /data/sessions was switched from a PersistentVolumeClaim to `emptyDir: {}` during a recent rebase of the manifest - emptyDir's contents are deleted whenever the pod is removed from its node, so every restart (rolling update, OOM, anything) now wipes all session data, whereas the PVC it replaced would have preserved it.",
      explanation:
        "The Deployment's volume definition shows `emptyDir: {}` for the `sessions` volume. `session-cache-migration-notes` confirms this used to be a PVC (`session-cache-data`) before a 3-day-old manifest rebase, and the pod's own startup log - \"no session data recovered from previous instance\" - is the direct symptom: an emptyDir is deleted along with the pod, so a fresh pod always starts with a truly empty directory, no matter how routine or expected the restart was.",
    },
    {
      id: "session-cache-bug-clearing-data",
      label: "session-cache has an application bug that clears its own cache on startup.",
      explanation:
        "The log line \"/data/sessions is empty, starting with a cold cache\" shows the app correctly detecting an empty directory and reacting sensibly - it isn't clearing anything itself, there's simply nothing there to find, which is a volume persistence problem, not an application bug.",
    },
    {
      id: "pvc-storageclass-full",
      label: "The underlying PersistentVolumeClaim's storage class ran out of capacity.",
      explanation:
        "There's no PersistentVolumeClaim involved in this pod's current volume configuration at all - the mount is an `emptyDir`, which doesn't use a StorageClass or have a capacity ceiling in the way a PVC-backed volume would.",
    },
    {
      id: "node-restarted",
      label: "The underlying node was restarted, which would wipe any local storage.",
      explanation:
        "The scenario explicitly notes this is about ordinary pod restarts, not node failures or node restarts - and even so, the pod's own restart count (3) on a single node over 8 hours points at routine in-place restarts, which an emptyDir doesn't survive regardless of whether the node itself ever moved.",
    },
  ],
  correctOptionId: "emptydir-instead-of-pvc",
  resolution: `The Deployment's \`sessions\` volume is defined as \`emptyDir: {}\`.
\`session-cache-migration-notes\` explains how it got that way: a manifest
rebase 3 days ago (done alongside an unrelated base-image slimming
change) swapped what used to be a PersistentVolumeClaim
(\`session-cache-data\`) for an emptyDir at the same mount path, almost
certainly a copy-paste or generator mistake rather than an intentional
choice. An emptyDir's contents live only as long as the pod is on its
node - any restart, rolling update, or OOM kill wipes it clean, which
matches the pod's own log line exactly: "no session data recovered from
previous instance."

The fix is reverting the mount back to the PVC it was supposed to keep
using:

\`\`\`yaml
volumes:
  - name: sessions
    persistentVolumeClaim:
      claimName: session-cache-data
\`\`\`

(re-creating \`session-cache-data\` first if the original PVC object itself
was also removed in the same rebase). Since \`emptyDir\` and
\`persistentVolumeClaim\` are both valid ways to fill the exact same mount
path in a pod spec, a manifest generator or copy-paste error swapping one
for the other produces no validation error at all - the pod schedules and
runs perfectly, it just silently stops persisting anything past a
restart.`,
};
