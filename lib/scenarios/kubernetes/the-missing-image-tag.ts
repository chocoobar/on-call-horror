import type { Scenario } from "../types";

export const theMissingImageTag: Scenario = {
  id: "the-missing-image-tag",
  title: "The Missing Image Tag",
  subtitle: "notification-worker's deploy has been \"in progress\" for twenty minutes",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "images", "rollout"],
  briefing: `An engineer kicked off a deploy of "notification-worker" referencing a
brand-new image tag built by this morning's CI run. Twenty minutes later,
the rollout still shows old and new pods mixed, with the new ones stuck
and never becoming Ready.`,
  constraints: [
    "The CI pipeline reported a green build for this commit - the code itself is believed to be fine.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notification-worker", namespace: "notifications", labels: { app: "notification-worker" } },
        spec: { replicas: 4, template: { spec: { containers: [{ name: "notification-worker", image: "registry.internal/notification-worker:2026.09.15-3" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 1, availableReplicas: 2 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notification-worker-1e2f3g4h5-i6j7k", namespace: "notifications", labels: { app: "notification-worker" } },
        status: { phase: "Pending", containerStatuses: [{ name: "notification-worker", ready: false, restartCount: 0, state: { waiting: { reason: "ImagePullBackOff" } } }] },
        events: [
          { type: "Warning", reason: "Failed", age: "4m", message: "Failed to pull image \"registry.internal/notification-worker:2026.09.15-3\": rpc error: code = NotFound desc = manifest unknown" },
          { type: "Warning", reason: "BackOff", age: "1m", message: "Back-off pulling image \"registry.internal/notification-worker:2026.09.15-3\"" },
        ],
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ci-build-notes", namespace: "notifications" },
        spec: {
          data: {
            "notes.md":
              "CI run #4471 built and pushed `registry.internal/notification-worker:2026.09.15-2`\n(suffix -2, not -3) and reported success. The deploy that was kicked off\nreferenced `...:2026.09.15-3`, one build number ahead of what CI\nactually produced and pushed - likely a manually-typed tag rather than\none copy-pasted directly from the CI run's output.\n",
          },
        },
        age: "20m",
      },
    ],
  },
  hints: [
    "`kubectl describe pod notification-worker-1e2f3g4h5-i6j7k -n notifications` - the pull failure error names the specific problem: `manifest unknown`.",
    "`manifest unknown` means the registry has no image with this exact tag - different from an auth failure or a registry outage.",
    "`kubectl get configmap ci-build-notes -n notifications -o yaml` - compare the tag CI actually built and pushed against the tag referenced in the Deployment.",
  ],
  options: [
    {
      id: "wrong-tag-off-by-one-suffix",
      label:
        "The Deployment references `notification-worker:2026.09.15-3`, but CI run #4471 actually built and pushed `2026.09.15-2` - the tag in the deploy is off by one from what was actually built, so the registry correctly returns `manifest unknown` for a tag that was never pushed, and the new pods stay stuck unable to pull an image that doesn't exist.",
      explanation:
        "The event's exact error, `manifest unknown`, is the registry's specific response for \"no image exists with this tag\" - distinct from an authentication failure or a connectivity issue. `ci-build-notes` shows CI actually pushed the `-2` suffix while the deploy references `-3`, confirming the referenced tag simply doesn't exist. The scenario's own note that this looks like a manually-typed tag rather than a copy-pasted one points at exactly this kind of off-by-one transcription error.",
    },
    {
      id: "registry-auth-expired",
      label: "The registry credentials used for this pull have expired.",
      explanation:
        "An expired credential produces a `401 Unauthorized` error, not `manifest unknown` - this is specifically the registry saying the requested tag doesn't exist, which is a different failure mode than an authentication problem, and is confirmed by CI having pushed a differently-numbered tag.",
    },
    {
      id: "ci-build-actually-failed",
      label: "CI's build for this commit actually failed silently despite reporting success.",
      explanation:
        "`ci-build-notes` confirms CI run #4471 did succeed and did push an image - just under a different, correctly-numbered tag (`-2`) than the one referenced in the deploy (`-3`). The build succeeded; the deploy simply referenced the wrong tag.",
    },
    {
      id: "image-pull-policy-wrong",
      label: "The container's `imagePullPolicy` is set incorrectly, preventing a fresh pull.",
      explanation:
        "The error is `manifest unknown` from the registry itself, meaning the pull request reached the registry and got a definitive \"this tag doesn't exist\" response - an `imagePullPolicy` misconfiguration would affect whether a pull is *attempted* at all, not what response the registry gives once it is.",
    },
  ],
  correctOptionId: "wrong-tag-off-by-one-suffix",
  resolution: `The event's error is specific: \`manifest unknown\` - the registry's way of
saying no image exists with the requested tag, as opposed to an auth or
connectivity failure. \`ci-build-notes\` shows exactly why: CI run #4471
built and pushed \`2026.09.15-2\`, but the Deployment references
\`2026.09.15-3\`, one build number ahead of anything that was actually
pushed - almost certainly a manually-typed tag rather than one copied
directly from CI's own output.

There's no live fix from this read-only console, but the correction is
simple: point the Deployment at the tag CI actually built:

\`\`\`bash
kubectl set image deployment/notification-worker \\
  notification-worker=registry.internal/notification-worker:2026.09.15-2 \\
  -n notifications
\`\`\`

The rollout then proceeds normally against an image that actually
exists. To prevent a repeat, the more durable fix is removing the manual
step entirely - having CI itself trigger the deploy with the exact tag it
just pushed (via a templated manifest, Helm value, or \`kubectl set image\`
call baked into the pipeline) instead of relying on someone to correctly
transcribe a tag by hand.`,
};
