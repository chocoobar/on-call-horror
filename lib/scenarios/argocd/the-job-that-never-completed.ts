import type { Scenario } from "../types";

export const theJobThatNeverCompleted: Scenario = {
  id: "the-job-that-never-completed",
  title: "The Job That Never Completed",
  subtitle: "referral-engine's deploy has been Progressing for four hours, and the hook Job looks totally fine",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "sync-hooks", "health-check"],
  briefing: `"referral-engine"'s PreSync hook Job, which seeds a lookup table, shows
"Completed" in every dashboard and its pod logs clearly print "seed
complete, exiting 0" near the very end. Kubernetes itself agrees the pod
succeeded. ArgoCD, however, still refuses to move past the PreSync phase
four hours later.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-job-that-never-completed", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/referral-engine.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "referral" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "b9c0d1e" },
          health: { status: "Progressing" },
          operationState: { phase: "Running", message: "waiting for healthy state of /Job/seed-referral-lookup (Job) PreSync" },
        },
        age: "4h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "seed-referral-lookup", namespace: "referral", annotations: { "argocd.argoproj.io/hook": "PreSync" } },
        spec: { completions: 3, parallelism: 3 },
        status: { active: 1, succeeded: 2, failed: 0 },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "seed-referral-lookup-9f8e", namespace: "referral", labels: { "job-name": "seed-referral-lookup" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "seed", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: { seed: ["shard 1/3: seed complete, exiting 0"] },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "seed-referral-lookup-2a1b", namespace: "referral", labels: { "job-name": "seed-referral-lookup" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "seed", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: { seed: ["shard 2/3: seed complete, exiting 0"] },
        age: "4h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "seed-referral-lookup-7c6d", namespace: "referral", labels: { "job-name": "seed-referral-lookup" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "seed", ready: true, restartCount: 0, state: { running: {} } }],
        },
        logs: { seed: ["shard 3/3: connecting to lookup-db-replica-3.internal...", "(no further output in 4 hours - still attempting connection)"] },
        age: "4h",
      },
    ],
  },
  hints: [
    "The engineers checking this only looked at one pod's logs ('seed complete, exiting 0') - `kubectl get pods -l job-name=seed-referral-lookup -n referral` shows there's more than one.",
    "`kubectl get job seed-referral-lookup -n referral -o yaml` - check `spec.completions` against `status.succeeded`. Does the Job need more than one pod to succeed before it's actually done?",
    "The Job's health, as far as ArgoCD and Kubernetes are both concerned, depends on ALL required completions finishing, not just the first one someone happened to check.",
  ],
  options: [
    {
      id: "job-needs-3-completions-only-2-done",
      label:
        "The Job requires 3 completions (spec.completions: 3) to be considered done, and only 2 of the 3 parallel shard pods have actually succeeded - the third shard is still stuck attempting to connect to a specific database replica, and both Kubernetes and ArgoCD correctly consider the Job (and therefore the PreSync phase) incomplete until all 3 finish, even though the one pod someone happened to check did finish and print a reassuring success line.",
      explanation:
        "The Job's own status shows `succeeded: 2` against `spec.completions: 3` - genuinely not done yet. Two of the three shard pods succeeded and printed their own 'seed complete' lines; the third is still running, stuck for four hours connecting to `lookup-db-replica-3.internal`. Whoever checked 'the logs' almost certainly looked at one of the two pods that did finish, and reasonably but mistakenly concluded the whole Job was done - but ArgoCD's PreSync hook health check (and Kubernetes' own Job completion semantics) correctly require all 3 completions, not just one pod looking healthy.",
    },
    {
      id: "argocd-health-check-stuck-cache",
      label: "ArgoCD's own health check for this Job is stuck on a stale cached status.",
      explanation:
        "ArgoCD's reported status (`waiting for healthy state of the Job`) accurately reflects the Job's genuine, current state - 2 of 3 required completions, one pod still running. There's no indication of a stale cache; the operation message matches exactly what a fresh, correct read of the Job's status would show.",
    },
    {
      id: "hook-should-have-timed-out",
      label: "The PreSync hook should have a timeout that fails it automatically after this long.",
      explanation:
        "This describes a reasonable operational safeguard to consider adding, but it doesn't explain *why* the Job is actually stuck - the third shard genuinely hasn't completed because of a real connectivity problem to a specific database replica, which is the root cause worth fixing regardless of whether a timeout also gets added as a safety net.",
    },
    {
      id: "wrong-pod-selector-health-check",
      label: "ArgoCD's Job health check is using the wrong label selector and only checking one of the three pods.",
      explanation:
        "ArgoCD's Job health assessment reads the Job resource's own `status.succeeded`/`status.completions` fields directly, not individual pods via a selector - and that status (2 of 3 required) is exactly, correctly what's driving the 'still waiting' result. The Job object's status is authoritative here and is being read correctly.",
    },
  ],
  correctOptionId: "job-needs-3-completions-only-2-done",
  resolution: `The Job's own status settles it: \`spec.completions: 3\`, but
\`status.succeeded: 2\`. Two of the three parallel shard pods genuinely
finished and printed their own "seed complete" lines - which is almost
certainly what whoever checked "the logs" actually saw, reasonably (but
incorrectly) concluding the whole Job was done. The third shard pod is
still running, stuck for four hours attempting to connect to
\`lookup-db-replica-3.internal\` with no further log output since. Both
Kubernetes' own Job semantics and ArgoCD's PreSync hook health check
correctly require *all* configured completions before considering the
Job (and the PreSync phase gating the rest of the sync) healthy - one
healthy-looking pod out of three isn't enough, and ArgoCD has been
accurately, if unhelpfully-displayed, reporting exactly that the whole
time.

The real fix is diagnosing why shard 3 specifically can't reach its
database replica - likely a replica-specific network/DNS issue, or that
replica being down or unreachable while the other two (presumably
different replicas or a load-balanced endpoint) work fine:

\`\`\`
kubectl exec -n referral seed-referral-lookup-7c6d -c seed -- \\
  nslookup lookup-db-replica-3.internal
\`\`\`

Once the underlying connectivity issue for that specific replica is
fixed and the stuck pod is allowed to retry (or the Job is deleted and
re-triggered by a fresh sync once the target is reachable), the third
shard completes, the Job reaches 3/3, and the PreSync phase - and the
rest of the sync behind it - proceeds. Worth adding a Job-level
\`activeDeadlineSeconds\` too, so a genuinely stuck shard fails loudly
well before four hours pass instead of silently blocking the whole
deploy indefinitely.`,
};
