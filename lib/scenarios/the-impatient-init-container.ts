import type { Scenario } from "./types";

export const theImpatientInitContainer: Scenario = {
  id: "the-impatient-init-container",
  title: "The Impatient Init Container",
  subtitle: "webhook-relay's pods never make it past Init:Error, on every single attempt",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "init-containers", "deployment"],
  briefing: `A small change to "webhook-relay" added an init container meant to wait
for a downstream dependency to be reachable before the main app starts.
Since it was deployed an hour ago, not a single pod has made it to
Running - they all sit briefly, then show \`Init:Error\`, then restart and
repeat.`,
  constraints: [
    "The downstream dependency the init container is supposed to wait for is confirmed healthy and reachable the entire time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "webhook-relay", namespace: "integrations", labels: { app: "webhook-relay" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              initContainers: [{ name: "wait-for-upstream", image: "registry.internal/webhook-relay-init:1.0.0", command: ["sh", "-c", "curl -sf http:/upstream-gateway.integrations.svc:8080/health"] }],
              containers: [{ name: "webhook-relay", image: "registry.internal/webhook-relay:4.5.0" }],
            },
          },
        },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "webhook-relay-2f3g4h5i6-j7k8l", namespace: "integrations", labels: { app: "webhook-relay" } },
        status: {
          phase: "Pending",
          initContainerStatuses: [{ name: "wait-for-upstream", ready: false, restartCount: 6, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "Error", exitCode: 3 } } }],
        },
        logs: { "wait-for-upstream": ["curl: (3) URL using bad/illegal format or missing URL"] },
        events: [
          { type: "Warning", reason: "BackOff", age: "20s", message: "Back-off restarting failed container wait-for-upstream in pod webhook-relay-2f3g4h5i6-j7k8l_integrations" },
        ],
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl logs webhook-relay-2f3g4h5i6-j7k8l -c wait-for-upstream -n integrations` - `curl`'s own error code tells you exactly what's wrong with the command.",
    "`curl: (3)` is curl's own error for a malformed URL - read the exact URL string in the init container's `command` very closely.",
    "`kubectl get deployment webhook-relay -n integrations -o yaml` - compare the URL in `initContainers[0].command` character by character against what a valid URL looks like.",
  ],
  options: [
    {
      id: "malformed-url-single-slash",
      label:
        "The init container's `curl` command has a typo in the URL - `http:/upstream-gateway...` with a single slash instead of `http://upstream-gateway...` with two - which curl rejects outright as a malformed URL (exit code 3, \"bad/illegal format\") before it ever attempts a network connection, so the init container fails identically every single time regardless of whether the upstream dependency is actually reachable.",
      explanation:
        "The log is curl's own error text: \"curl: (3) URL using bad/illegal format or missing URL\" - curl's specific exit code for a malformed URL, distinct from a connection failure or timeout. The command string in the Deployment has exactly one `/` after `http:` instead of two, an easy typo to introduce or miss in review. Because this is a syntax error in the URL itself, no amount of the upstream service being healthy would ever make this succeed - the request never gets far enough to reach the network.",
    },
    {
      id: "upstream-gateway-down",
      label: "The `upstream-gateway` service the init container is checking is actually down.",
      explanation:
        "The scenario confirms the downstream dependency is healthy and reachable throughout, and more directly, curl's error is exit code 3 - a malformed-URL error that occurs before any connection attempt is made - rather than a connection-refused or timeout error that would indicate the target service itself was unreachable.",
    },
    {
      id: "init-container-image-missing",
      label: "The init container's image `webhook-relay-init:1.0.0` doesn't exist in the registry.",
      explanation:
        "The container is confirmed to start and run (it reaches its own command and produces curl's own error output) rather than failing with `ImagePullBackOff` - the image pulls and runs fine, it's the command's URL argument that's malformed.",
    },
    {
      id: "dns-not-resolving-service-name",
      label: "Cluster DNS isn't resolving the `upstream-gateway` service name correctly.",
      explanation:
        "curl's exit code 3 is specifically a URL-format error, occurring before any DNS lookup would even be attempted - a DNS resolution failure would instead produce curl exit code 6 (\"Could not resolve host\"), a distinctly different failure that never happens here because the URL itself is malformed first.",
    },
  ],
  correctOptionId: "malformed-url-single-slash",
  resolution: `curl's own error output names the problem precisely: "URL using
bad/illegal format or missing URL," exit code 3 - curl's specific code
for a malformed URL, raised before any network activity is even
attempted. Looking closely at the init container's command,
\`http:/upstream-gateway.integrations.svc:8080/health\` has a single slash
after \`http:\` instead of the required two - an easy typo to write and an
easy one to skim past in a diff, especially embedded inside a shell
command string rather than a structured field.

The fix is a one-character correction to the URL:

\`\`\`yaml
initContainers:
  - name: wait-for-upstream
    image: registry.internal/webhook-relay-init:1.0.0
    command: ["sh", "-c", "curl -sf http://upstream-gateway.integrations.svc:8080/health"]
\`\`\`

Since this dependency-check is exactly the kind of thing that benefits
from being testable outside a pod, running the same curl command locally
(or in CI against a stub) before shipping it as an init container would
have caught this immediately - init container commands rarely get the
same linting or review scrutiny as application code, which is exactly
how a single missing slash can block every single pod from ever starting.`,
};
