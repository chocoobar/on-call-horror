import type { Scenario } from "./types";

export const theUnquotedSyncWave: Scenario = {
  id: "the-unquoted-sync-wave",
  title: "The Unquoted Sync Wave",
  subtitle: "inventory-sync's migration Job runs at the same time as everything else, every time",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "sync-waves", "yaml"],
  briefing: `"inventory-sync" has a database migration Job that's supposed to run
before its Deployment starts, using sync waves to sequence them. On every
fresh sync, the migration Job and the Deployment both start at exactly
the same moment - the ordering that sync waves are supposed to guarantee
just isn't happening.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-unquoted-sync-wave", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/inventory-sync.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "inventory" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "d3e4f5a" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "inventory-migrate", namespace: "inventory", annotations: { "argocd.argoproj.io/sync-wave": "-1" } },
        status: { succeeded: 1 },
        age: "2d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-sync", namespace: "inventory", labels: { app: "inventory-sync" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "raw-manifest-notes", namespace: "inventory" },
        spec: {
          data: {
            "deployment.yaml.excerpt":
              "metadata:\n  name: inventory-sync\n  annotations:\n    argocd.argoproj.io/sync-wave: 0   # written as a bare YAML integer, not \"0\"\n",
            "job.yaml.excerpt":
              "metadata:\n  name: inventory-migrate\n  annotations:\n    argocd.argoproj.io/sync-wave: \"-1\"   # correctly quoted as a string\n",
            "notes.md":
              "ArgoCD documents that sync-wave annotation values must be strings\n(quoted). The Deployment's manifest has the value written as a bare YAML\nnumber (`0` unquoted) rather than a string (`\"0\"`). Because annotation\nvalues in the Kubernetes API are always strings under the hood, Kubernetes\nitself coerces the bare `0` to the string \"0\" on admission - so this\nparticular case happens to still resolve to a valid, working wave number.\nThe real issue reported by teammates who've looked at this before: they\nassumed a bare number would simply be *rejected* or ignored, so they never\nchecked wave ordering was actually correct - and separately, nobody\nnoticed the annotation is present on the Deployment at all only by luck of\ncopy-pasting from the Job; the underlying manifest committed to git\nomitted the sync-wave annotation on the Deployment for months, and a\nrecent \"cleanup\" PR added it back with the unquoted `0` value, restoring\nwave 0 vs wave -1 ordering, which should work... except the PR that added\nit also, in the same diff, changed the Job's annotation from `\"-1\"` to a\nbare `0` by copy-paste mistake, making Job and Deployment both wave 0.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get job inventory-migrate -n inventory -o yaml` and `kubectl get deployment inventory-sync -n inventory -o yaml` - compare the actual live `argocd.argoproj.io/sync-wave` annotation values on both, not just what the raw manifest source says.",
    "`kubectl get configmap raw-manifest-notes -n inventory -o yaml` walks through the recent history of both files.",
    "A 'cleanup' PR sometimes introduces a new bug while fixing an old, unrelated one - check what the live annotation value actually is right now, not just what it was supposed to become.",
  ],
  options: [
    {
      id: "job-and-deployment-same-wave-after-copy-paste",
      label:
        "A recent cleanup PR meant to add a proper sync-wave annotation to the Deployment, but in the same change accidentally overwrote the Job's annotation from \"-1\" to 0 via a copy-paste mistake - so the Job and Deployment are now both in wave 0 and start simultaneously instead of the Job running first.",
      explanation:
        "`raw-manifest-notes` traces the actual history: the recent cleanup PR both added the Deployment's wave annotation and, in the same diff, accidentally changed the Job's annotation from the correct \"-1\" to a bare 0 by copy-paste error. Both resources now live with wave 0, so ArgoCD applies them together in the same wave with no ordering guarantee between them - exactly the simultaneous-start symptom being reported.",
    },
    {
      id: "unquoted-value-rejected",
      label: "The Deployment's unquoted `sync-wave: 0` annotation value is invalid and gets rejected by Kubernetes, so ArgoCD falls back to running everything in wave 0.",
      explanation:
        "Kubernetes annotation values are always strings under the hood - the Kubernetes API server coerces a bare YAML `0` to the string \"0\" on admission rather than rejecting it, so this alone wouldn't cause a failure. The actual ordering problem traces to the Job's annotation being accidentally changed to also be 0, not to the Deployment's unquoted value being invalid.",
    },
    {
      id: "argocd-ignores-negative-waves",
      label: "ArgoCD doesn't support negative sync-wave numbers, so the Job's wave -1 is ignored.",
      explanation:
        "Negative sync-wave numbers are fully supported by ArgoCD and commonly used for exactly this purpose (running something before wave 0) - the documented default wave is 0, and any integer, negative or positive, is valid and orders normally around it. The Job's *current, live* annotation value is 0, not -1, per the notes - that's the actual bug.",
    },
    {
      id: "job-completed-too-fast",
      label: "The migration Job legitimately runs first but finishes so fast it looks simultaneous.",
      explanation:
        "ArgoCD waits for a wave to report healthy (a Job's health check waits for it to complete) before moving to the next wave when waves genuinely differ - if the Job were truly in an earlier wave, its completion would gate the Deployment's creation regardless of how fast it finished. The reported symptom is both starting together, which needs both to share the same wave number, matching the live annotation values.",
    },
  ],
  correctOptionId: "job-and-deployment-same-wave-after-copy-paste",
  resolution: `\`raw-manifest-notes\` traces exactly what happened: a recent "cleanup" PR
was meant to add a missing \`sync-wave\` annotation to the Deployment
(intending wave 0, after the Job's wave -1) - but in the same diff, it
accidentally overwrote the Job's own annotation from the correct
\`"-1"\` to a bare \`0\`, almost certainly via a copy-paste from the
Deployment's new annotation. Both resources now genuinely sit in wave 0
live in the cluster, so ArgoCD applies them together with no ordering
guarantee between them - which is exactly the simultaneous-start symptom.

Fix by restoring the Job's wave to run before the Deployment, and
properly quoting both as strings per ArgoCD's convention:

\`\`\`yaml
# Job: inventory-migrate
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "-1"

# Deployment: inventory-sync
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "0"
\`\`\`

On the next sync, the migration Job runs and completes in wave -1 before
the Deployment's wave 0 even starts. Worth a broader lesson here: a
cleanup diff touching sync-wave annotations is exactly the kind of change
that deserves a close read of every value it touches, not just the one
the PR was meant to fix.`,
};
