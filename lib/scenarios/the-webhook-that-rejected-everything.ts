import type { Scenario } from "./types";

export const theWebhookThatRejectedEverything: Scenario = {
  id: "the-webhook-that-rejected-everything",
  title: "The Webhook That Rejected Everything",
  subtitle: "no Deployment in the entire `growth` namespace can be applied anymore",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "admission-webhook", "deployment"],
  briefing: `Multiple teams in the "growth" namespace suddenly can't apply any change
to any Deployment - not just theirs, every one, including totally
unrelated services. The errors all mention a validating webhook rejecting
the request, but the reason given doesn't obviously apply to any of the
manifests being submitted.`,
  constraints: [
    "The manifests being submitted are confirmed valid and were working fine yesterday - nobody changed how they write Deployments.",
  ],
  world: {
    resources: [
      {
        apiVersion: "admissionregistration.k8s.io/v1",
        kind: "ValidatingWebhookConfiguration",
        metadata: { name: "require-team-label" },
        spec: {
          webhooks: [
            {
              name: "require-team-label.platform.internal",
              rules: [{ apiGroups: ["apps"], apiVersions: ["v1"], resources: ["deployments"], operations: ["CREATE", "UPDATE"] }],
              clientConfig: { service: { name: "policy-webhook", namespace: "platform-policy", path: "/validate" } },
              failurePolicy: "Fail",
              timeoutSeconds: 5,
            },
          ],
        },
        age: "4mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "policy-webhook", namespace: "platform-policy", labels: { app: "policy-webhook" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "4mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "policy-webhook-4h5i6j7k8-l9m0n", namespace: "platform-policy", labels: { app: "policy-webhook" } },
        status: { phase: "Running", containerStatuses: [{ name: "policy-webhook", ready: false, restartCount: 9, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
        logs: { "policy-webhook": ["2026-09-15T08:45:00Z FATAL policy.Server - failed to load policy ruleset: config/rules.yaml: no such file or directory"] },
        age: "35m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "platform-policy-incident-notes", namespace: "platform-policy" },
        spec: {
          data: {
            "notes.md":
              "policy-webhook's pods started crash-looping 35 minutes ago after an\nunrelated ConfigMap holding its ruleset (config/rules.yaml) was\naccidentally deleted during cleanup of old ConfigMaps. With\n`failurePolicy: Fail` on its ValidatingWebhookConfiguration, if the\nwebhook service can't be reached (or times out) for an in-scope request,\nthe API server rejects the request outright rather than allowing it\nthrough - and with zero healthy policy-webhook pods, every single\nmatching request across every namespace now fails this way.\n",
          },
        },
        age: "35m",
      },
    ],
  },
  hints: [
    "Read the actual webhook rejection error text from a failed `kubectl apply` - does it look like a real policy violation, or something more generic (a timeout, a connection error)?",
    "`kubectl get pods -n platform-policy` - check whether the webhook's own backend service is actually healthy right now.",
    "`kubectl get validatingwebhookconfiguration require-team-label -o yaml` - check `failurePolicy`. What happens to a matching request when the webhook itself is unreachable?",
  ],
  options: [
    {
      id: "webhook-backend-down-failurepolicy-fail",
      label:
        "policy-webhook's own pods have been crash-looping for 35 minutes after their ruleset ConfigMap was accidentally deleted, leaving zero healthy backends for the `require-team-label` ValidatingWebhookConfiguration - with `failurePolicy: Fail`, the API server rejects any matching request it can't get a response for, so every Deployment create/update across every namespace (not just `growth`) is being blocked purely because the webhook itself is unreachable, not because of anything wrong with the submitted manifests.",
      explanation:
        "`platform-policy-incident-notes` explains the root cause and timing precisely: the webhook's ruleset ConfigMap was deleted 35 minutes ago, its pods have been crash-looping ever since (`policy-webhook`'s own logs confirm: \"failed to load policy ruleset... no such file or directory\"), and `failurePolicy: Fail` means the API server treats an unreachable webhook as a hard rejection rather than letting the request through. This explains both the confusing, generic-sounding error text (it's a connectivity/timeout failure, not a real policy verdict) and why it affects every Deployment everywhere the webhook applies to, not just one team's manifests.",
    },
    {
      id: "growth-namespace-labels-changed",
      label: "The `growth` namespace's own labels were changed in a way that now fails a real policy check.",
      explanation:
        "The rejections are affecting Deployments across the whole cluster wherever this webhook applies, not specifically ones tied to `growth` namespace labels, and the webhook backend itself is confirmed to have zero healthy pods right now - which points at the webhook being entirely unreachable, not at a real policy verdict being newly and correctly enforced.",
    },
    {
      id: "rbac-blocking-deployment-updates",
      label: "RBAC permissions for updating Deployments were recently tightened across the cluster.",
      explanation:
        "An RBAC denial produces a distinct `Forbidden` error citing the user, verb, and resource - the errors described here specifically reference a validating webhook rejecting the request, a different mechanism entirely, and one directly explained by the webhook's own backend being down.",
    },
    {
      id: "etcd-performance-issue",
      label: "The cluster's etcd is under load and slow to respond, causing writes to fail.",
      explanation:
        "An etcd performance issue would produce generic API server slowness or timeouts across many resource types and operations, not a rejection specifically attributed to a named validating webhook - the errors here point directly at the webhook mechanism, and the webhook's own backend is confirmed unhealthy, which is a more specific and sufficient explanation.",
    },
  ],
  correctOptionId: "webhook-backend-down-failurepolicy-fail",
  resolution: `\`platform-policy-incident-notes\` and \`policy-webhook\`'s own crash logs tell
the whole story: 35 minutes ago, an unrelated ConfigMap cleanup
accidentally deleted the ConfigMap holding policy-webhook's ruleset
(\`config/rules.yaml\`), and every pod has been crash-looping trying to
load it ever since - zero healthy backends for the
\`require-team-label\` webhook. That webhook's \`failurePolicy: Fail\` means
the API server treats "couldn't reach the webhook" the same as "the
webhook said no": every matching request gets rejected outright. Since
the webhook's rules apply to Deployment create/update everywhere, not
just \`growth\`, the blast radius is the entire cluster - which is exactly
why the error text feels disconnected from anything actually wrong with
the manifests being submitted; it's a connectivity failure wearing a
policy-rejection costume.

There's no live fix from this read-only console, but the real fix is
restoring the deleted ConfigMap so policy-webhook's pods can start:

\`\`\`bash
kubectl apply -f platform-policy/rules-configmap.yaml -n platform-policy
\`\`\`

Once the pods are healthy again, admission resumes normally across the
cluster with no other action needed. If an incident like this needs an
emergency unblock before that fix lands, temporarily setting
\`failurePolicy: Ignore\` on the webhook lets requests through
un-validated during the outage - a real tradeoff (policy isn't enforced
meanwhile) that should only be a deliberate, short-lived decision, not a
permanent setting, since it defeats the whole purpose of a validating
webhook whenever its backend happens to be down.`,
};
