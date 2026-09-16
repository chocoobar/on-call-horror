import type { Scenario } from "./types";

export const theSurgeReadinessGateStall: Scenario = {
  id: "the-surge-readiness-gate-stall",
  title: "The Surge Readiness Gate Stall",
  subtitle: "user-profile's rollout has been \"in progress\" for two hours on a five-minute deploy",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "rollout", "readiness"],
  briefing: `A routine image bump for "user-profile" kicked off a rollout that should
finish in a few minutes, same as every deploy before it. Two hours later
it's still "in progress" - old and new pods both present, neither growing
nor shrinking any further, traffic still being served fine the whole
time.`,
  constraints: [
    "Traffic and error rates have stayed completely normal throughout - this isn't currently a user-facing outage, just a rollout that won't finish.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "user-profile", namespace: "identity", labels: { app: "user-profile" } },
        spec: {
          replicas: 10,
          strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
          template: { spec: { readinessGates: [{ conditionType: "app.internal/cache-warmed" }], containers: [{ name: "user-profile", image: "registry.internal/user-profile:14.2.0" }] } },
        },
        status: { replicas: 11, readyReplicas: 10, updatedReplicas: 1, availableReplicas: 10 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "user-profile-9y0z1a2b3-c4d5e", namespace: "identity", labels: { app: "user-profile" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "user-profile", ready: true, restartCount: 0, state: { running: {} } }],
          conditions: [{ type: "Ready", status: "True" }, { type: "app.internal/cache-warmed", status: "False" }],
        },
        logs: { "user-profile": ["2026-09-15T08:00:05.100Z INFO  profile.Cache - warming local cache from cache-warmer sidecar, awaiting completion signal..."] },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "user-profile-readiness-gate-notes", namespace: "identity" },
        spec: {
          data: {
            "notes.md":
              "user-profile's pod spec added a custom readiness gate,\n`app.internal/cache-warmed`, 3 months ago - a pod isn't considered fully\nReady for rollout-progress purposes until *both* its container-level\nreadiness probe passes *and* something external sets this condition to\nTrue on the pod status. The component responsible for setting that\ncondition - a small controller watching for a 'cache warm complete'\nsignal from a sidecar - was decommissioned 6 weeks ago during an\nunrelated cache-architecture change, and nothing ever removed the\nreadiness gate from user-profile's pod spec to match. With\n`maxUnavailable: 0`, the rollout can't proceed past its first surge pod\nuntil that pod is fully Ready by *every* gate, including one that will\nnow never be set.\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get pod user-profile-9y0z1a2b3-c4d5e -n identity -o yaml` - check `status.conditions` for anything beyond the standard `Ready` condition.",
    "`kubectl get deployment user-profile -n identity -o yaml` - `spec.template.spec.readinessGates` adds an *additional* requirement beyond the container's own readiness probe for a pod to count as fully Ready.",
    "A readiness gate condition has to be set by something external to the pod itself - is whatever's supposed to set `app.internal/cache-warmed` still running anywhere in the cluster?",
  ],
  options: [
    {
      id: "orphaned-readiness-gate-never-set",
      label:
        "user-profile's pod spec has a custom readiness gate, `app.internal/cache-warmed`, that requires an external controller to set the condition to True before a pod counts as fully Ready - but that controller was decommissioned six weeks ago during an unrelated architecture change, and nobody removed the now-orphaned readiness gate, so every new pod's container passes its own readiness probe fine but permanently sits at `Ready: True` with `cache-warmed: False`, and with `maxUnavailable: 0` the rollout can never advance past its first surge pod.",
      explanation:
        "The new pod's own status shows the split precisely: standard `Ready: True` alongside the custom gate `app.internal/cache-warmed: False`. `user-profile-readiness-gate-notes` explains why that gate will never flip: the controller responsible for setting it was decommissioned six weeks ago, but the readiness gate itself was never removed from the pod spec. With `maxUnavailable: 0`, the rollout's progress is entirely gated on this one condition that nothing in the cluster is left to satisfy - a rollout stall with zero impact on serving traffic, exactly matching what's described.",
    },
    {
      id: "maxsurge-too-conservative",
      label: "`maxSurge: 1` is too conservative, so the rollout is progressing one pod at a time far too slowly.",
      explanation:
        "`maxSurge: 1` does mean one extra pod at a time - but the rollout isn't progressing slowly, it's completely stopped: `updatedReplicas: 1` for two hours straight with no further movement. A conservative surge value would still eventually finish, just slower; this rollout is stuck on a condition that will never be satisfied at all.",
    },
    {
      id: "old-pods-failing-to-terminate",
      label: "The old pods are stuck Terminating and refusing to shut down, blocking the rollout.",
      explanation:
        "`status.replicas: 11` with `readyReplicas: 10` shows all 10 old pods are healthy and Running normally, not stuck terminating - the rollout hasn't even reached the point of removing old pods yet, because it's still waiting on the single new surge pod to become fully Ready by every gate.",
    },
    {
      id: "deployment-controller-not-reconciling",
      label: "The Deployment controller itself has stopped reconciling this Deployment.",
      explanation:
        "The Deployment controller is actively reconciling - it correctly created the surge pod and is correctly waiting on its readiness gates before proceeding, exactly as designed. The stall is a legitimate, working readiness-gate mechanism waiting on a condition that will never be set, not a broken or stalled controller.",
    },
  ],
  correctOptionId: "orphaned-readiness-gate-never-set",
  resolution: `The new pod's own status shows exactly where the rollout is stuck: the
standard \`Ready\` condition is `True`, but a custom condition,
\`app.internal/cache-warmed\`, sits at \`False\`. \`user-profile-readiness-gate-notes\`
explains why it'll stay that way forever: this readiness gate requires an
external controller to explicitly set that condition, and that
controller was decommissioned six weeks ago as part of an unrelated
cache-architecture change - but nobody went back and removed the now-orphaned
readiness gate from user-profile's pod spec to match. With
\`maxUnavailable: 0\`, the rollout can't remove any old pod until the new
surge pod is fully Ready by *every* gate it declares, including one
that's now permanently unsatisfiable. Traffic stays healthy throughout
because the old pods never get touched - the rollout is stuck at its very
first step, indefinitely, not actively breaking anything.

The fix is removing the orphaned readiness gate now that its
corresponding controller no longer exists:

\`\`\`yaml
spec:
  template:
    spec:
      readinessGates: []   # removed: app.internal/cache-warmed
\`\`\`

Once removed and reapplied, the existing stuck surge pod will need a
rollout restart to be re-evaluated against the corrected pod spec, and
the deploy should complete normally within its usual few minutes. Custom
readiness gates are powerful precisely because they let external systems
participate in rollout gating, but that power means they need the same
lifecycle discipline as any other cross-component dependency - retiring
the controller that sets a condition without also retiring the gate that
depends on it leaves a Deployment with a requirement that can never be
satisfied again.`,
};
