import type { Scenario } from "./types";

export const theSidecarThatWouldntDie: Scenario = {
  id: "the-sidecar-that-wouldnt-die",
  title: "The Sidecar That Wouldn't Die",
  subtitle: "nightly-export's Job pod finished its work an hour ago and is still Running",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "jobs", "sidecars"],
  briefing: `The "nightly-export" Job's main container writes a report and exits
cleanly, every night, in about three minutes. Its pod, though, has been
sitting at "1/2 Running" for the last hour instead of completing - which
is blocking the next scheduled Job run, since the CronJob won't start a
new one while the old pod still exists.`,
  constraints: [
    "The main export container is confirmed to have finished successfully and exited with code 0, per its own logs.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "nightly-export-28901234", namespace: "reporting", labels: { app: "nightly-export" } },
        spec: { completions: 1 },
        status: { succeeded: 0, active: 1 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "nightly-export-28901234-k9l0m", namespace: "reporting", labels: { app: "nightly-export" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "export", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } },
            { name: "log-shipper", ready: true, restartCount: 0, state: { running: {} } },
          ],
        },
        logs: {
          export: [
            "2026-09-15T02:00:01.001Z INFO  writing nightly export to s3://reports/2026-09-15.csv",
            "2026-09-15T02:03:12.884Z INFO  export complete, 40213 rows written",
          ],
          "log-shipper": [
            "2026-09-15T02:00:00.500Z INFO  log-shipper started, tailing /var/log/export/*.log",
            "2026-09-15T02:03:13.010Z INFO  forwarded 214 log lines to central logging",
            "2026-09-15T02:03:13.011Z INFO  tailing for new log lines...",
          ],
        },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nightly-export-notes", namespace: "reporting" },
        spec: {
          data: {
            "notes.md":
              "`log-shipper` is a sidecar added a month ago to forward the export\ncontainer's log files to central logging, since the export tool writes\nto a file instead of stdout. It runs `tail -f` in a loop with no exit\ncondition of its own - it was written assuming it would run for as long\nas the pod does, in a long-running Deployment-style pod. This is its\nfirst time being added to a Job's pod template rather than a Deployment.\n",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`kubectl get pod nightly-export-28901234-k9l0m -n reporting -o yaml` - two containers, two very different states. What does each one say?",
    "`kubectl logs nightly-export-28901234-k9l0m -n reporting -c log-shipper` - is this container doing anything wrong, or just... still doing what it was told?",
    "`kubectl get configmap nightly-export-notes -n reporting -o yaml` - was this sidecar container designed with the assumption that the main container might finish and the pod should end?",
  ],
  options: [
    {
      id: "sidecar-has-no-exit-condition",
      label:
        "`log-shipper` runs an unconditional `tail -f` loop with no way to know the main `export` container has finished - it was written for a long-running Deployment pod, not a Job, so it just keeps tailing forever, and a Pod isn't considered done until *every* container in it has exited, not just the main one.",
      explanation:
        "The `export` container's own state confirms it finished cleanly (`Completed`, `exitCode: 0`); `log-shipper` is `Running` and its logs show it actively, correctly \"tailing for new log lines...\" with nothing wrong or stuck about it. `nightly-export-notes` confirms it was written with a Deployment's always-running assumption and has never had a reason to exit on its own. Kubernetes considers a Job's pod complete only once every container in the pod has terminated - one finished container next to one indefinitely-running sidecar is exactly the \"1/2 Running\" state observed, and it will stay that way forever without a change to how the sidecar is told to stop.",
    },
    {
      id: "export-container-actually-hung",
      label: "The export container is actually still hung on something despite what its status shows.",
      explanation:
        "The container's own state field explicitly reports `terminated: { reason: Completed, exitCode: 0 }`, and its logs show a clean finish - there's no ambiguity or hidden hang here, it has definitively exited successfully.",
    },
    {
      id: "cronjob-concurrency-policy",
      label: "The CronJob's `concurrencyPolicy` is misconfigured, causing overlapping runs.",
      explanation:
        "This isn't about two Job runs overlapping - there's exactly one Job and one pod here, and it hasn't completed because one of its own containers is still running, not because of anything about how the CronJob schedules future runs.",
    },
    {
      id: "job-backofflimit-issue",
      label: "The Job's `backoffLimit` is preventing it from being marked complete.",
      explanation:
        "`backoffLimit` governs how many times a Job retries a *failed* pod - this pod hasn't failed, and Job completion tracking is based on containers finishing successfully, not on any retry-limit configuration.",
    },
  ],
  correctOptionId: "sidecar-has-no-exit-condition",
  resolution: `The two containers tell two different stories: \`export\` is
\`terminated\`/\`Completed\`/\`exitCode: 0\` - it did its job and finished
cleanly, exactly as expected. \`log-shipper\` is still \`Running\`, and its
own logs show it isn't stuck on anything - it's correctly, faithfully
still tailing a log file, because \`nightly-export-notes\` confirms it was
written as a Deployment sidecar with no built-in exit condition. This is
its first time riding along in a Job's pod instead of a long-running
Deployment's, and nobody updated it to know that a Job's pod is supposed
to actually finish.

Kubernetes only marks a pod (and therefore the Job behind it) complete
once *every* container in the pod has exited - one finished main
container next to one indefinitely-running sidecar produces exactly this
permanent "1/2 Running" state, which then blocks the CronJob from
starting its next scheduled run, since the previous Job's pod technically
never finished.

The clean fix, available on modern Kubernetes, is marking the sidecar as
a native sidecar container so it's automatically stopped once the main
containers finish:

\`\`\`yaml
initContainers:
  - name: log-shipper
    image: registry.internal/log-shipper:1.0
    restartPolicy: Always   # marks this as a native sidecar (K8s 1.29+)
\`\`\`

On older clusters without native sidecar support, the alternative is
giving \`log-shipper\` its own real exit condition - for example, watching
for a sentinel file the \`export\` container writes on completion, and
exiting once it sees it, instead of tailing forever. Either way, a sidecar
written for a Deployment's "run forever" assumption needs to explicitly
learn how to stop before it's safe to drop into a Job.`,
};
