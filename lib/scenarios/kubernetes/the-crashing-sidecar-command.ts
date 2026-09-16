import type { Scenario } from "../types";

export const theCrashingSidecarCommand: Scenario = {
  id: "the-crashing-sidecar-command",
  title: "The Crashing Sidecar Command",
  subtitle: "checkout-api's pods restart constantly, but the app's own logs look completely clean",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "sidecars", "deployment"],
  briefing: `"checkout-api" pods have been restarting every couple of minutes since a
logging sidecar was added this morning to ship logs to the central
platform. The main checkout-api container's own logs show nothing wrong
at all - no errors, no crashes, just normal request handling right up
until the restart.`,
  constraints: [
    "The main checkout-api container itself never crashes or exits on its own at any point.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "checkout-api", image: "registry.internal/checkout-api:12.1.0" },
                { name: "log-shipper-sidecar", image: "registry.internal/log-shipper-sidecar:0.4.0", command: ["sh", "-c", "tail -F /var/log/app/*.log | forward --endpoint=$LOG_ENDPOINT"] },
              ],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 3, availableReplicas: 0 },
        age: "5h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "checkout-api-3g4h5i6j7-k8l9m", namespace: "checkout", labels: { app: "checkout-api" } },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "checkout-api", ready: true, restartCount: 0, state: { running: {} } },
            { name: "log-shipper-sidecar", ready: false, restartCount: 12, state: { waiting: { reason: "CrashLoopBackOff" } } },
          ],
        },
        logs: {
          "log-shipper-sidecar": [
            "2026-09-15T10:00:00.010Z tail: cannot open '/var/log/app/*.log' for reading: No such file or directory",
            "2026-09-15T10:00:00.011Z forward: LOG_ENDPOINT environment variable is not set",
            "sh: forward: exit status 1",
          ],
        },
        events: [
          { type: "Warning", reason: "BackOff", age: "40s", message: "Back-off restarting failed container log-shipper-sidecar in pod checkout-api-3g4h5i6j7-k8l9m_checkout" },
        ],
        age: "5h",
      },
    ],
  },
  hints: [
    "`kubectl get pod checkout-api-3g4h5i6j7-k8l9m -n checkout` - look at the READY column's fraction (e.g. 1/2), not just the pod's overall phase.",
    "`kubectl logs checkout-api-3g4h5i6j7-k8l9m -c log-shipper-sidecar -n checkout` - check the *other* container's logs, not just the main app's.",
    "A pod is only marked Ready when every one of its containers is ready - one crash-looping sidecar is enough to keep the whole pod's availability at 0, even if the main app container is perfectly healthy.",
  ],
  options: [
    {
      id: "sidecar-missing-log-path-and-env-var",
      label:
        "The newly added `log-shipper-sidecar` container is crash-looping on its own - it's trying to tail a log file path that doesn't exist and relies on a `$LOG_ENDPOINT` environment variable that was never set on the container - which keeps the overall pod at 0/2 Ready (since Kubernetes requires every container in a pod to be ready before the pod is), even though checkout-api's own container is completely healthy and never restarts.",
      explanation:
        "The container statuses show it clearly: `checkout-api` at `restartCount: 0, ready: true`, while `log-shipper-sidecar` sits at `restartCount: 12, CrashLoopBackOff`. Its own logs name both problems directly - a nonexistent log path and a missing `LOG_ENDPOINT` env var. Because pod-level readiness requires *all* containers to be ready, the sidecar's repeated crashes alone are enough to keep the whole pod unavailable, which is exactly why checkout-api's own clean logs were misleading - the restarts are real, but they're happening to the sidecar, not the app.",
    },
    {
      id: "checkout-api-silent-crash",
      label: "checkout-api itself is crashing silently without logging anything before it dies.",
      explanation:
        "The container status for `checkout-api` explicitly shows `restartCount: 0` and `ready: true, state: running` - it has never restarted at all. The pod's overall instability comes entirely from the sidecar container, which is the one accumulating restarts.",
    },
    {
      id: "readiness-probe-misconfigured-main-app",
      label: "checkout-api's own readiness probe is misconfigured and failing.",
      explanation:
        "No readiness probe is defined or referenced as failing for `checkout-api` here - its container status shows `ready: true` on its own. Pod-level unavailability is driven by the sidecar container's crash-looping, which independently keeps the pod's overall readiness at 0/2 regardless of the main container's own probe state.",
    },
    {
      id: "resource-contention-between-containers",
      label: "The sidecar and main container are contending for the same CPU/memory limits, starving each other.",
      explanation:
        "There's no resource-pressure signal here at all - no OOMKilled state, no throttling evidence - and the sidecar's own logs give two clear, specific, non-resource-related reasons for its failure: a missing file path and a missing environment variable.",
    },
  ],
  correctOptionId: "sidecar-missing-log-path-and-env-var",
  resolution: `The container statuses tell the real story once you look past the main
container: \`checkout-api\` sits at \`restartCount: 0\`, completely healthy,
while \`log-shipper-sidecar\` is at \`restartCount: 12\` in
\`CrashLoopBackOff\`. Its own logs name two separate problems: it's trying
to tail \`/var/log/app/*.log\`, a path that doesn't exist in this
container, and its \`forward\` command depends on a \`$LOG_ENDPOINT\`
environment variable that was never set anywhere in the pod spec.
Because a pod is only counted Ready when *every* container in it is
ready, this one crash-looping sidecar alone is enough to keep the whole
pod at 0/2 Ready and cycling through restarts - which is exactly why
checking only the main app's logs showed nothing wrong: nothing *was*
wrong there.

The fix needs both issues addressed: point the sidecar at where
checkout-api actually writes its logs (or better, have checkout-api log
to stdout and have the sidecar consume that instead of a file path), and
supply the missing environment variable:

\`\`\`yaml
- name: log-shipper-sidecar
  image: registry.internal/log-shipper-sidecar:0.4.0
  command: ["sh", "-c", "tail -F /var/log/checkout-api/*.log | forward --endpoint=$LOG_ENDPOINT"]
  env:
    - name: LOG_ENDPOINT
      value: https://logs.internal:9200/ingest
  volumeMounts:
    - name: app-logs
      mountPath: /var/log/checkout-api
\`\`\`

(with \`app-logs\` as a shared \`emptyDir\` volume mounted at the same path
in both containers, if checkout-api writes to a local file rather than
stdout). The broader lesson: adding any sidecar to an existing pod puts
its health directly in the critical path of that pod's overall
availability - it deserves the same startup testing as the main
container, not just a quick addition to the pod spec.`,
};
