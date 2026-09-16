import type { Scenario } from "./types";

export const theVanishingRollback: Scenario = {
  id: "the-vanishing-rollback",
  title: "The Vanishing Rollback",
  subtitle: "checkout-web's bad deploy needs to be undone, and there's nothing to undo to",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "rollout", "deployment"],
  briefing: `A deploy of "checkout-web" five minutes ago is clearly broken - error rate
spiked immediately. The standard move is \`kubectl rollout undo\`, which
has worked every time before. This time it fails outright, and there's no
previous version to fall back to as far as Kubernetes is concerned.`,
  constraints: [
    "The previous ReplicaSet's pods were scaled down as part of this rollout, as normal - they aren't sitting around available to just re-scale manually.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-web", namespace: "checkout", labels: { app: "checkout-web" } },
        spec: { replicas: 5, revisionHistoryLimit: 0 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 2, unavailableReplicas: 3 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "5m", message: "Scaled up replica set checkout-web-8f9g0h1i2 to 5" },
        ],
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "ReplicaSet",
        metadata: { name: "checkout-web-8f9g0h1i2", namespace: "checkout", labels: { app: "checkout-web" } },
        spec: { replicas: 5 },
        status: { replicas: 5, readyReplicas: 2 },
        age: "5m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-web-8f9g0h1i2-k3l4m", namespace: "checkout", labels: { app: "checkout-web" } },
        status: { phase: "Running", containerStatuses: [{ name: "checkout-web", ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
        logs: { "checkout-web": ["2026-09-15T10:00:01Z FATAL config.Loader - required env var PAYMENT_GATEWAY_URL is unset"] },
        age: "5m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-web-cicd-notes", namespace: "checkout" },
        spec: {
          data: {
            "notes.md":
              "`kubectl rollout undo deployment/checkout-web -n checkout` returned:\n\"error: unable to find specified revision\" - there is no prior\nReplicaSet revision retained to roll back to. The Deployment's manifest\nwas updated three weeks ago to add `revisionHistoryLimit: 0` as part of\na cluster-wide 'reduce old ReplicaSet clutter' cleanup effort, which\nmeans Kubernetes garbage-collects every old ReplicaSet as soon as a new\none is fully rolled out - there is nothing left to roll back to, by\ndesign of that setting, regardless of how good the previous version was.\n",
          },
        },
        age: "1m",
      },
    ],
  },
  hints: [
    "`kubectl rollout undo deployment/checkout-web -n checkout` and read the actual error text - it's specific.",
    "`kubectl rollout history deployment/checkout-web -n checkout` - how many revisions actually show up?",
    "`kubectl get deployment checkout-web -n checkout -o yaml` - check `spec.revisionHistoryLimit`. What does that field control, exactly?",
  ],
  options: [
    {
      id: "revision-history-limit-zero",
      label:
        "checkout-web's `revisionHistoryLimit` was set to 0 three weeks ago as part of a ReplicaSet-cleanup effort - Kubernetes garbage-collects old ReplicaSets down to that limit as soon as a new rollout completes, so the moment this broken deploy finished rolling out, the previous good ReplicaSet was deleted entirely, leaving `rollout undo` with nothing to roll back to.",
      explanation:
        "`checkout-web-cicd-notes` shows the exact `rollout undo` error - \"unable to find specified revision\" - and explains the cause: `revisionHistoryLimit: 0`, added three weeks ago, tells Kubernetes to retain zero old ReplicaSets after a rollout completes. That setting doesn't care whether the new version turns out to be good or broken - it deletes the old ReplicaSet unconditionally once the new one is fully available, which is exactly what removed the only thing `rollout undo` needs.",
    },
    {
      id: "deployment-selector-changed",
      label: "The Deployment's pod selector was changed in this deploy, orphaning the old ReplicaSet.",
      explanation:
        "A changed selector would leave the old ReplicaSet still existing (just unmanaged/orphaned) rather than producing an \"unable to find specified revision\" error, and there's no evidence of a selector change here - the actual error and the ConfigMap's notes point specifically at `revisionHistoryLimit`.",
    },
    {
      id: "rbac-blocking-rollback",
      label: "RBAC permissions are blocking the rollback operation itself.",
      explanation:
        "An RBAC denial produces a `Forbidden` error naming the user, verb, and resource - not \"unable to find specified revision,\" which is a distinct error meaning the rollback target simply doesn't exist anymore, not that permission to perform it was denied.",
    },
    {
      id: "new-replicaset-not-created",
      label: "The new ReplicaSet was never actually created, so there's nothing to roll back from.",
      explanation:
        "`checkout-web-8f9g0h1i2` clearly exists with `replicas: 5` and crash-looping pods under it - the new ReplicaSet was created and is very much running (badly). The missing piece is the *old* ReplicaSet to roll back *to*, not the new one.",
    },
  ],
  correctOptionId: "revision-history-limit-zero",
  resolution: `\`checkout-web-cicd-notes\` captures the exact failure: \`rollout undo\`
returning "unable to find specified revision." The cause is
\`spec.revisionHistoryLimit: 0\`, added three weeks ago during a cleanup
effort aimed at reducing clutter from old ReplicaSets sitting around
forever. That setting works exactly as configured: Kubernetes garbage
collects old ReplicaSets down to the configured limit as soon as a new
rollout finishes becoming available - it has no concept of "keep the last
good one just in case," it simply enforces the number. The moment this
broken deploy's ReplicaSet became available, the previous (working) one
was deleted, taking checkout-web's only rollback target with it.

There's no live fix from this read-only console for the immediate
incident - without a retained revision, "rolling back" means manually
re-deploying the last known-good image and config from source control or
CI history:

\`\`\`bash
kubectl set image deployment/checkout-web checkout-web=registry.internal/checkout-web:<last-good-tag> -n checkout
\`\`\`

Longer term, \`revisionHistoryLimit: 0\` is a genuine footgun for any
Deployment where a fast rollback matters - a value like 3-5 keeps enough
history for \`rollout undo\` to actually work while still bounding clutter,
which is a much safer way to solve the original "too many old
ReplicaSets" complaint than eliminating history entirely:

\`\`\`yaml
spec:
  revisionHistoryLimit: 5
\`\`\``,
};
