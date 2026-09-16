import type { Scenario } from "./types";

export const theAdmissionWebhookCascadeFailure: Scenario = {
  id: "the-admission-webhook-cascade-failure",
  title: "The Admission Webhook Cascade Failure",
  subtitle: "the whole platform team's Deployments are failing, and so is the webhook meant to protect them",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "admission-webhook", "cascading-failure"],
  briefing: `Deployments cluster-wide started failing an hour ago with validation
errors from "resource-policy-webhook". Digging into the webhook itself,
its pods are crash-looping too - and the reason they're crash-looping
traces back to a Deployment apply that itself needed the webhook to
succeed. Every angle you check seems to loop back into the same problem.`,
  constraints: [
    "No one made any intentional change to `resource-policy-webhook` or its dependencies in the last 24 hours - this started on its own.",
  ],
  world: {
    resources: [
      {
        apiVersion: "admissionregistration.k8s.io/v1",
        kind: "ValidatingWebhookConfiguration",
        metadata: { name: "resource-policy-webhook" },
        spec: {
          webhooks: [
            {
              name: "resource-policy.platform.internal",
              rules: [{ apiGroups: ["apps"], apiVersions: ["v1"], resources: ["deployments"], operations: ["CREATE", "UPDATE"] }],
              clientConfig: { service: { name: "resource-policy-webhook", namespace: "platform-policy", path: "/validate" } },
              failurePolicy: "Fail",
              namespaceSelector: { matchExpressions: [{ key: "policy.internal/exempt", operator: "DoesNotExist" }] },
            },
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "resource-policy-webhook", namespace: "platform-policy", labels: { app: "resource-policy-webhook" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 0, updatedReplicas: 2, availableReplicas: 0 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "resource-policy-webhook-7t8u9v0w1-x2y3z", namespace: "platform-policy", labels: { app: "resource-policy-webhook" } },
        status: { phase: "Pending", containerStatuses: [{ name: "resource-policy-webhook", ready: false, restartCount: 0, state: { waiting: { reason: "ImagePullBackOff" } } }] },
        events: [
          { type: "Warning", reason: "Failed", age: "50m", message: "Failed to pull image \"registry.internal/resource-policy-webhook:2.4.1\": rpc error: code = Unknown desc = failed to authorize: 401 Unauthorized: authentication token has expired" },
        ],
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "platform-policy-namespace-scope-notes", namespace: "platform-policy" },
        spec: {
          data: {
            "notes.md":
              "Root cause: the same registry pull-secret expiry that's blocking\napplication image pulls elsewhere in the cluster today also affects\n`resource-policy-webhook`'s own image - its 2 pods have been unable to\npull a fresh image for an hour and are stuck ImagePullBackOff, not\ncrash-looping from an application bug. Crucially, the `platform-policy`\nnamespace itself is NOT exempt from the webhook's own rules (its\nnamespaceSelector only excludes namespaces explicitly labeled\n`policy.internal/exempt`, which `platform-policy` never was) - so even\na fresh, correctly-configured redeploy attempt of the webhook's own\nDeployment would itself need to pass through the (currently unreachable)\nwebhook to be admitted, a structural bootstrapping trap once the webhook\nis fully down with `failurePolicy: Fail`.\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n platform-policy` - is `resource-policy-webhook` actually crash-looping from application code, or is it failing even earlier than that?",
    "The image pull failure's error text looks familiar - is this the same root cause affecting other, unrelated apps elsewhere in the cluster right now?",
    "`kubectl get validatingwebhookconfiguration resource-policy-webhook -o yaml` - check `namespaceSelector`. Does the webhook's own namespace get a free pass from its own rules, or does it have to obey them like everyone else?",
  ],
  options: [
    {
      id: "expired-pull-secret-plus-self-referential-webhook-scope",
      label:
        "resource-policy-webhook's own pods can't pull a fresh image because the same registry credential expiry affecting other apps today also hit its image pull, leaving it stuck `ImagePullBackOff` (not application-crash-looping) with zero healthy replicas - and because the webhook's own `namespaceSelector` doesn't exempt `platform-policy`, any attempt to fix and redeploy the webhook's Deployment itself has to pass through the very webhook that's currently unreachable, creating a structural bootstrapping deadlock on top of the original credential problem.",
      explanation:
        "The webhook's pod status is `ImagePullBackOff` with a `401 Unauthorized: authentication token has expired` error - a pull-credential failure, not an application crash. `platform-policy-namespace-scope-notes` names both halves of the cascade explicitly: the same expired-credential root cause affecting other apps cluster-wide, plus the critical detail that the webhook's own namespace was never exempted from its own rules, meaning a fix attempt would itself need to clear a currently-unreachable gate - explaining why every angle of investigation seems to loop back into the same problem.",
    },
    {
      id: "webhook-application-bug-from-recent-change",
      label: "A recent code change to resource-policy-webhook introduced a startup bug causing it to crash-loop.",
      explanation:
        "The scenario confirms no intentional change was made to the webhook or its dependencies in the last 24 hours, and its pod status is specifically `ImagePullBackOff` - the container never even starts running, let alone reaches application code that could contain a startup bug.",
    },
    {
      id: "kubernetes-api-server-degraded",
      label: "The Kubernetes API server itself is degraded, causing webhook calls to fail cluster-wide.",
      explanation:
        "If the API server itself were degraded, the impact would be far broader than Deployment validation specifically - every kind of API operation would be affected. The failure here is scoped specifically to this one webhook's own pods being unable to pull their image, a much more targeted explanation that fully accounts for the observed symptoms.",
    },
    {
      id: "circular-owner-reference",
      label: "A circular Kubernetes owner-reference between the webhook's own objects is causing a reconciliation loop.",
      explanation:
        "There's no evidence of an owner-reference cycle here - the failure chain is explained entirely by an image pull credential expiring (a straightforward external dependency failure) combined with the webhook's namespace not being exempt from its own admission rules, not by any object ownership graph issue.",
    },
  ],
  correctOptionId: "expired-pull-secret-plus-self-referential-webhook-scope",
  resolution: `resource-policy-webhook's pods show \`ImagePullBackOff\` with a \`401
Unauthorized: authentication token has expired\` error - not a crash from
application code, a failure to even pull the image. \`platform-policy-namespace-scope-notes\`
connects this to the same registry credential expiry affecting other
unrelated apps across the cluster today, and adds the detail that turns
this into a genuine deadlock rather than a simple, if painful, outage:
the webhook's own \`namespaceSelector\` was never configured to exempt its
own namespace, \`platform-policy\`, from its own rules. With
\`failurePolicy: Fail\` and zero healthy webhook backends, *any* attempt to
apply a fix - including redeploying the webhook itself with a corrected
image pull secret - has to first pass through the very webhook that's
currently unreachable, which is exactly why every angle of investigation
loops back into the same problem.

Breaking the deadlock requires stepping outside the normal path. Two
options, in order of preference: if cluster-admin access allows it,
temporarily exempt \`platform-policy\` from the webhook's own rules to let
a fix through:

\`\`\`yaml
# on the platform-policy namespace itself
metadata:
  labels:
    policy.internal/exempt: "true"   # temporary, remove after recovery
\`\`\`

which lets a corrected Deployment (with a refreshed image pull secret)
be applied without needing the webhook's own approval. Alternatively,
temporarily flip the webhook's own \`failurePolicy\` to \`Ignore\` cluster-wide
during the recovery window - a real, deliberate tradeoff (no policy
enforcement anywhere until the webhook is healthy again) but one that
unblocks every other team's Deployments immediately, not just the
webhook's own.

For the future: any cluster-wide admission webhook is a single point of
failure by design, and its own namespace should almost always be exempt
from its own rules specifically to prevent this exact bootstrapping trap
- a webhook that can accidentally lock out its own ability to be fixed
is a structural risk worth eliminating before it's needed under
pressure, not after.`,
};
