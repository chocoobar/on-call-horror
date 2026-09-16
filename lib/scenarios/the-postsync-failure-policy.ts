import type { Scenario } from "./types";

export const thePostsyncFailurePolicy: Scenario = {
  id: "the-postsync-failure-policy",
  title: "The PostSync Failure Policy",
  subtitle: "a failed cache-warm hook is quietly leaving warehouse-api's Application stuck Progressing forever",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "sync-hooks", "postsync"],
  briefing: `"warehouse-api"'s PostSync hook warms a cache after every deploy - a nice
optimization, not something the app actually depends on to function
(there's a documented, tested cold-cache fallback path). Today's cache
warm hook failed due to an unrelated, transient network blip - and now
the whole Application is stuck Progressing, even though the actual
Deployment has been fully healthy and serving traffic normally the entire
time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-postsync-failure-policy", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/warehouse-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "warehouse" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "c2d3e4f" },
          health: { status: "Progressing" },
          operationState: { phase: "Running", message: "waiting for healthy state of /Job/warm-warehouse-cache (Job) PostSync" },
        },
        age: "2h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "warehouse-api", namespace: "warehouse", labels: { app: "warehouse-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "2h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: "warm-warehouse-cache",
          namespace: "warehouse",
          annotations: { "argocd.argoproj.io/hook": "PostSync", "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation" },
        },
        spec: { backoffLimit: 0 },
        status: { failed: 1 },
        events: [
          { type: "Warning", reason: "BackoffLimitExceeded", age: "1h55m", message: "Job has reached the specified backoff limit" },
        ],
        previousLogs: { warm: ["connecting to cache-warmer-upstream.internal:6379...", "ERROR: connection reset by peer (transient network error)"] },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "postsync-design-notes", namespace: "warehouse" },
        spec: {
          data: {
            "notes.md":
              "This PostSync hook has `backoffLimit: 0` (no retries) and no ArgoCD\nsync-option marking it non-blocking. A PostSync hook failing does not\nautomatically fail the overall sync operation the way a failed PreSync\nhook or a failed main-phase resource does - but ArgoCD's Application\nhealth status still factors in the PreSync/Sync/PostSync hook resources\nthemselves as part of what it evaluates for overall health, and\noperationState.phase stays 'Running' (not 'Failed', not 'Succeeded')\nwhile any hook resource with no defined completion state sits at a\nfailed, non-succeeded terminal state and hasn't been explicitly\nacknowledged/retried - the sync operation itself is, practically\nspeaking, stuck waiting on a hook resource that will never on its own\nbecome healthy without intervention, even though nothing about the\napp's actual runtime health depends on it.",
          },
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "`kubectl get deployment warehouse-api -n warehouse` - the actual application is fully healthy and serving traffic. The stuck status is entirely about the hook.",
    "`kubectl logs job/warm-warehouse-cache -n warehouse --previous` - the failure is a transient, unrelated network error, not a bug in the hook itself.",
    "`kubectl get configmap postsync-design-notes -n warehouse -o yaml` for exactly why a failed, non-retrying PostSync hook leaves the whole sync operation stuck rather than just failing cleanly.",
  ],
  options: [
    {
      id: "failed-nonretrying-postsync-hook-blocks-operation-state",
      label:
        "The PostSync cache-warm hook failed due to a transient, unrelated network blip, has no retries configured (backoffLimit: 0), and there's no sync option marking it non-blocking - so even though the Deployment itself is fully healthy and the cache-warm is a pure optimization the app doesn't actually depend on, the sync operation stays stuck 'Running' indefinitely waiting on a hook resource that will never become healthy without manual intervention.",
      explanation:
        "`postsync-design-notes` explains the mechanism: the Deployment is genuinely healthy (4/4 ready), and the hook's own failure is a one-off transient network error, not a real bug - but with `backoffLimit: 0` and no non-blocking sync option configured, the failed hook Job simply sits in a failed, non-succeeded state, and ArgoCD's operation state stays 'Running' waiting on it, rather than either retrying or explicitly failing/completing. The app works fine in practice; the sync operation's bookkeeping is what's actually stuck.",
    },
    {
      id: "deployment-actually-unhealthy",
      label: "The Deployment itself has a subtle health issue despite looking ready.",
      explanation:
        "`status.readyReplicas`, `updatedReplicas`, and `availableReplicas` are all 4/4 with no crash events, restarts, or other signals of trouble - by every standard measure the Deployment is genuinely healthy. The stuck status is entirely attributable to the separate PostSync hook Job, not anything about the Deployment.",
    },
    {
      id: "cache-warmer-upstream-permanently-down",
      label: "The upstream cache-warmer service is permanently down, not just transiently.",
      explanation:
        "The error message itself describes a 'connection reset by peer' - characteristic of a transient network blip rather than a sustained outage, and there's no indication (like a repeated retry all failing identically over hours) that the upstream is permanently unreachable; the Job simply never got a chance to retry at all, given `backoffLimit: 0`.",
    },
    {
      id: "selfheal-blocking-postsync-resolution",
      label: "selfHeal is preventing the failed hook from being retried or cleaned up.",
      explanation:
        "selfHeal reconciles live resources against what's declared in git - it has no special interaction with a hook Job's own retry/backoff behavior or its terminal failed state. The hook simply isn't configured to retry at all (backoffLimit: 0), independent of anything selfHeal does or doesn't do.",
    },
  ],
  correctOptionId: "failed-nonretrying-postsync-hook-blocks-operation-state",
  resolution: `The Deployment itself is unambiguously healthy - 4/4 ready, no
restarts, no error events - confirming the app has been working and
serving traffic normally the whole two hours. \`postsync-design-notes\`
explains why the Application still shows stuck Progressing anyway: the
PostSync cache-warm hook failed due to a one-off, transient network reset
against an unrelated upstream service, but with \`backoffLimit: 0\` it
never got a chance to retry, and there's no sync option marking this hook
as non-blocking. The failed hook Job just sits there in a terminal failed
state, and ArgoCD's operation state stays "Running," effectively waiting
indefinitely on a hook resource that will never resolve itself without
someone intervening - even though the actual application doesn't depend
on it at all.

Immediate fix: manually retry the hook by deleting the failed Job (its
own `hook-delete-policy: BeforeHookCreation` means a fresh sync/retry
will recreate it cleanly):

\`\`\`
kubectl delete job warm-warehouse-cache -n warehouse
argocd app sync the-postsync-failure-policy
\`\`\`

Longer-term fix, given this hook is explicitly documented as a
non-critical optimization with a tested cold-cache fallback: give it
retries so a single transient blip doesn't block the whole sync
operation, and consider whether it truly needs to gate sync completion at
all:

\`\`\`yaml
metadata:
  annotations:
    argocd.argoproj.io/hook: PostSync
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
spec:
  backoffLimit: 3   # was 0 - allow retries against transient failures
\`\`\`

Retries alone would have resolved today's incident automatically, without
ever needing manual intervention - worth applying the same review to any
other "nice to have, not actually required" PostSync hook in the org that
currently has zero retry tolerance.`,
};
