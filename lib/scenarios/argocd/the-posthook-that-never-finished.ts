import type { Scenario } from "../types";

export const thePosthookThatNeverFinished: Scenario = {
  id: "the-posthook-that-never-finished",
  title: "The PostHook That Never Finished",
  subtitle: "warehouse-sync has been \"Progressing\" for six hours after a routine deploy",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "sync-hooks", "postsync"],
  briefing: `A routine deploy of "warehouse-sync" six hours ago should have taken about
three minutes, like every deploy before it. Instead the Application has
been stuck in "Progressing" ever since. The Deployment itself looks
completely healthy - all pods ready, no crashes - but the sync operation
itself refuses to report success.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-posthook-that-never-finished", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/warehouse-sync.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "warehouse" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "8b7c6d5" },
          health: { status: "Progressing" },
          operationState: { phase: "Running", message: "waiting for healthy state of /Job/warehouse-cache-warm (Job) PostSync" },
        },
        age: "6h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "warehouse-sync", namespace: "warehouse", labels: { app: "warehouse-sync" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: "warehouse-cache-warm",
          namespace: "warehouse",
          annotations: { "argocd.argoproj.io/hook": "PostSync" },
        },
        status: { active: 1, succeeded: 0, failed: 0 },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "warehouse-cache-warm-x7k2p", namespace: "warehouse", labels: { "job-name": "warehouse-cache-warm" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "cache-warm", ready: true, restartCount: 0, state: { running: {} } }],
        },
        logs: {
          "cache-warm": [
            "Warming cache for 50,000 SKUs...",
            "Processed 12,000 / 50,000...",
            "Processed 24,000 / 50,000...",
            "(this pace has been steady for 6 hours - originally scoped and tested against a 5,000 SKU staging dataset)",
          ],
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-posthook-that-never-finished -n argocd` - `status.operationState.message` explains exactly what the sync is still waiting on.",
    "`kubectl get job warehouse-cache-warm -n warehouse` - a PostSync hook Job has to reach Succeeded before ArgoCD considers the sync operation complete, no matter how healthy the actual Deployment looks.",
    "`kubectl logs -l job-name=warehouse-cache-warm -n warehouse` - is the Job actually stuck, or just extremely slow for the amount of data it's processing?",
  ],
  options: [
    {
      id: "postsync-job-slow-not-stuck",
      label:
        "The PostSync hook Job is still legitimately running, not stuck - it's processing 50,000 SKUs (10x the 5,000-SKU staging dataset it was originally scoped and tested against) at the same steady pace it always ran at, so it simply takes far longer at production scale, and ArgoCD correctly won't report the sync complete until this hook Job succeeds.",
      explanation:
        "`status.operationState.message` explicitly says the sync is waiting on the PostSync Job to reach a healthy state - that's expected, correct behavior for a PostSync hook, not a stuck sync. The Job's own logs show it steadily progressing (12,000 then 24,000 of 50,000 processed) at a consistent rate, with a note that it was only ever tested against a 5,000-SKU staging dataset - at 10x the data, taking roughly 10x as long lines up with 'still running, not stuck' rather than a hang.",
    },
    {
      id: "hook-pod-crashlooping",
      label: "The PostSync hook's pod is crash-looping and ArgoCD keeps retrying it.",
      explanation:
        "The hook Pod's own status shows it `Running` with `ready: true` and `restartCount: 0` - there's no crash loop here at all. It's a single long-running execution making steady, visible progress through its logs, not a pod repeatedly failing and restarting.",
    },
    {
      id: "deployment-health-blocking-sync",
      label: "The Deployment itself hasn't actually reached a healthy state, despite appearing ready.",
      explanation:
        "The Deployment's own status shows readyReplicas, updatedReplicas, and availableReplicas all at 3/3 - genuinely healthy by every standard signal. The sync is explicitly waiting on the separate PostSync Job, per the operation message, not on the Deployment's own health.",
    },
    {
      id: "sync-wave-misconfigured-posthook",
      label: "The PostSync hook has an incorrect sync-wave annotation causing it to run out of order.",
      explanation:
        "PostSync hooks run after the main sync phase completes by definition - a sync-wave annotation on a hook governs ordering *among hooks/resources of the same hook type*, not whether the hook runs at the right overall phase. There's no indication of ordering being wrong here; the Job is running in the correct phase, just slowly.",
    },
  ],
  correctOptionId: "postsync-job-slow-not-stuck",
  resolution: `\`status.operationState.message\` is explicit: the sync is waiting on the
PostSync hook Job, \`warehouse-cache-warm\`, to reach a healthy (succeeded)
state - that's how PostSync hooks are supposed to gate sync completion,
not a malfunction. The Job's own logs show it steadily working through a
50,000-SKU cache-warming pass, having processed 24,000 so far at a
consistent rate - with a note that this Job was only ever tested against
a 5,000-SKU staging dataset. At 10x the real data volume and the same
per-item processing rate, a run that took roughly 3 minutes in staging
taking multiple hours in production tracks almost exactly.

This isn't really a "diagnose and revert a bug" fix - it's confirming
the sync genuinely will complete once the Job finishes (it will, on its
current trajectory), and then addressing why it wasn't scoped to
production data size. Worth adding progress-aware parallelism or batching
to the Job so cache warming scales with data volume:

\`\`\`yaml
# Job spec
spec:
  parallelism: 8   # was 1 - process SKU batches concurrently
  completions: 8
\`\`\`

and, going forward, load-testing hook Jobs like this against
production-scale data before relying on their runtime in a PostSync gate
- a hook that quietly takes hours under real load looks identical, from
the Application's status alone, to one that's truly stuck.`,
};
