import type { Scenario } from "../types";

export const syncWavesOutOfOrder: Scenario = {
  id: "sync-waves-out-of-order",
  title: "Sync Waves Out of Order",
  subtitle: "every fresh sync of payments-worker fails on its very first attempt, then succeeds on retry",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "sync-waves", "secrets"],
  briefing: `Every time "payments-worker" does a full sync from scratch (a new
environment, a disaster-recovery drill, anything other than an
incremental update), the Deployment fails to start on the first attempt
with a missing-Secret error - then works fine the moment someone manually
retries the sync a minute later.`,
  constraints: [
    "The Secret manifest is definitely present in git and is correctly formed - this only ever fails on the very first sync attempt, never on a retry against the exact same manifests.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "payments-worker", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/payments-worker.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "payments" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "4e5f6a7b8c9d" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "payments-worker",
          namespace: "payments",
          labels: { app: "payments-worker" },
          annotations: { "argocd.argoproj.io/sync-wave": "0" },
        },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: "payments-worker-secret-manifest-notes",
          namespace: "payments",
          annotations: { "argocd.argoproj.io/sync-wave": "1" },
        },
        spec: {
          data: {
            "notes.md":
              "The actual Secret resource this Deployment mounts is named\n`payments-worker-db-creds` and carries the annotation\n`argocd.argoproj.io/sync-wave: \"1\"` - one wave *after* the Deployment's\nwave `\"0\"`. This ConfigMap (wave 1, same as the Secret) is just\ndocumenting that fact for this investigation; it isn't itself the\nresource the Deployment depends on.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get deployment payments-worker -n payments -o yaml` and `kubectl get configmap payments-worker-secret-manifest-notes -n payments -o yaml` - compare each resource's `argocd.argoproj.io/sync-wave` annotation.",
    "ArgoCD applies resources in ascending sync-wave order, waiting for each wave to be healthy before moving to the next - but within the *same* sync, a Deployment created in an earlier wave starts its pods immediately, without waiting for anything in a later wave.",
    "On a retry, the Secret from the *previous* attempt's later wave already exists in the cluster by the time the Deployment's pods restart - which is exactly why a second attempt against unchanged manifests succeeds.",
  ],
  options: [
    {
      id: "deployment-wave-before-secret-wave",
      label:
        "The Deployment is annotated `sync-wave: \"0\"` while the Secret it mounts is `sync-wave: \"1\"` - a later wave - so on a fresh sync, ArgoCD creates and starts the Deployment's pods a full wave before the Secret they need to mount even exists, and the pods fail immediately; a retry succeeds only because the Secret from the previous attempt is already sitting in the cluster by then.",
      explanation:
        "Sync waves control the *order* resources are applied in, specifically so dependencies can be sequenced - lower numbers first. Here the dependency direction is backwards: the Deployment (wave 0) needs a Secret that's deliberately placed in wave 1, a wave *later* than the thing depending on it. On the very first sync in a fresh environment, wave 0 applies and its pods start immediately with no Secret to mount; only afterward does wave 1 apply and create the Secret. A retry against the same manifests succeeds because the Secret created by the failed first attempt's wave-1 step is already there - nothing about the retry itself is different, only the state it's starting from.",
    },
    {
      id: "secret-rotation-timing",
      label: "The Secret is being rotated by an external system right as the sync runs.",
      explanation:
        "There's no external rotation system involved here - this Secret is a static, git-managed manifest applied by ArgoCD itself, and the failure is perfectly deterministic (fails first attempt, succeeds on retry, every single time) rather than the kind of intermittent timing issue an external rotation race would produce.",
    },
    {
      id: "rbac-missing-for-secret",
      label: "ArgoCD's service account lacks permission to create Secrets in this namespace.",
      explanation:
        "The Secret does get created successfully - just one sync-wave later than the Deployment that needs it. An RBAC/permissions problem would prevent the Secret from ever being created at all, on both the first attempt and any retry, not just delay it by one wave.",
    },
    {
      id: "deployment-probe-too-strict",
      label: "The Deployment's readiness probe is too strict and fails before the app can start.",
      explanation:
        "The failure here is the container failing to start at all due to a missing mounted Secret (a volume/mount-level failure), not a container that starts successfully but fails a readiness check afterward - a probe setting wouldn't cause or fix a missing-Secret startup error.",
    },
  ],
  correctOptionId: "deployment-wave-before-secret-wave",
  resolution: `Sync waves exist specifically to sequence dependencies during a sync -
ArgoCD applies all resources in one wave, waits for them to report
healthy, then moves to the next wave. Here the sequencing is backwards for
this particular dependency: the Deployment carries
\`argocd.argoproj.io/sync-wave: "0"\` while the Secret it mounts,
\`payments-worker-db-creds\`, carries \`"1"\` - a *later* wave. On a fresh
sync, wave 0 applies first: the Deployment is created and its pods start
immediately, with nothing yet mounted for a Secret that doesn't exist in
the cluster yet. Only after wave 0 is applied does ArgoCD move on to wave
1 and actually create the Secret - one step too late for the pods that
already tried and failed to start.

A manual retry against the identical manifests succeeds only because the
Secret from the failed first attempt's wave-1 step is already sitting in
the cluster by the time the retry's wave-0 Deployment starts - nothing
about the retry logic itself is different, it's just starting from a
cluster state the first attempt didn't have the benefit of.

The fix is correcting the wave order so the dependency comes first:

\`\`\`yaml
# Secret: payments-worker-db-creds
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "-1"   # before the Deployment's "0"
\`\`\`

Any resource a Deployment depends on at startup - Secrets, ConfigMaps it
mounts, a database migration Job it expects to have already run - needs a
sync-wave number lower than the Deployment's, not just "in the same
sync." Waves only prevent this exact failure mode when the dependency
graph they encode actually matches reality.`,
};
