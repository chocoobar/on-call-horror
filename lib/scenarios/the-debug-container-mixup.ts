import type { Scenario } from "./types";

export const theDebugContainerMixup: Scenario = {
  id: "the-debug-container-mixup",
  title: "The Debug Container Mixup",
  subtitle: "an ephemeral debug session against inventory-sync-2 seems to have made things worse",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "debugging", "ephemeral-containers"],
  briefing: `An engineer used \`kubectl debug\` to attach an ephemeral debugging
container to "inventory-sync-2" to poke at a stuck-looking process from
inside its network/process namespace. Right after that debug session
ended, the pod's readiness flipped to not-ready and it's stayed that way
since - worse than before anyone started looking.`,
  constraints: [
    "The ephemeral debug container itself is confirmed to have exited cleanly and is no longer running - it isn't still consuming resources.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "inventory-sync-2", namespace: "inventory", labels: { app: "inventory-sync" } },
        spec: {
          containers: [{ name: "inventory-sync", image: "registry.internal/inventory-sync:4.0.0", readinessProbe: { exec: { command: ["cat", "/tmp/ready"] }, periodSeconds: 5, failureThreshold: 2 } }],
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "inventory-sync", ready: false, restartCount: 0, state: { running: {} } }],
          ephemeralContainerStatuses: [{ name: "debugger-x9k2", state: { terminated: { reason: "Completed", exitCode: 0 } } }],
        },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "3m", message: "Readiness probe failed: cat: /tmp/ready: No such file or directory" },
        ],
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inventory-sync-debug-session-notes", namespace: "inventory" },
        spec: {
          data: {
            "notes.md":
              "inventory-sync-2's readiness probe checks for the presence of a file,\n/tmp/ready, which its own application code creates on startup and\ntouches periodically to signal health, then deletes on graceful\nshutdown. The `kubectl debug` session used\n`--target=inventory-sync --share-processes` to inspect the running\nprocess - during the session, the engineer ran a cleanup one-liner\n(`rm -rf /tmp/*`) inside the ephemeral container intended to clear old\ntemp files they assumed were debug scratch space, not realizing an\nephemeral debug container sharing the pod's process namespace via\n`--share-processes` also shares its filesystem, including /tmp, with\nthe main container - the command deleted the main container's own\nreadiness marker file along with everything else in /tmp.\n",
          },
        },
        age: "3m",
      },
    ],
  },
  hints: [
    "`kubectl describe pod inventory-sync-2 -n inventory` - the readiness probe failure names the exact file it's looking for and confirms it's simply gone.",
    "`kubectl get pod inventory-sync-2 -n inventory -o yaml` - check `ephemeralContainerStatuses` for what debug session ran and how it exited.",
    "An ephemeral debug container attached with `--share-processes` shares more than just process visibility with the target container - what filesystem does it actually see?",
  ],
  options: [
    {
      id: "debug-session-deleted-shared-tmp-readiness-file",
      label:
        "The `kubectl debug --share-processes` session shared the main container's filesystem, not just its process namespace - a cleanup command run inside the ephemeral debug container (`rm -rf /tmp/*`), intended to clear what the engineer assumed was isolated debug scratch space, actually deleted the main container's own `/tmp/ready` file, the marker its readiness probe checks for and which the application only recreates on its own startup or periodic touch - so the pod now fails readiness until that file reappears or the container restarts.",
      explanation:
        "The readiness probe's own failure message is explicit: \`cat: /tmp/ready: No such file or directory\` - the exact file the probe checks for is simply gone. \`inventory-sync-debug-session-notes\` explains precisely how: `--share-processes` (and the shared filesystem that comes with sharing a container's namespaces this way) meant a cleanup command run in the ephemeral debugger reached into and deleted files belonging to the main container, including its readiness marker - a genuinely easy mistake, since \"ephemeral container\" sounds isolated but sharing namespaces with a target deliberately blurs that isolation for debugging purposes.",
    },
    {
      id: "application-bug-deleting-own-file",
      label: "inventory-sync's own application code has a bug that deletes its readiness file under some condition.",
      explanation:
        "The timing lines up precisely with the debug session ending, and `inventory-sync-debug-session-notes` documents a specific command run during that session that explains the missing file directly - there's no evidence pointing at the application's own steady-state code as the cause, especially given it ran without issue for 5 days before the debug session.",
    },
    {
      id: "ephemeral-container-still-consuming-resources",
      label: "The ephemeral debug container is still running and consuming resources, starving the main container.",
      explanation:
        "`ephemeralContainerStatuses` shows the debug container `terminated, reason: Completed` - it's confirmed to have exited cleanly and isn't running or consuming anything anymore, and the scenario's own constraint states this directly. The lingering effect isn't the debug container itself, it's the filesystem change it made before exiting.",
    },
    {
      id: "readiness-probe-misconfigured",
      label: "The readiness probe's `exec` command was always misconfigured and only just started failing.",
      explanation:
        "The probe checks for a file the application itself is confirmed to create and maintain, and it worked correctly for 5 days before the debug session - the probe's configuration isn't the problem, the file it depends on was removed out from under it by an action taken during the debug session.",
    },
  ],
  correctOptionId: "debug-session-deleted-shared-tmp-readiness-file",
  resolution: `The readiness probe's own failure message names the exact missing file:
\`cat: /tmp/ready: No such file or directory\`. \`inventory-sync-debug-session-notes\`
explains how it disappeared: the \`kubectl debug\` session was started with
\`--share-processes\`, which - beyond just letting the debugger see the
target's processes - also means the ephemeral container shares the
target's filesystem. A cleanup command run inside that debug container,
intended to clear what looked like disposable debug scratch space in
/tmp, actually deleted the main container's own readiness marker file
along with everything else there. The application only creates that file
on its own startup and touches it periodically - it has no reason to
recreate it just because it went missing mid-run, so the pod stays
not-ready indefinitely until something restarts the main container.

There's no live fix from this read-only console, but the practical
recovery is straightforward - restart the pod so the application
re-creates its readiness marker on startup:

\`\`\`bash
kubectl delete pod inventory-sync-2 -n inventory
\`\`\`

(letting its controller recreate it cleanly). The broader lesson for
future debug sessions: \`--share-processes\` (and ephemeral debug
containers generally) genuinely share resources with the target
container, not just visibility into it - any destructive command run
inside one should be treated as running against the target container
itself, scoped carefully (e.g. \`rm\` a specific known-safe path, never a
wildcard glob) rather than assumed to be sandboxed. It's also worth
considering whether a readiness signal this fragile (a single file in a
shared, generally-writable /tmp) is the right design - a readiness check
based on the application's own internal state, exposed via an HTTP
endpoint or similar, wouldn't be vulnerable to an unrelated filesystem
operation clobbering it.`,
};
