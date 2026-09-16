import type { Scenario } from "./types";

export const theNativeSidecarTerminationBlock: Scenario = {
  id: "the-native-sidecar-termination-block",
  title: "The Native Sidecar Termination Block",
  subtitle: "every rollout of report-builder now takes fifteen extra minutes per pod, right after adopting native sidecars",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "sidecars", "termination"],
  briefing: `"report-builder" recently adopted the native sidecar feature (an init
container with \`restartPolicy: Always\`) to run its metrics-exporter
alongside the main app, replacing an older, hackier sidecar pattern.
Since then, every pod termination during a rollout takes a full 15
minutes instead of the usual few seconds - right up against
\`terminationGracePeriodSeconds\`, every single time.`,
  constraints: [
    "The main report-builder container itself shuts down cleanly and quickly every time, in well under a second, confirmed by its own logs.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "report-builder", namespace: "reporting", labels: { app: "report-builder" } },
        spec: {
          replicas: 4,
          template: {
            spec: {
              terminationGracePeriodSeconds: 900,
              initContainers: [{ name: "metrics-exporter", image: "registry.internal/metrics-exporter:2.0.0", restartPolicy: "Always" }],
              containers: [{ name: "report-builder", image: "registry.internal/report-builder:5.0.0" }],
            },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 3 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "report-builder-4r5s6t7u8-v9w0x", namespace: "reporting", labels: { app: "report-builder" } },
        status: { phase: "Running" },
        logs: {
          "report-builder": ["2026-09-15T10:00:00.100Z INFO  server.Shutdown - SIGTERM received, shut down complete in 210ms"],
          "metrics-exporter": ["2026-09-15T10:00:00.200Z INFO  exporter.Main - SIGTERM received, flushing final metrics batch to remote endpoint (queue depth: 40000, est. ~14min at current throughput)"],
        },
        age: "14m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "native-sidecar-behavior-notes", namespace: "reporting" },
        spec: {
          data: {
            "notes.md":
              "Native sidecars (init containers with `restartPolicy: Always`) are\nguaranteed to start before the main container and, per the feature's\ndesign, only receive their own SIGTERM *after* every regular container\nin the pod has fully exited - the pod as a whole is only considered\nfully terminated once every native sidecar has exited too, all within\nthe same shared `terminationGracePeriodSeconds` budget. metrics-exporter\nbuffers a large in-memory queue of metrics batches and, on SIGTERM,\ntries to flush the *entire* backlog before exiting rather than\ndiscarding it - under real production load, that backlog can take up to\n14-15 minutes to fully drain at the remote endpoint's ingest rate, which\nis new behavior nobody load-tested under the old sidecar pattern (which\nsimply got killed alongside the main container with no graceful\nflush at all, quietly dropping whatever was still queued).\n",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl logs report-builder-4r5s6t7u8-v9w0x -c metrics-exporter -n reporting` - check the sidecar's own shutdown log, not just the main container's.",
    "Native sidecars have a specific termination ordering guarantee - when do they actually receive SIGTERM relative to the main container?",
    "`kubectl get configmap native-sidecar-behavior-notes -n reporting -o yaml` - what does metrics-exporter actually try to do when it receives SIGTERM, and how long can that realistically take under load?",
  ],
  options: [
    {
      id: "sidecar-flushes-large-queue-on-sigterm-within-shared-grace-period",
      label:
        "Native sidecars only receive SIGTERM after every regular container in the pod has already exited, and the whole pod's termination is bounded by one shared `terminationGracePeriodSeconds` - metrics-exporter's own SIGTERM handler tries to flush its entire in-memory metrics queue (which under real load can hold up to ~15 minutes' worth of backlog) rather than discarding it, so even though the main container shuts down in 210ms, the pod as a whole doesn't finish terminating until the sidecar's full flush completes or the 900-second grace period runs out, which is new, previously-undiscovered behavior since the old sidecar pattern simply got killed alongside everything else with no graceful flush at all.",
      explanation:
        "The sidecar's own log is explicit: on SIGTERM it estimates \"~14min at current throughput\" to flush its queue, and it's a native sidecar (`restartPolicy: Always`), which per `native-sidecar-behavior-notes` only receives SIGTERM after the main container has already exited - explaining both the consistent ~15-minute delay (right up against the 900-second/15-minute grace period) and why the main container's own fast, clean 210ms shutdown doesn't speed anything up: the pod's total termination time is gated on the *slowest* container, and native sidecars are specifically designed to be included in, not excluded from, that gate.",
    },
    {
      id: "terminationgraceperiod-too-long-should-be-shortened",
      label: "`terminationGracePeriodSeconds: 900` is simply set too high and should be reduced.",
      explanation:
        "Reducing the grace period wouldn't fix the underlying delay - it would just cause metrics-exporter's queue flush to be cut off by SIGKILL partway through instead, silently dropping whatever hadn't been flushed yet. The grace period being long enough to *allow* the full flush is a symptom being investigated, not the actual root cause of why the flush takes so long in the first place.",
    },
    {
      id: "main-container-not-actually-exiting-cleanly",
      label: "The main report-builder container isn't actually exiting cleanly, despite what its logs claim.",
      explanation:
        "The scenario explicitly confirms the main container shuts down cleanly and quickly every time, and its own log shows a clean 210ms shutdown - the delay is entirely attributable to the sidecar's own SIGTERM handling, which is a completely separate container with its own termination timeline under the native sidecar model.",
    },
    {
      id: "old-sidecar-pattern-still-partially-active",
      label: "Some remnant of the old sidecar pattern is still running alongside the new native sidecar, causing a conflict.",
      explanation:
        "There's no indication of a leftover old-pattern sidecar still present - the Deployment cleanly shows just the one native sidecar (`metrics-exporter` as an init container with `restartPolicy: Always`) and the main container, and the delay is fully and directly explained by that one sidecar's own queue-flush behavior on SIGTERM.",
    },
  ],
  correctOptionId: "sidecar-flushes-large-queue-on-sigterm-within-shared-grace-period",
  resolution: `metrics-exporter's own shutdown log gives the exact estimate: "~14min at
current throughput" to flush its queue on SIGTERM. \`native-sidecar-behavior-notes\`
explains the mechanism that turns that into a pod-wide delay: native
sidecars are guaranteed to receive SIGTERM only *after* every regular
container has already exited, and the whole pod's termination is bounded
by a single shared \`terminationGracePeriodSeconds\` - 900 seconds (15
minutes) here. report-builder's own container shuts down cleanly in
210ms, but that speed doesn't help, because the pod as a whole isn't
considered terminated until the sidecar finishes too. metrics-exporter's
SIGTERM handler was written to flush its *entire* in-memory queue rather
than discard it - reasonable in principle, but under real production
load that queue can grow large enough to take nearly the full grace
period to drain. This behavior was invisible under the old sidecar
pattern, which simply got killed alongside everything else with no
graceful flush at all - silently dropping whatever was queued, which
nobody noticed as a problem, but also never surfaced this timing issue.

The fix is bounding how much the sidecar tries to flush on shutdown,
rather than attempting to drain an unbounded backlog:

\`\`\`go
// on SIGTERM: flush what's flushable within a fixed budget, then exit
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
exporter.FlushWithDeadline(ctx)  // drop/persist-to-disk whatever doesn't fit
\`\`\`

paired with a much shorter, more realistic \`terminationGracePeriodSeconds\`
once the sidecar's own shutdown is properly bounded (30-60 seconds is
plenty once the flush has an explicit deadline). This is a good general
lesson for adopting native sidecars: their termination-ordering guarantee
means a sidecar's own SIGTERM handling is now directly in the critical
path of every pod termination, in a way the old fire-and-forget sidecar
pattern never exposed - any sidecar being migrated to the native pattern
needs its shutdown behavior load-tested under realistic conditions, not
just functionally verified.`,
};
