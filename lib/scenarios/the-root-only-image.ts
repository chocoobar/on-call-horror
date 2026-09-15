import type { Scenario } from "./types";

export const theRootOnlyImage: Scenario = {
  id: "the-root-only-image",
  title: "The Root-Only Image",
  subtitle: "recommendation-engine's pods never even reach Running after today's hardening rollout",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "security-context", "containers"],
  briefing: `As part of the same fleet-wide security hardening push, "recommendation-engine"
got \`runAsNonRoot: true\` added to its pod spec this afternoon. Unlike some
other apps in the same push that just started erroring at runtime, this
one's pods don't even get to Running - they sit in an error state
immediately after being scheduled.`,
  constraints: [
    "The node the pods land on has plenty of free capacity and is healthy - this isn't a scheduling or resource problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-engine", namespace: "ml", labels: { app: "recommendation-engine" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              securityContext: { runAsNonRoot: true },
              containers: [{ name: "recommendation-engine", image: "registry.internal/recommendation-engine:8.0.0" }],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 3, availableReplicas: 0 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "recommendation-engine-9c0d1e2f3-g4h5i", namespace: "ml", labels: { app: "recommendation-engine" } },
        status: {
          phase: "Pending",
          containerStatuses: [{ name: "recommendation-engine", ready: false, restartCount: 0, state: { waiting: { reason: "CreateContainerConfigError" } } }],
        },
        events: [
          { type: "Warning", reason: "Failed", age: "2m", message: "Error: container has runAsNonRoot and image will run as root (pod: \"recommendation-engine-9c0d1e2f3-g4h5i_ml\", container: recommendation-engine)" },
        ],
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "recommendation-engine-image-notes", namespace: "ml" },
        spec: {
          data: {
            "notes.md":
              "recommendation-engine:8.0.0's Dockerfile has no `USER` directive, so the\nimage defaults to running as root (UID 0) - it was never built with a\nnon-root user baked in, unlike most other services in this hardening\nbatch, which already used a base image with a built-in non-root user.\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl describe pod recommendation-engine-9c0d1e2f3-g4h5i -n ml` - `CreateContainerConfigError` happens before the container even starts, unlike a crash after starting.",
    "The event message is unusually direct: it names exactly why container creation was refused.",
    "`runAsNonRoot: true` doesn't change what user the image runs as - it just tells the kubelet to refuse starting the container if that user turns out to be root (UID 0).",
  ],
  options: [
    {
      id: "image-has-no-nonroot-user",
      label:
        "recommendation-engine's image has no `USER` directive in its Dockerfile and defaults to running as root - `runAsNonRoot: true` doesn't change what user an image runs as, it only tells the kubelet to check at container-creation time and refuse to start it if the resulting user is root, which is exactly what's happening here before the container ever gets a chance to run.",
      explanation:
        "The event names the exact reason: \"container has runAsNonRoot and image will run as root.\" This is a `CreateContainerConfigError`, which happens during container creation, before any process inside the container ever executes - distinct from a crash after starting. `recommendation-engine-image-notes` confirms the image's Dockerfile has no `USER` directive, unlike other services in the same hardening batch that already used a non-root base image and therefore didn't hit this at all.",
    },
    {
      id: "resource-limits-too-low",
      label: "The container's resource limits are too low for it to initialize successfully.",
      explanation:
        "There's no resource-related error here at all - `CreateContainerConfigError` with this specific message is entirely about the user-ID check `runAsNonRoot` performs, occurring before the container process even starts, well before resource usage would come into play.",
    },
    {
      id: "node-lacks-capacity",
      label: "The node doesn't have enough free capacity to start the container.",
      explanation:
        "The scenario confirms the node is healthy with plenty of free capacity, and a capacity shortfall would show as the pod staying unscheduled (`Pending` with a `FailedScheduling` event) rather than being scheduled and then failing at container creation with this specific user-ID error.",
    },
    {
      id: "securitycontext-syntax-invalid",
      label: "The `securityContext.runAsNonRoot` field was set with invalid YAML syntax.",
      explanation:
        "A YAML syntax error would be rejected immediately by the API server at `kubectl apply` time with a validation error - this Deployment was accepted and its pods were created and scheduled successfully; the failure happens later, when the kubelet actually tries to create the container and checks the resulting UID.",
    },
  ],
  correctOptionId: "image-has-no-nonroot-user",
  resolution: `The event says it plainly: "container has runAsNonRoot and image will
run as root." This is a \`CreateContainerConfigError\` - the kubelet
refusing to even start the container, not a crash inside it.
\`recommendation-engine-image-notes\` explains why this app specifically
hit it while others in the same hardening batch didn't: its Dockerfile
never set a \`USER\` directive, so the image has always defaulted to root,
it just never mattered until something started checking. \`runAsNonRoot:
true\` is purely a check, not an enforcement mechanism that changes
behavior - it tells the kubelet "verify the resulting user isn't root,
and refuse to start if it is," which is exactly what's happening.

The durable fix is baking a non-root user into the image itself:

\`\`\`dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
\`\`\`

rebuild and push a new tag, then the existing \`runAsNonRoot: true\` pod
spec will work without any further change. If an image rebuild isn't
immediately possible, a stopgap is explicitly setting a non-root
\`runAsUser\` that's known to exist in the image (many base images ship a
conventional UID like 1000 even without a named user):

\`\`\`yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
\`\`\`

but the real fix belongs in the image build, since relying on an
implicit numeric UID that happens to exist is fragile across base image
updates.`,
};
