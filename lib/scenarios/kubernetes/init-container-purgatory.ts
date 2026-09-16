import type { Scenario } from "../types";

export const initContainerPurgatory: Scenario = {
  id: "init-container-purgatory",
  title: "Init Container Purgatory",
  subtitle: "reporting-api has been stuck at 0/1 Init:0/1 for two hours",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "init-containers", "deployment"],
  briefing: `"reporting-api" pods never seem to actually start - \`kubectl get pods\` has
shown \`Init:0/1\` for two hours straight. The main container never gets a
chance to run at all.`,
  constraints: [
    "The init container isn't crashing or restarting - it's simply still running, and has been the entire time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "reporting-api", namespace: "reporting", labels: { app: "reporting-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              initContainers: [
                { name: "wait-for-migration", image: "registry.internal/wait-for-job:1.0", command: ["sh", "-c", "until kubectl get job schema-migration -o jsonpath='{.status.succeeded}' | grep -q 1; do sleep 5; done"] },
              ],
              containers: [{ name: "reporting-api", image: "registry.internal/reporting-api:3.1.0" }],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "reporting-api-3c4d5e6f7-g8h9i", namespace: "reporting", labels: { app: "reporting-api" } },
        status: { phase: "Pending", containerStatuses: [{ name: "reporting-api", ready: false, restartCount: 0, state: { waiting: { reason: "PodInitializing" } } }] },
        logs: { "wait-for-migration": ["waiting for job schema-migration to succeed...", "waiting for job schema-migration to succeed...", "waiting for job schema-migration to succeed..."] },
        age: "2h",
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "schema-migration", namespace: "reporting", labels: { app: "schema-migration" } },
        spec: { completions: 1 },
        status: { succeeded: 0, active: 0 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "reporting-deploy-notes", namespace: "reporting" },
        spec: {
          data: {
            "notes.md":
              "`schema-migration` was supposed to run once, as part of this same\ndeploy, before reporting-api's pods start. Its Job spec was accidentally\nremoved from this release's manifests during a refactor - only\nreporting-api's Deployment (with the init container that waits for it)\nmade it into this release.\n",
          },
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "`kubectl get job schema-migration -n reporting -o yaml` - `status.succeeded` and `status.active` are both `0`. What does that mean about whether this Job has ever actually run?",
    "`kubectl logs reporting-api-3c4d5e6f7-g8h9i -n reporting -c wait-for-migration` - the init container is doing exactly what it was told: polling until the migration Job reports success. It's not stuck or broken, it's correctly waiting for something that never happens.",
    "`kubectl get configmap reporting-deploy-notes -n reporting -o yaml` - was the thing being waited for actually included in this deploy?",
  ],
  options: [
    {
      id: "migration-job-never-deployed",
      label:
        "The `schema-migration` Job that reporting-api's init container is waiting on was accidentally left out of this release's manifests - the Job doesn't exist in a state where it can ever succeed, so the init container polls forever, correctly, for a condition that will never become true.",
      explanation:
        "`schema-migration`'s `status.succeeded` and `status.active` are both `0` - it has never run and nothing is currently running it. `reporting-deploy-notes` confirms the Job's manifest was dropped from this release during a refactor. The init container's own logs show it behaving exactly as designed, polling patiently for a success condition that nothing in the cluster is ever going to produce - this isn't a hang or a bug in the wait logic, it's correctly waiting on a dependency that was never actually shipped.",
    },
    {
      id: "init-container-crashlooping",
      label: "The init container is crash-looping and never completing.",
      explanation:
        "The pod's containerStatus shows `PodInitializing` with `restartCount: 0` - the init container hasn't crashed or restarted even once, it's a single long-running process that's still executing its polling loop exactly as written.",
    },
    {
      id: "rbac-blocking-job-check",
      label: "The init container lacks RBAC permission to check the Job's status, so its check always fails.",
      explanation:
        "The init container's logs show it successfully running its check repeatedly and getting a real (negative) answer each time ('waiting for job... to succeed'), not an access-denied or permission error - it can see the Job's status fine, the status just never says success.",
    },
    {
      id: "wrong-job-name",
      label: "The init container is polling for the wrong Job name.",
      explanation:
        "The init container's command references `schema-migration`, which matches the actual Job's name exactly - there's no name mismatch here, the referenced Job simply never got deployed as part of this release to begin with.",
    },
  ],
  correctOptionId: "migration-job-never-deployed",
  resolution: `\`schema-migration\`'s \`status\` shows \`succeeded: 0\` and \`active: 0\` - this
Job has never run and nothing is currently running it. \`reporting-api\`'s
init container is doing precisely what its command says: polling in a
loop until that Job reports success. Its own logs confirm it's working
correctly, not hung - it's just correctly, patiently waiting on a
condition that has no path to ever becoming true, because
\`reporting-deploy-notes\` confirms the migration Job's manifest was
accidentally dropped from this release during a refactor. The dependency
the init container was written to wait for was simply never shipped.

The fix is applying the missing Job manifest so the migration actually
runs:

\`\`\`bash
kubectl apply -f schema-migration-job.yaml -n reporting
\`\`\`

(from this read-only console, that's a fix for the real cluster, not
something this investigation session can do). Once \`schema-migration\`
completes and reports \`succeeded: 1\`, every pod's init container polling
loop notices on its next check and lets its pod proceed to start the main
container normally.

Any deploy that splits a "run this migration first" step from "start
these pods that depend on it" into two separate manifests needs both to
travel together - dropping one silently turns the other into a permanent
wait with no obvious error anywhere, since \`Init:0/1\` looks identical
whether the wait is about to finish in five more seconds or is waiting on
something that will never come.`,
};
