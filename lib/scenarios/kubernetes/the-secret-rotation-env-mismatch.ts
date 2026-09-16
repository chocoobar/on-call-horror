import type { Scenario } from "../types";

export const theSecretRotationEnvMismatch: Scenario = {
  id: "the-secret-rotation-env-mismatch",
  title: "The Secret Rotation Env Mismatch",
  subtitle: "payment-gateway started rejecting every request with an auth error, right after a routine credential rotation",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "secrets", "rotation"],
  briefing: `A scheduled quarterly API key rotation for "payment-gateway"'s upstream
processor completed without any reported errors - the Secret was updated,
the automation reported success. Ten minutes later, every payment request
started failing with an authentication error from the upstream processor.`,
  constraints: [
    "The new API key itself is confirmed valid and active on the processor's side - it isn't an issue with the rotation's own external step.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "payment-processor-creds", namespace: "payments", annotations: { "rotation.internal/last-rotated": "2026-09-15T08:50:00Z" } },
        spec: { type: "Opaque" },
        age: "3mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payment-gateway", namespace: "payments", labels: { app: "payment-gateway" } },
        spec: {
          replicas: 4,
          template: { spec: { containers: [{ name: "payment-gateway", image: "registry.internal/payment-gateway:10.0.0", env: [{ name: "PROCESSOR_API_KEY", valueFrom: { secretKeyRef: { name: "payment-processor-creds", key: "api-key" } } }] }] } },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "payment-gateway-7p8q9r0s1-t2u3v", namespace: "payments", labels: { app: "payment-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "payment-gateway", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-13T00:00:00Z" } } }] },
        logs: {
          "payment-gateway": [
            "2026-09-15T09:01:00.100Z ERROR processor.Client - upstream returned 401: invalid or expired API key",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "secret-rotation-automation-notes", namespace: "payments" },
        spec: {
          data: {
            "notes.md":
              "The rotation automation correctly updated the `api-key` field inside\n`payment-processor-creds` at 08:50 and correctly activated the new key\non the processor's side - both steps genuinely succeeded, and the\nautomation's own success report was accurate about what it actually\ndid. What it doesn't do (by design, since it wasn't built with this\nresponsibility) is trigger a rollout of any Deployment consuming this\nSecret. payment-gateway's pods inject the key as a plain environment\nvariable at container start (`env.valueFrom.secretKeyRef`) - unlike a\nmounted Secret volume, an env-var-sourced Secret value is read once, at\ncontainer creation, and never re-read afterward for the life of that\ncontainer, no matter how many times the underlying Secret object\nchanges. Every currently-running pod (all started 2 days ago) is still\nusing the *old*, now-deactivated key.\n",
          },
        },
        age: "10m",
      },
    ],
  },
  hints: [
    "`kubectl logs payment-gateway-7p8q9r0s1-t2u3v -n payments` - the upstream error says the key itself is invalid/expired, not that the request is malformed some other way.",
    "`kubectl get pod payment-gateway-7p8q9r0s1-t2u3v -n payments -o yaml` - check the container's `startedAt` against when the Secret was actually rotated.",
    "This Secret is injected via `env.valueFrom.secretKeyRef`, not a mounted volume - when does an environment variable sourced from a Secret actually get its value?",
  ],
  options: [
    {
      id: "env-var-secret-not-reread-after-rotation",
      label:
        "payment-gateway injects the processor API key as a plain environment variable via `secretKeyRef`, which is read once at container creation and never re-read afterward - the rotation automation correctly updated the Secret and activated the new key upstream, but never triggered a rollout, so every currently-running pod (started 2 days before the rotation) is still using the old key baked into its environment at startup, which the processor now correctly rejects as invalid since it was deactivated as part of the same rotation.",
      explanation:
        "The pod's own log shows a clean `401: invalid or expired API key` from the upstream processor - not a malformed-request or connectivity error, an authentication rejection specifically. `secret-rotation-automation-notes` explains why: the rotation itself genuinely succeeded (new key activated upstream, Secret object updated), but env-var-sourced Secret values are fixed at container creation time and never refresh - every pod, all started 2 days before this rotation, is still running with the old key baked into its process environment, which the processor now rejects because it was deactivated as part of the very rotation that just \"succeeded.\"",
    },
    {
      id: "new-api-key-not-actually-valid",
      label: "The new API key generated by the rotation isn't actually valid on the processor's side.",
      explanation:
        "The scenario explicitly confirms the new key is valid and active on the processor's side - the rotation's external step worked correctly. The failure is about which key the running pods are actually using, not whether the new key itself is good.",
    },
    {
      id: "secret-object-not-updated-correctly",
      label: "The rotation automation failed to actually write the new key into the Secret object.",
      explanation:
        "`secret-rotation-automation-notes` confirms the Secret's `api-key` field was correctly updated at 08:50 - the object itself holds the new, valid key right now. The problem is that nothing tells the already-running pods to re-read it, not that the Secret content is wrong.",
    },
    {
      id: "network-policy-blocking-processor",
      label: "A NetworkPolicy is blocking connectivity to the processor's endpoint after the rotation.",
      explanation:
        "The pod's own log shows it successfully reaching the processor and receiving a real, well-formed HTTP 401 response - that requires a completed network connection, ruling out a connectivity or NetworkPolicy block, which would instead show as a timeout or connection-refused error.",
    },
  ],
  correctOptionId: "env-var-secret-not-reread-after-rotation",
  resolution: `The pod's own log shows a clean, specific rejection: \`401: invalid or
expired API key\` from the upstream processor - not a connectivity issue,
an authentication one. \`secret-rotation-automation-notes\` explains
exactly how a "successful" rotation produced this: the automation
correctly updated the Secret's \`api-key\` field and correctly activated
the new key upstream, both genuinely true, which is why its own success
report wasn't wrong. What it never did - because it was never built to -
is trigger a rollout of payment-gateway. The key is injected via
\`env.valueFrom.secretKeyRef\`, and an environment variable sourced from a
Secret is fixed at container creation and never re-read afterward for
that container's lifetime. Every running pod, started two days before
this rotation, is still using the old key baked into its process
environment - a key the same rotation just deactivated on the processor's
side.

The immediate fix is a rollout restart to pick up the new key:

\`\`\`bash
kubectl rollout restart deployment/payment-gateway -n payments
\`\`\`

The durable fix is making the rotation automation's responsibility match
what it actually needs to accomplish - either have it trigger a rollout
restart of every Deployment that consumes the rotated Secret as part of
the same automated job, or switch payment-gateway to mount the Secret as
a volume instead of an env var (a mounted Secret's file content does get
updated in the running container within about a minute of the object
changing, though the application itself would still need to actually
re-read the file rather than caching it once, similar to the ConfigMap
case). Either way, "the Secret object was updated successfully" and "the
pods that use it are using the new value" are two different, unlinked
facts unless something explicit connects them - this rotation's
automation only ever guaranteed the first one.`,
};
