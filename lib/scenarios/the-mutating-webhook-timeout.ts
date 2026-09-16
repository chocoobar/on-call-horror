import type { Scenario } from "./types";

export const theMutatingWebhookTimeout: Scenario = {
  id: "the-mutating-webhook-timeout",
  title: "The Mutating Webhook Timeout",
  subtitle: "roughly one deploy in five across the whole cluster fails for no consistent reason",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "admission-webhook", "reliability"],
  briefing: `Multiple teams have independently reported flaky \`kubectl apply\` failures
over the past two days - not tied to any one Deployment, namespace, or
manifest. Retrying the exact same apply a few seconds later usually
works. It's intermittent enough that it's been dismissed as "probably
just a blip" more than once, but it keeps happening.`,
  constraints: [
    "The manifests being applied in each reported case are confirmed valid - retrying the identical, unmodified file is what makes it succeed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "admissionregistration.k8s.io/v1",
        kind: "MutatingWebhookConfiguration",
        metadata: { name: "inject-sidecar-proxy" },
        spec: {
          webhooks: [
            {
              name: "inject-sidecar-proxy.platform.internal",
              rules: [{ apiGroups: ["apps", ""], apiVersions: ["v1"], resources: ["deployments", "pods"], operations: ["CREATE", "UPDATE"] }],
              clientConfig: { service: { name: "sidecar-injector", namespace: "platform-mesh", path: "/mutate" } },
              failurePolicy: "Fail",
              timeoutSeconds: 2,
            },
          ],
        },
        age: "5mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "sidecar-injector", namespace: "platform-mesh", labels: { app: "sidecar-injector" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sidecar-injector-perf-notes", namespace: "platform-mesh" },
        spec: {
          data: {
            "notes.md":
              "sidecar-injector's webhook handler typically responds in 150-800ms, but\nunder cluster-wide burst load (many teams applying manifests around the\nsame time - common during business hours) its own p99 latency spikes to\n2-3 seconds due to a slow internal template-rendering step. The\nMutatingWebhookConfiguration's `timeoutSeconds` is set to 2, and\n`failurePolicy: Fail` means any request the webhook doesn't answer\nwithin that window is rejected by the API server, exactly as if the\nwebhook had actively said no - even though the webhook itself remains\nhealthy and would have answered successfully given slightly more time.\nBoth webhook pods are confirmed to never restart or error during any of\nthese incidents; they simply respond too slowly sometimes.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "Look at a failed apply's actual error text closely - does it look like an object-level rejection, or something closer to a timeout?",
    "`kubectl get mutatingwebhookconfiguration inject-sidecar-proxy -o yaml` - check `timeoutSeconds` and `failurePolicy` together.",
    "`kubectl get configmap sidecar-injector-perf-notes -n platform-mesh -o yaml` - how does the webhook's own response time compare to its configured timeout, under load?",
  ],
  options: [
    {
      id: "webhook-timeout-too-tight-under-load",
      label:
        "sidecar-injector's mutating webhook normally responds well within its 2-second `timeoutSeconds`, but under cluster-wide burst load its p99 latency spikes to 2-3 seconds due to a slow template-rendering step - with `failurePolicy: Fail`, any request the webhook doesn't answer inside that 2-second window gets rejected by the API server exactly as if the webhook had said no, even though the webhook is healthy and would have succeeded given slightly more time, which is exactly the kind of load-dependent, retry-fixes-it flakiness affecting unrelated teams' applies at once.",
      explanation:
        "`sidecar-injector-perf-notes` explains the mechanism precisely: normal response times comfortably inside the 2-second budget, but occasional load-driven spikes to 2-3 seconds that exceed it, combined with `failurePolicy: Fail` turning any timeout into a hard rejection. This matches every reported symptom - intermittent, unrelated to any specific manifest or team, resolved by simply retrying (since the next attempt likely lands when the webhook isn't under the same momentary load spike), and affecting any Deployment or Pod create/update across the whole cluster, since the webhook's rules apply broadly.",
    },
    {
      id: "manifests-have-intermittent-typos",
      label: "The affected manifests have subtle, intermittent syntax issues.",
      explanation:
        "The scenario explicitly confirms retrying the *exact same, unmodified* file is what makes it succeed - a genuine manifest problem wouldn't resolve itself on an identical retry with no changes made, which instead points at something external and time-dependent (like a webhook response time) rather than the manifest content itself.",
    },
    {
      id: "rbac-permissions-flapping",
      label: "RBAC permissions for the affected teams are flapping intermittently.",
      explanation:
        "An RBAC denial produces a consistent, deterministic `Forbidden` error for a given user/verb/resource combination - it wouldn't resolve itself on a simple retry of the identical request moments later with nothing else changed, unlike a load-dependent webhook timeout which is inherently intermittent by nature.",
    },
    {
      id: "etcd-write-conflicts",
      label: "Concurrent writes to etcd are causing occasional conflict errors on apply.",
      explanation:
        "An etcd write conflict produces a specific, distinct \"the object has been modified\" conflict error tied to resource versioning, not a webhook-attributed rejection - and it would typically be scoped to concurrent edits of the *same* object, not affect unrelated Deployments across many different teams and namespaces the way this issue does.",
    },
  ],
  correctOptionId: "webhook-timeout-too-tight-under-load",
  resolution: `\`sidecar-injector-perf-notes\` explains exactly why this looks so random:
under normal conditions the webhook responds in 150-800ms, comfortably
inside its 2-second \`timeoutSeconds\` budget - but under cluster-wide
burst load (many teams applying around the same time, which naturally
clusters during business hours) a slow internal template-rendering step
pushes p99 latency to 2-3 seconds, past that budget. \`failurePolicy: Fail\`
means the API server treats any request the webhook doesn't answer in
time as a rejection, indistinguishable from the webhook actively saying
no - even though the webhook pods themselves stay healthy throughout and
would have succeeded given a little more time. Because the trigger is
transient load rather than anything about a specific manifest, retrying
the identical file moments later - when the momentary spike has
typically passed - succeeds, which is exactly the "probably just a blip"
pattern that's been making this easy to dismiss.

The fix is giving the webhook a more realistic timeout margin, and
separately addressing its own slow path:

\`\`\`yaml
webhooks:
  - name: inject-sidecar-proxy.platform.internal
    timeoutSeconds: 8
    failurePolicy: Fail
\`\`\`

paired with actually investigating and speeding up the slow
template-rendering step in sidecar-injector itself (or scaling it up to
handle burst concurrency better), since a longer timeout only buys
margin - it doesn't fix the underlying latency spike, just makes it less
likely to matter. For anything as broadly-scoped and cluster-critical as
a mutating webhook that gates every Deployment/Pod create-or-update, its
own p99 latency under realistic peak load is worth monitoring directly,
since a timeout that's merely "usually enough" quietly becomes a
cluster-wide reliability problem exactly when the cluster is busiest.`,
};
