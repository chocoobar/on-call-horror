import type { Scenario } from "../types";

export const theReadOnlyFilesystemSurprise: Scenario = {
  id: "the-read-only-filesystem-surprise",
  title: "The Read-Only Filesystem Surprise",
  subtitle: "pdf-exporter crashes the instant it tries to render anything, right after a security pass",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "security-context", "filesystem"],
  briefing: `A security review hardened several Deployments last night, "pdf-exporter"
among them. This morning every export request fails instantly - the pod
doesn't even look unhealthy in kubectl, it's the exports themselves that
are erroring out one after another.`,
  constraints: [
    "pdf-exporter's own export logic hasn't changed in weeks - only infrastructure-level config changed overnight.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pdf-exporter", namespace: "reporting", labels: { app: "pdf-exporter" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              securityContext: { readOnlyRootFilesystem: true, runAsNonRoot: true },
              containers: [{ name: "pdf-exporter", image: "registry.internal/pdf-exporter:2.7.0" }],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "pdf-exporter-6y7z8a9b0-c1d2e", namespace: "reporting", labels: { app: "pdf-exporter" } },
        status: { phase: "Running", containerStatuses: [{ name: "pdf-exporter", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "pdf-exporter": [
            "2026-09-15T08:15:02.442Z INFO  export.Renderer - export request received, writing intermediate render to /tmp/render-8821.pdf",
            "2026-09-15T08:15:02.445Z ERROR export.Renderer - open /tmp/render-8821.pdf: read-only file system",
            "2026-09-15T08:15:02.446Z ERROR export.Handler - export failed, returning 500 to caller",
          ],
        },
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "security-hardening-changelog", namespace: "reporting" },
        spec: {
          data: {
            "notes.md":
              "Last night's hardening pass added `readOnlyRootFilesystem: true` to\nseveral Deployments including pdf-exporter, per the internal security\nbaseline. pdf-exporter's rendering pipeline writes intermediate PDF\npages to /tmp before assembling the final file - this was not called\nout during the hardening review since /tmp is conventionally assumed to\nbe writable.\n",
          },
        },
        age: "8h",
      },
    ],
  },
  hints: [
    "`kubectl logs pdf-exporter-6y7z8a9b0-c1d2e -n reporting` - the app's own error names the exact filesystem operation that fails.",
    "`kubectl get deployment pdf-exporter -n reporting -o yaml` - check `securityContext.readOnlyRootFilesystem` and when it was added relative to when exports started failing.",
    "`readOnlyRootFilesystem: true` makes the entire container filesystem read-only, /tmp included, unless a writable volume is explicitly mounted somewhere the app needs to write.",
  ],
  options: [
    {
      id: "readonly-root-blocks-tmp-write",
      label:
        "Last night's hardening pass added `readOnlyRootFilesystem: true` to pdf-exporter, which makes the entire container filesystem read-only including /tmp - but the renderer writes intermediate PDF pages to /tmp during every export, and with no writable volume mounted there, every single export now fails immediately with a read-only filesystem error the moment it tries to write.",
      explanation:
        "The app's log is explicit: \"open /tmp/render-8821.pdf: read-only file system.\" `security-hardening-changelog` confirms `readOnlyRootFilesystem: true` was added the night before, and explicitly notes the review didn't account for pdf-exporter's use of /tmp for intermediate render files - a common oversight since /tmp is conventionally assumed writable. `readOnlyRootFilesystem` makes the whole container filesystem read-only by design, /tmp included, unless a writable volume (like an `emptyDir`) is explicitly mounted over a specific path.",
    },
    {
      id: "runasnonroot-blocking-startup",
      label: "runAsNonRoot: true is preventing the container from starting up at all.",
      explanation:
        "The container is confirmed `Running` and `ready: true` with zero restarts - it started up completely fine. The failure happens later, per-request, when the app tries to write a temp file, which is a filesystem write permission issue, not a startup/user-context issue.",
    },
    {
      id: "pvc-not-mounted",
      label: "A PersistentVolumeClaim that pdf-exporter depends on for output storage isn't mounted.",
      explanation:
        "pdf-exporter was never using a PVC for this - it writes intermediate files to the container's local /tmp directory, per its own log line, and the error is specifically about the root filesystem being read-only, not about a missing external volume.",
    },
    {
      id: "disk-full-on-node",
      label: "The node's local disk is full, so no container on it can write temp files.",
      explanation:
        "A full disk produces a \"no space left on device\" error, not \"read-only file system\" - these are distinct, specific filesystem error messages, and the log clearly shows the latter, which points directly at the filesystem's mount mode, not its available capacity.",
    },
  ],
  correctOptionId: "readonly-root-blocks-tmp-write",
  resolution: `The app's own error names the exact failure: "read-only file system" when
writing to \`/tmp/render-8821.pdf\`. \`security-hardening-changelog\`
confirms \`readOnlyRootFilesystem: true\` was added to pdf-exporter's
security context the night before, as part of a broader hardening pass -
and candidly notes the review didn't catch that pdf-exporter's rendering
pipeline depends on writing intermediate files to /tmp. A read-only root
filesystem is exactly that: the *entire* container filesystem becomes
read-only, /tmp included, unless something explicitly provides a
writable path.

The fix is mounting a writable \`emptyDir\` specifically at the path the
app needs, keeping the rest of the filesystem locked down:

\`\`\`yaml
securityContext:
  readOnlyRootFilesystem: true
  runAsNonRoot: true
volumes:
  - name: tmp
    emptyDir: {}
containers:
  - name: pdf-exporter
    volumeMounts:
      - name: tmp
        mountPath: /tmp
\`\`\`

This keeps the actual security benefit (no arbitrary writes anywhere
else in the container, including to its own binaries) while giving the
one legitimate write path the app needs back. It's worth checking every
other Deployment touched in the same hardening pass for the same
pattern - any app that writes to /tmp, a local cache directory, or logs
to a local file is equally exposed to this exact failure mode.`,
};
