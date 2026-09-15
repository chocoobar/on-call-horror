import type { Scenario } from "./types";

export const quotaOfSilence: Scenario = {
  id: "quota-of-silence",
  title: "Quota of Silence",
  subtitle: "the deploy succeeded. the pods never showed up.",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "resourcequota", "deployment"],
  briefing: `\`kubectl apply\` for "fraud-detector"'s new Deployment returned success with
no errors. Twenty minutes later, there still isn't a single pod running
for it - not crashing, not pending, just... not there.`,
  constraints: [
    "The Deployment object itself exists and looks correct - the problem is somewhere between the Deployment and any pod actually coming into existence.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fraud-detector", namespace: "risk", labels: { app: "fraud-detector" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 0, updatedReplicas: 0, availableReplicas: 0 },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "ResourceQuota",
        metadata: { name: "risk-team-quota", namespace: "risk" },
        spec: { hard: { "requests.cpu": "8", "requests.memory": "16Gi", pods: "20" } },
        status: { used: { "requests.cpu": "7500m", "requests.memory": "14Gi", pods: "20" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "risk-namespace-notes", namespace: "risk" },
        spec: {
          data: {
            "notes.md":
              "The `risk` namespace already runs 20 pods across fraud-scoring,\nchargeback-worker, and a few cron Jobs - right at the namespace's pod\nquota. fraud-detector's Deployment asks for 4 more replicas, which\nwould push the namespace to 24.\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "`kubectl get resourcequota risk-team-quota -n risk -o yaml` - compare `status.used` against `spec.hard`.",
    "A Deployment being created successfully only creates a ReplicaSet, which then tries to create Pods - each of those is a separate API call that can be rejected independently, even if the Deployment itself was accepted just fine.",
    "`kubectl get configmap risk-namespace-notes -n risk -o yaml` - how many pods does this namespace already have running, and how many more is this Deployment asking for?",
  ],
  options: [
    {
      id: "pod-quota-exhausted",
      label:
        "The `risk` namespace's ResourceQuota already has `pods: 20` used out of a hard limit of 20 - fraud-detector's Deployment was accepted, and its ReplicaSet was created, but every attempt to create an actual Pod under it gets rejected by the quota admission check, since the namespace has no pod slots left at all.",
      explanation:
        "`risk-team-quota`'s `status.used.pods` is already at its `spec.hard.pods` limit of 20. A Deployment applying successfully only means the Deployment object itself was accepted - the ReplicaSet controller then tries to create Pods as a separate step, and each of those creation calls goes through admission control, including ResourceQuota enforcement, independently. With the namespace already at its pod quota, every one of those Pod-creation attempts is rejected, which is exactly consistent with a Deployment that exists, shows 0 ready/available replicas, and never produces a single Pod object to even show up as Pending.",
    },
    {
      id: "image-pull-secret-missing",
      label: "The Deployment is missing an image pull secret, so pods fail to start.",
      explanation:
        "A missing pull secret would still result in actual Pod objects existing (visible via `kubectl get pods`, likely showing `ImagePullBackOff`) - here there are no Pod objects at all for this Deployment, which points at something blocking Pod creation itself, earlier in the process.",
    },
    {
      id: "namespace-terminating",
      label: "The `risk` namespace is stuck in a Terminating state.",
      explanation:
        "The Deployment itself was created successfully and is visible and gettable - a namespace stuck Terminating would typically block new object creation entirely, including the Deployment itself, not just its Pods.",
    },
    {
      id: "deployment-selector-wrong",
      label: "The Deployment's pod template selector doesn't match its own labels.",
      explanation:
        "A selector mismatch on the Deployment itself is normally rejected immediately at apply time with a validation error - this Deployment applied cleanly with no error, and the failure is happening later, at Pod creation, not at the Deployment's own validation.",
    },
  ],
  correctOptionId: "pod-quota-exhausted",
  resolution: `\`risk-team-quota\`'s \`status.used.pods\` is already sitting at its
\`spec.hard.pods\` limit of 20 - confirmed by \`risk-namespace-notes\`, which
counts the namespace's existing fraud-scoring, chargeback-worker, and cron
Job pods right up to that ceiling. A \`kubectl apply\` for a Deployment only
creates the Deployment object itself, which the ReplicaSet controller then
uses to create Pods as a separate, independent step - and every one of
those Pod-creation calls goes through the same admission checks a manual
\`kubectl create\` would, ResourceQuota included. With the namespace already
full, every attempt to create a Pod for fraud-detector gets rejected
before a Pod object ever exists - which is exactly why there's nothing to
see as Pending or CrashLoopBackOff, just an empty ReplicaSet quietly
failing the same way over and over.

There's no live fix available from this read-only console (mutating verbs
are disabled here), but the real-world options are:

- Free up quota by scaling down or removing something less critical in
  the namespace, or
- Raise \`risk-team-quota\`'s \`pods\` limit if the namespace genuinely needs
  more capacity now, or
- Split fraud-detector into its own namespace with its own quota, if this
  namespace has simply outgrown a shared quota.

A ResourceQuota rejecting Pod creation doesn't show up as an error on the
Deployment or the ReplicaSet themselves in \`kubectl get\` - it only appears
in the ReplicaSet's own Events (\`kubectl describe replicaset\`), which is
easy to miss if the habit is to only check the Deployment and its Pods.`,
};
