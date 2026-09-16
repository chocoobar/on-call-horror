import type { Scenario } from "../types";

export const zombiePods: Scenario = {
  id: "zombie-pods",
  title: "The Zombie Pods",
  subtitle: "queue-worker keeps dying and coming back",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["argocd", "gitops", "deployment"],
  briefing: `The "queue-worker" background job Application synced cleanly according to
ArgoCD - Synced, no errors reported at the sync level - but the pods it
deployed keep restarting. Whoever wrote the last commit to the GitOps repo
for this app clearly didn't test it locally first.`,
  constraints: [
    "This Application has selfHeal enabled - any live kubectl fix would just get reverted. The real fix has to happen in the GitOps source (out of scope for this read-only console - focus on diagnosing it correctly).",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "zombie-pods", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/workers.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "workers" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "a1b2c3d4e5f6" }, health: { status: "Degraded" } },
        age: "34m",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "queue-worker", namespace: "workers", labels: { app: "queue-worker" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "34m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "queue-worker-7d9f8c6b5-4kxqz", namespace: "workers", labels: { app: "queue-worker" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "queue-worker", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } },
          ],
        },
        logs: { "queue-worker": ["fatal: cannot bind to queue"] },
        previousLogs: { "queue-worker": ["fatal: cannot bind to queue"] },
        events: [
          { type: "Warning", reason: "BackOff", age: "40s", message: "Back-off restarting failed container queue-worker in pod queue-worker-7d9f8c6b5-4kxqz_workers" },
        ],
        age: "34m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "queue-worker-7d9f8c6b5-9plm2", namespace: "workers", labels: { app: "queue-worker" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "queue-worker", ready: false, restartCount: 6, state: { waiting: { reason: "CrashLoopBackOff" } } },
          ],
        },
        logs: { "queue-worker": ["fatal: cannot bind to queue"] },
        previousLogs: { "queue-worker": ["fatal: cannot bind to queue"] },
        events: [
          { type: "Warning", reason: "BackOff", age: "55s", message: "Back-off restarting failed container queue-worker in pod queue-worker-7d9f8c6b5-9plm2_workers" },
        ],
        age: "34m",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n workers` first - the STATUS and RESTARTS columns already tell a story.",
    "`kubectl logs <pod> -n workers` (or `--previous`) to see exactly what the container prints right before it dies.",
    "This isn't a scheduling or image problem - the container starts fine and then exits on its own, on purpose, immediately.",
  ],
  options: [
    {
      id: "image-pull",
      label: "The container image tag doesn't exist, so pods are stuck ImagePullBackOff.",
      explanation:
        "The pods are Running (briefly) with restartCount climbing and status CrashLoopBackOff, not ImagePullBackOff - the image pulls and starts fine, it's the container's own command that fails.",
    },
    {
      id: "bad-command",
      label: "The container's command exits immediately with a failure every time it starts, so Kubernetes keeps restarting it.",
      explanation:
        "The logs (\"fatal: cannot bind to queue\") show the process itself exiting on startup - that's exactly what CrashLoopBackOff with a climbing restart count and 0/1 Ready means. This needs a fix to the container's command/config in the GitOps source.",
    },
    {
      id: "zero-replicas",
      label: "The Deployment in git is set to 0 replicas.",
      explanation:
        "spec.replicas is 2, and there are 2 pods that exist and keep restarting - the problem isn't a missing/zeroed Deployment, it's that the pods that do get created keep crashing.",
    },
    {
      id: "pdb",
      label: "A missing PodDisruptionBudget is blocking the rollout.",
      explanation:
        "A PodDisruptionBudget affects voluntary evictions during rollouts/drains, not why an individual container process exits on startup. The logs point directly at the container's own command failing.",
    },
  ],
  correctOptionId: "bad-command",
  resolution: `\`kubectl logs -l app=queue-worker -n workers --previous\` shows
\`fatal: cannot bind to queue\`, coming straight from the container's own
command - it's written to exit with a failure code immediately, every
time, on purpose (that's the bug someone shipped).

The fix belongs in the GitOps source: replace the broken \`command\` with one
that actually runs and keeps running, e.g.

\`\`\`yaml
command: ["sh", "-c", "while true; do echo working; sleep 5; done"]
\`\`\`

commit it, and ArgoCD's automated sync (selfHeal included) rolls out fresh
pods with 0 restarts.`,
};
