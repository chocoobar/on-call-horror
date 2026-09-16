import type { Scenario } from "./types";

export const theSyncWaveDeadlock: Scenario = {
  id: "the-sync-wave-deadlock",
  title: "The Sync Wave Deadlock",
  subtitle: "device-provisioning has never once completed a fresh install, only ever partial ones",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "sync-waves", "health-check"],
  briefing: `"device-provisioning" ships three components with explicit sync-wave
ordering: a CRD (wave -1), an operator Deployment that watches it (wave
0), and a sample custom resource the operator is supposed to reconcile
(wave 1). On every fresh install in a new cluster, the sync hangs forever
at wave 1 - the custom resource sits there, never reaching a healthy
state, and the operator's own logs show it's running fine and just...
waiting.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-sync-wave-deadlock", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/device-provisioning.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "provisioning" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Progressing" },
          operationState: { phase: "Running", message: "waiting for healthy state of /DeviceProfile/default-profile (DeviceProfile)" },
        },
        age: "30m",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "device-provisioning-operator", namespace: "provisioning", annotations: { "argocd.argoproj.io/sync-wave": "0" } },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "device-provisioning-operator-9f8e-2ab1", namespace: "provisioning" },
        status: { phase: "Running", containerStatuses: [{ name: "operator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          operator: [
            "controller-runtime: starting manager",
            "controller-runtime: watching DeviceProfile resources in namespace provisioning",
            "reconciling default-profile: waiting for ConfigMap device-provisioning-defaults to exist before proceeding (referenced in spec.defaultsConfigMapRef, required for first reconcile)",
          ],
        },
        age: "30m",
      },
      {
        apiVersion: "provisioning.example.com/v1",
        kind: "DeviceProfile",
        metadata: { name: "default-profile", namespace: "provisioning", annotations: { "argocd.argoproj.io/sync-wave": "1" } },
        status: {},
        age: "30m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "device-provisioning-defaults", namespace: "provisioning", annotations: { "argocd.argoproj.io/sync-wave": "2" } },
        age: "0s",
      },
    ],
  },
  hints: [
    "`kubectl logs deploy/device-provisioning-operator -n provisioning` - the operator explicitly names what it's waiting for before it can reconcile the DeviceProfile at all.",
    "`kubectl get configmap device-provisioning-defaults -n provisioning -o yaml` - does it exist yet? What sync-wave is it in relative to the DeviceProfile that needs it?",
    "The operator (wave 0) needs a ConfigMap to reconcile the DeviceProfile (wave 1) - but check which wave that ConfigMap actually applies in.",
  ],
  options: [
    {
      id: "configmap-dependency-in-later-wave-than-consumer",
      label:
        "The operator's reconcile logic for DeviceProfile requires a ConfigMap that's declared in wave 2 - a wave *after* the DeviceProfile itself (wave 1) - so on a fresh install, the DeviceProfile is created and the operator immediately tries to reconcile it, but the ConfigMap it needs doesn't exist yet and won't until a wave that ArgoCD won't even reach, since it's still waiting for wave 1's DeviceProfile to report healthy first, which it never will without that ConfigMap.",
      explanation:
        "The operator's own logs state plainly it's waiting for `device-provisioning-defaults` to exist before it can reconcile `default-profile` at all. That ConfigMap carries `sync-wave: \"2\"`, one wave *after* the DeviceProfile's own wave 1. ArgoCD won't advance to wave 2 until everything in wave 1 (the DeviceProfile) reports healthy - but the DeviceProfile can't become healthy until the operator reconciles it, which can't happen until the wave-2 ConfigMap exists. It's a genuine deadlock: wave 1 needs wave 2 to complete, and wave 2 can't start until wave 1 completes.",
    },
    {
      id: "operator-crashlooping-deadlock",
      label: "The operator pod is crash-looping and never successfully starts its reconcile loop.",
      explanation:
        "The operator's pod status shows `ready: true` with `restartCount: 0`, and its logs show a clean startup and an explicit, deliberate wait condition being logged - not a crash. The operator is running exactly as designed; it's correctly refusing to proceed without a dependency that isn't available yet due to wave ordering.",
    },
    {
      id: "crd-missing-required-field-deadlock",
      label: "The DeviceProfile CRD's schema is missing a required field that's blocking the operator's reconcile.",
      explanation:
        "The operator's own log message is explicit about what it's actually waiting on - a missing ConfigMap, not a schema validation issue with the DeviceProfile object itself. There's no indication of a CRD schema problem anywhere in the evidence.",
    },
    {
      id: "health-check-lua-script-wrong-deadlock",
      label: "The custom Lua health check for DeviceProfile is misconfigured and never returns Healthy.",
      explanation:
        "There's no indication the health check script itself is wrong - the DeviceProfile genuinely hasn't been reconciled into a healthy state yet, because the operator is legitimately still waiting on its dependency. A health check reporting 'not yet healthy' for a resource that genuinely isn't healthy yet is working correctly, not misconfigured.",
    },
  ],
  correctOptionId: "configmap-dependency-in-later-wave-than-consumer",
  resolution: `The operator's own logs are explicit: it's waiting for
\`device-provisioning-defaults\` to exist before it can reconcile
\`default-profile\` at all. That ConfigMap carries
\`argocd.argoproj.io/sync-wave: "2"\` - one wave *after* the DeviceProfile
it's needed to reconcile, which sits in wave 1. ArgoCD's wave semantics
require everything in a wave to report healthy before advancing to the
next - so ArgoCD won't move on to wave 2 (and create the ConfigMap) until
wave 1's DeviceProfile is healthy, but the DeviceProfile can only become
healthy once the operator successfully reconciles it, which requires the
wave-2 ConfigMap to already exist. It's a genuine circular deadlock built
directly into the wave ordering, and it would recur on every single fresh
install, exactly as reported.

Fix by moving the ConfigMap dependency to a wave *before* the resource
that needs it, matching the actual dependency direction:

\`\`\`yaml
# ConfigMap: device-provisioning-defaults
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "0"   # was "2" - now alongside the operator, before the DeviceProfile

# DeviceProfile: default-profile
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "1"   # unchanged
\`\`\`

With the ConfigMap available by the time wave 1 starts, the operator can
successfully reconcile the DeviceProfile the moment it's created, wave 1
reports healthy normally, and the sync completes cleanly on every fresh
install going forward. The general lesson: sync-wave ordering has to
match the *actual* runtime dependency graph exactly - a resource's sync
wave needs to be strictly before anything that depends on it at
reconcile time, not merely "before it in the file," and it's worth
tracing through an operator's actual first-reconcile requirements
(config it reads, secrets it needs) rather than assuming a wave ordering
is correct just because it looks logically grouped.`,
};
