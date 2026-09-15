import type { Scenario } from "./types";

export const theWebhookSilentMutation: Scenario = {
  id: "the-webhook-silent-mutation",
  title: "The Webhook Silent Mutation",
  subtitle: "image-worker's memory limit in the cluster doesn't match what's in git, and nobody touched it",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "admission-webhook", "resources"],
  briefing: `An engineer is trying to figure out why "image-worker" keeps getting
OOMKilled despite the manifest in source control clearly requesting
2Gi of memory. Every time they \`kubectl apply\` the exact same file, the
live object ends up with a different, lower memory limit than what they
just applied.`,
  constraints: [
    "The applied YAML file itself is confirmed correct and unchanged - `kubectl apply -f` is being run against the right file with the right contents each time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "image-worker",
          namespace: "media",
          labels: { app: "image-worker" },
          annotations: { "policy.internal/mutated-by": "resource-capper-webhook", "policy.internal/original-memory-limit": "2Gi" },
        },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "image-worker", image: "registry.internal/image-worker:5.0.0", resources: { limits: { memory: "512Mi" }, requests: { memory: "256Mi" } } }] } },
        },
        status: { readyReplicas: 1, updatedReplicas: 3, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "image-worker-5i6j7k8l9-m0n1o", namespace: "media", labels: { app: "image-worker" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "image-worker", ready: false, restartCount: 8, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }],
        },
        age: "40m",
      },
      {
        apiVersion: "admissionregistration.k8s.io/v1",
        kind: "MutatingWebhookConfiguration",
        metadata: { name: "resource-capper" },
        spec: {
          webhooks: [
            {
              name: "resource-capper.platform.internal",
              rules: [{ apiGroups: ["apps"], apiVersions: ["v1"], resources: ["deployments"], operations: ["CREATE", "UPDATE"] }],
              clientConfig: { service: { name: "resource-capper-webhook", namespace: "platform-policy", path: "/mutate" } },
            },
          ],
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "resource-capper-policy-notes", namespace: "platform-policy" },
        spec: {
          data: {
            "notes.md":
              "`resource-capper-webhook` was rolled out 2 months ago cluster-wide to\ncap any container memory limit above 512Mi down to 512Mi by default,\nunless the pod carries the annotation `policy.internal/memory-exempt:\n\"true\"`. It's meant to prevent accidental huge memory requests from\nstarving a shared node pool, and it does log what it changed via the\n`policy.internal/mutated-by` and `policy.internal/original-memory-limit`\nannotations it adds - but it doesn't announce itself anywhere visible\nunless someone reads the applied object's annotations afterward,\nnot the file they submitted.\n",
          },
        },
        age: "2mo",
      },
    ],
  },
  hints: [
    "`kubectl get deployment image-worker -n media -o yaml` and check `metadata.annotations` closely, not just `spec` - a mutating webhook leaves a trace there.",
    "`kubectl get mutatingwebhookconfiguration` - is anything intercepting and rewriting Deployment objects on the way in?",
    "`kubectl get configmap resource-capper-policy-notes -n platform-policy -o yaml` - what does this webhook actually do, and how would an application opt out of it?",
  ],
  options: [
    {
      id: "resource-capper-webhook-reducing-limit",
      label:
        "A cluster-wide `resource-capper-webhook` mutating webhook automatically caps any container's memory limit above 512Mi down to 512Mi on every create/update, unless the pod is explicitly annotated as exempt - it's silently rewriting image-worker's requested 2Gi limit down to 512Mi on every apply, which is far too low for image-worker's actual memory needs and is why it OOMKills, even though the submitted YAML itself is completely correct.",
      explanation:
        "The live Deployment's own annotations are the smoking gun: `policy.internal/mutated-by: resource-capper-webhook` and `policy.internal/original-memory-limit: 2Gi` - direct evidence that a mutating webhook rewrote the object after it was submitted. `resource-capper-policy-notes` confirms the mechanism and the opt-out (an exemption annotation image-worker doesn't currently have). This explains exactly what the engineer is seeing: the file they apply is correct, but the live object ends up different every time, silently, with no error to alert them - which is the defining trait of a mutating (versus validating) webhook.",
    },
    {
      id: "hpa-overriding-resources",
      label: "A VerticalPodAutoscaler is overriding the container's memory limit based on observed usage.",
      explanation:
        "There's no VerticalPodAutoscaler object present here at all, and the live Deployment's own annotations point specifically at a mutating admission webhook (`resource-capper-webhook`) as the source of the change, with a clear before/after value recorded - a VPA would also typically adjust `requests`, not exclusively cap `limits` to a flat ceiling.",
    },
    {
      id: "different-manifest-applied",
      label: "A different, older version of the manifest is actually being applied by mistake.",
      explanation:
        "The scenario confirms the exact same, correct file with a 2Gi limit is being applied every time - the live object's own annotation, `policy.internal/original-memory-limit: 2Gi`, corroborates that 2Gi genuinely was what was submitted, before something else changed it after the fact.",
    },
    {
      id: "node-limitrange-capping-value",
      label: "A namespace `LimitRange` in `media` is capping the container's memory limit.",
      explanation:
        "A `LimitRange` cap would reject or clamp the value at admission time in a way that's visible as a `LimitRange`-attributed validation response, and wouldn't leave webhook-specific annotations like `policy.internal/mutated-by` on the object - the annotations directly attribute this to a mutating webhook, a distinct mechanism from a `LimitRange`.",
    },
  ],
  correctOptionId: "resource-capper-webhook-reducing-limit",
  resolution: `The live Deployment's own annotations give it away directly:
\`policy.internal/mutated-by: resource-capper-webhook\` and
\`policy.internal/original-memory-limit: 2Gi\` - clear evidence that
something rewrote the submitted object after the fact.
\`resource-capper-policy-notes\` confirms what: a cluster-wide mutating
webhook, rolled out two months ago, that caps any container memory limit
above 512Mi down to 512Mi by default, specifically to prevent accidental
huge memory requests from starving shared nodes. It does its job exactly
as designed - image-worker's real requirement of 2Gi gets silently
capped to 512Mi on every single apply, which is nowhere near enough for
its actual workload, hence the OOMKills. Because it's a *mutating*
webhook, there's no error or rejection to notice - the request "succeeds,"
just not with the content that was submitted.

The intended opt-out is the exemption annotation the policy itself
defines:

\`\`\`yaml
metadata:
  annotations:
    policy.internal/memory-exempt: "true"
spec:
  template:
    spec:
      containers:
        - name: image-worker
          resources:
            limits: { memory: 2Gi }
            requests: { memory: 1Gi }
\`\`\`

worth pairing with a quick conversation with the platform team about
whether image-worker's real 2Gi requirement should just be a
permanently-approved exception, or whether the shared node pool needs
capacity planning to comfortably accommodate it. Either way, the bigger
process gap is that this webhook's mutations are only visible by reading
annotations after the fact - a cluster-wide policy that silently rewrites
submitted manifests is worth being much louder about (a `kubectl diff`
habit, or surfacing mutation events somewhere visible) so the next
engineer doesn't lose an hour to the same mystery.`,
};
