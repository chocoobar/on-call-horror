import type { Scenario } from "./types";

export const theHostpathPermissionWall: Scenario = {
  id: "the-hostpath-permission-wall",
  title: "The hostPath Permission Wall",
  subtitle: "log-shipper crashes on every node it lands on, immediately",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "hostpath", "permissions"],
  briefing: `"log-shipper" is a DaemonSet that tails container logs from each node's
disk and forwards them off-cluster. After last week's change to run it as
a non-root user for security hardening, it crashes on startup on every
single node - not some, all of them.`,
  constraints: [
    "The DaemonSet's pods do get scheduled and start on every node - this isn't a scheduling problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        metadata: { name: "log-shipper", namespace: "logging", labels: { app: "log-shipper" } },
        spec: {
          template: {
            spec: {
              securityContext: { runAsUser: 10001, runAsNonRoot: true },
              containers: [
                {
                  name: "log-shipper",
                  image: "registry.internal/log-shipper:3.1.0",
                  volumeMounts: [{ name: "hostlogs", mountPath: "/var/log/containers" }],
                },
              ],
              volumes: [{ name: "hostlogs", hostPath: { path: "/var/log/containers", type: "Directory" } }],
            },
          },
        },
        status: { desiredNumberScheduled: 6, numberReady: 0, numberAvailable: 0 },
        age: "8d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "log-shipper-9x8y7z", namespace: "logging", labels: { app: "log-shipper" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "log-shipper", ready: false, restartCount: 9, state: { waiting: { reason: "CrashLoopBackOff" } } }],
        },
        logs: {
          "log-shipper": [
            "2026-09-15T09:12:01.001Z FATAL shipper.Tailer - open /var/log/containers: permission denied",
            "2026-09-15T09:12:01.002Z FATAL shipper.Tailer - exiting: cannot read host log directory",
          ],
        },
        events: [
          { type: "Warning", reason: "BackOff", age: "40s", message: "Back-off restarting failed container log-shipper in pod log-shipper-9x8y7z_logging" },
        ],
        age: "8d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "log-shipper-hardening-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "Security hardening change (8 days ago): added `runAsUser: 10001,\nrunAsNonRoot: true` to log-shipper's pod spec, replacing the previous\nroot-user default. `/var/log/containers` on every node is owned by\nroot:root with mode 0750 - only root and members of a specific host\ngroup could read it before. UID 10001 isn't in that group on any node.\n",
          },
        },
        age: "8d",
      },
    ],
  },
  hints: [
    "`kubectl logs log-shipper-9x8y7z -n logging` - the fatal error is a plain filesystem permission error, not an application bug.",
    "`kubectl get daemonset log-shipper -n logging -o yaml` - check `securityContext.runAsUser` against who actually owns `/var/log/containers` on the host.",
    "This started right after switching to a non-root user - what did running as root implicitly grant that UID 10001 doesn't have?",
  ],
  options: [
    {
      id: "nonroot-uid-lacks-hostpath-access",
      label:
        "log-shipper now runs as UID 10001 (`runAsNonRoot: true`), but the hostPath directory `/var/log/containers` on every node is owned `root:root` mode 0750 - only root or a specific host group can read it, and UID 10001 is in neither, so every pod fails to even open the directory it exists to tail, on every node, immediately.",
      explanation:
        "The log line is unambiguous: `open /var/log/containers: permission denied`, a plain filesystem permission failure, not an application logic bug. `log-shipper-hardening-notes` confirms the timing (this started exactly when the non-root change landed) and the mechanism (the host directory's ownership and mode only permit root or a specific group, which UID 10001 isn't part of). Running as root previously worked precisely because root bypasses Unix file permission checks entirely - removing that implicitly removed the access that made this hostPath mount work.",
    },
    {
      id: "hostpath-type-wrong",
      label: "The hostPath's `type: Directory` check is failing because the path doesn't exist on some nodes.",
      explanation:
        "The failure is happening identically on every single node, and the error is specifically `permission denied`, not a \"path does not exist\" style error that a failed `type: Directory` check would produce - the directory exists and is found, it just can't be read by this UID.",
    },
    {
      id: "image-doesnt-support-nonroot",
      label: "The log-shipper container image wasn't built to run as a non-root user at all.",
      explanation:
        "The container does start and run (it reaches its own application code and logs a clear fatal error) rather than failing to even launch with a `CreateContainerConfigError` - the image runs fine as UID 10001, it's the host directory's permissions that block it, not anything about the image itself.",
    },
    {
      id: "daemonset-not-scheduling",
      label: "The DaemonSet isn't actually scheduling pods onto all the intended nodes.",
      explanation:
        "`desiredNumberScheduled: 6` with pods confirmed Running (if unhealthy) on every node contradicts a scheduling problem - the pods are landing exactly where expected and starting up, they're just crashing once running due to a filesystem permission error, not failing to be placed.",
    },
  ],
  correctOptionId: "nonroot-uid-lacks-hostpath-access",
  resolution: `The log line says it plainly: \`open /var/log/containers: permission
denied\`. \`log-shipper-hardening-notes\` fills in why now: 8 days ago the
pod spec switched from an implicit root user to \`runAsUser: 10001\` with
\`runAsNonRoot: true\`, and \`/var/log/containers\` on every node is owned
\`root:root\` with mode 0750 - readable only by root or members of a
specific host group. Running as root previously worked by definition,
since root bypasses Unix permission checks entirely; the hardening change
removed that shortcut without granting UID 10001 any equivalent access,
so the container can open a socket, start up, and immediately fail the
first thing it tries to do.

The fix is giving UID 10001 real access to that host path instead of
relying on root, typically via a supplemental group that matches the
host directory's group ownership:

\`\`\`yaml
securityContext:
  runAsUser: 10001
  runAsNonRoot: true
  supplementalGroups: [420]   # matches /var/log/containers' host group
\`\`\`

(the exact GID depends on the node image/OS - check \`stat -c '%g'
/var/log/containers\` on a node). If no such group exists on the hosts,
an init container running as root to \`chmod\`/\`chgrp\` the path, or a
DaemonSet-level node bootstrap change granting UID 10001 read access, are
the alternatives - either way, a security hardening change to drop
privileges needs to be paired with actually granting the specific access
the workload needs, not just removing root and hoping the defaults still
work.`,
};
