import type { Scenario } from "../types";

export const theImmutableConfigmapStandoff: Scenario = {
  id: "the-immutable-configmap-standoff",
  title: "The Immutable ConfigMap Standoff",
  subtitle: "an urgent feature-flag update to checkout-api won't apply, and kubectl won't say why clearly",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "configmap", "deployment"],
  briefing: `An engineer needs to flip a feature flag off urgently for "checkout-api"
before a promo goes live with a known bug behind it. Their \`kubectl apply\`
of the updated ConfigMap is failing outright - not applying and being
ignored, actually erroring out - and they're not sure why something this
simple would be rejected.`,
  constraints: [
    "The YAML being applied is syntactically valid and was diffed against the live object - the only change is the flag value itself.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-api-flags", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: { data: { "promo-discount-v2": "true" }, immutable: true },
        events: [
          { type: "Warning", reason: "FieldValueForbidden", age: "2m", message: "ConfigMap \"checkout-api-flags\" is invalid: data: Forbidden: field is immutable when `immutable` is set" },
        ],
        age: "45d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api" } },
        spec: {
          replicas: 4,
          template: {
            spec: { containers: [{ name: "checkout-api", image: "registry.internal/checkout-api:9.0.2", envFrom: [{ configMapRef: { name: "checkout-api-flags" } }] }] },
          },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "45d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "checkout-flags-history-notes", namespace: "checkout" },
        spec: {
          data: {
            "notes.md":
              "checkout-api-flags was marked `immutable: true` 45 days ago as part of\na platform-wide push to make feature-flag ConfigMaps immutable - the\nintent was to force flag changes through a proper rollout (new\nConfigMap name + pod template bump) rather than silent in-place edits\nthat pods might pick up at inconsistent times. This was documented in an\ninternal RFC but not widely socialized outside the platform team.\n",
          },
        },
        age: "45d",
      },
    ],
  },
  hints: [
    "`kubectl apply -f <file> -n checkout` and read the actual API error text closely, not just \"it failed\".",
    "`kubectl get configmap checkout-api-flags -n checkout -o yaml` - check `immutable` in its spec.",
    "Once a ConfigMap is marked `immutable: true`, the API server permanently rejects any change to its `data` or `binaryData` - the only way forward is a new object, not an edit to this one.",
  ],
  options: [
    {
      id: "configmap-marked-immutable",
      label:
        "checkout-api-flags was deliberately marked `immutable: true` 45 days ago as part of a platform policy requiring flag changes to go through a new ConfigMap plus a real rollout, rather than in-place edits - the API server is correctly and permanently rejecting any change to `data` on this object, and the only path forward is creating a new ConfigMap and updating the Deployment to reference it.",
      explanation:
        "The event's exact text - \"field is immutable when `immutable` is set\" - names the mechanism directly, and the ConfigMap's own spec confirms `immutable: true`. `checkout-flags-history-notes` explains this was an intentional platform-wide policy from 45 days ago, just one that wasn't widely known outside the team that set it up - which is exactly why an engineer hitting it now finds it confusing rather than expected.",
    },
    {
      id: "rbac-forbidden",
      label: "The engineer's ServiceAccount or user lacks RBAC permission to update ConfigMaps in this namespace.",
      explanation:
        "An RBAC denial produces a distinct `Forbidden` error citing the user/verb/resource (e.g. \"cannot patch resource configmaps\"), not a `FieldValueForbidden` validation error about a specific field being immutable - this is the API server's object validation rejecting the *change itself*, not an authorization check rejecting the *request*.",
    },
    {
      id: "resourcequota-blocking-update",
      label: "A ResourceQuota in the checkout namespace is blocking the ConfigMap update.",
      explanation:
        "ResourceQuotas govern countable resources like CPU, memory, and object counts - they don't apply to editing the contents of an existing ConfigMap at all, and the actual error text is specifically about the `immutable` field, unrelated to any quota mechanism.",
    },
    {
      id: "yaml-syntax-error",
      label: "There's a YAML syntax error in the updated manifest being applied.",
      explanation:
        "The scenario confirms the YAML is syntactically valid and only the flag value differs from the live object - and the actual API error is a specific, well-formed `FieldValueForbidden` validation response about immutability, not a client-side or server-side parsing failure.",
    },
  ],
  correctOptionId: "configmap-marked-immutable",
  resolution: `The API's own error names the exact mechanism: "field is immutable when
\`immutable\` is set." The ConfigMap's spec confirms \`immutable: true\`, and
\`checkout-flags-history-notes\` explains it was set deliberately 45 days
ago, part of a platform policy to force feature-flag changes through a
real rollout (new ConfigMap, new pod template, actual restart) instead of
silent in-place edits landing on pods at inconsistent times - a
reasonable goal that just wasn't well communicated outside the platform
team, so it reads as a mysterious blocker to anyone hitting it cold.

There's no way to edit an immutable ConfigMap's data - the API server
enforces that permanently once the flag is set, by design. The fix is
creating a new ConfigMap and pointing the Deployment at it:

\`\`\`bash
kubectl create configmap checkout-api-flags-v2 \\
  --from-literal=promo-discount-v2=false \\
  --dry-run=client -o yaml -n checkout | kubectl apply -f -
\`\`\`

\`\`\`yaml
envFrom:
  - configMapRef:
      name: checkout-api-flags-v2   # was: checkout-api-flags
\`\`\`

then a rollout of checkout-api to pick it up. It's slower than a
one-line edit under time pressure, but it's exactly the tradeoff the
immutability policy intentionally made - a real rollout with a real
rollback path, instead of an untracked in-place mutation. Worth
socializing this policy more broadly so the next engineer isn't surprised
mid-incident.`,
};
