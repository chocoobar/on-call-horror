import type { Scenario } from "../types";

export const theIngressPathOrderShadowedARoute: Scenario = {
  id: "the-ingress-path-order-shadowed-a-route",
  title: "The Path That Got Shadowed",
  subtitle: "/api/v2/reports never reaches the reports service. it always lands on the generic API gateway instead",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["ingress", "routing", "path-matching"],
  briefing: `A new, more specific Ingress rule was added to route "/api/v2/reports" to
the dedicated "reports-service," carving it out from the general-purpose
"api-gateway" that otherwise handles everything under "/api/v2". Every
request to /api/v2/reports still lands on api-gateway, which doesn't know
what to do with it and returns its own generic error.`,
  constraints: [
    "reports-service itself is healthy and its own logs show it never receives any of these requests at all.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "reports-service", namespace: "platform", labels: { app: "reports-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "40m",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "platform-api", namespace: "platform", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: {
          rules: [
            {
              host: "api.example.com",
              http: {
                paths: [
                  { path: "/api/v2", pathType: "Prefix", backend: { service: { name: "api-gateway", port: { number: 80 } } } },
                  { path: "/api/v2/reports", pathType: "Prefix", backend: { service: { name: "reports-service", port: { number: 80 } } } },
                ],
              },
            },
          ],
        },
        age: "35m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nginx-ingress-matching-notes", namespace: "platform" },
        spec: {
          data: {
            "notes.md":
              "The nginx ingress controller sorts paths within a single Ingress rule\nby specificity (longest matching prefix wins) when generating its\nunderlying nginx config, *not* strictly by the order they're listed in\nthe YAML - this normally makes explicit path ordering unnecessary.\nHowever, this specific ingress-nginx controller version has a known\nissue where paths sharing the exact same `pathType: Prefix` and\ndiffering only by an extra path *segment* can, under some canary or\nmulti-rule merge scenarios, still evaluate in *listed* order rather than\nby computed specificity - meaning whichever path appears first in the\nrule's `paths` list wins for any overlapping request, regardless of\nwhich one is actually more specific.\n",
          },
        },
        age: "35m",
      },
    ],
  },
  hints: [
    "`kubectl get ingress platform-api -n platform -o yaml` - look at the order the two overlapping paths are listed in under `http.paths`.",
    "`/api/v2/reports` matches *both* the `/api/v2` prefix rule and the more specific `/api/v2/reports` rule - which one is listed first?",
    "`kubectl get configmap nginx-ingress-matching-notes -n platform -o yaml` - under this specific controller version's known behavior, does listed order or computed specificity actually win for overlapping prefix paths?",
  ],
  options: [
    {
      id: "broader-path-listed-first-wins",
      label:
        "Both `/api/v2` and `/api/v2/reports` match requests to `/api/v2/reports`, and this ingress-nginx controller version's known matching quirk means the path listed *first* in the rule's `paths` array wins for overlapping prefixes - since the broader `/api/v2` rule (targeting api-gateway) is listed before the more specific `/api/v2/reports` rule (targeting reports-service), every matching request gets routed to api-gateway instead, regardless of which rule is genuinely more specific.",
      explanation:
        "`nginx-ingress-matching-notes` documents the exact quirk in play: for this controller version, overlapping same-`pathType` prefix paths can evaluate in listed order rather than by computed specificity. The Ingress lists `/api/v2` before `/api/v2/reports` in the same rule's `paths` array - exactly matching the observed behavior of every request landing on api-gateway, and reports-service's own logs confirming it never receives any of these requests, consistent with the more specific rule never actually being reached.",
    },
    {
      id: "reports-service-not-ready",
      label: "reports-service's pods aren't actually passing readiness checks yet.",
      explanation:
        "reports-service is confirmed healthy with 2/2 ready replicas - an unready backend would produce a 502/503 from the ingress controller after it attempted to route there, not traffic being silently routed to a completely different service (api-gateway) instead.",
    },
    {
      id: "missing-pathtype-exact",
      label: "The new `/api/v2/reports` rule should use `pathType: Exact` instead of `Prefix`.",
      explanation:
        "`pathType: Exact` would actually make this worse, not better - it would prevent the rule from matching any sub-path under `/api/v2/reports` at all. `Prefix` is the correct choice here; the actual problem is the two overlapping prefix rules' listed order under this controller's specific matching behavior.",
    },
    {
      id: "dns-caching-old-ingress-config",
      label: "The ingress controller has a stale, cached version of the Ingress config from before the new rule was added.",
      explanation:
        "There's no indication of a stale config - the controller is actively applying the Ingress as written, including both rules; the issue is which of the two matching rules it prioritizes for an overlapping request, not that the new rule is missing from its config entirely.",
    },
  ],
  correctOptionId: "broader-path-listed-first-wins",
  resolution: `\`nginx-ingress-matching-notes\` documents the specific quirk causing this:
for this controller version, overlapping paths sharing the same
\`pathType: Prefix\` can evaluate in the order they're *listed* in the
rule's \`paths\` array rather than being resolved purely by computed
specificity, which is the documented, expected default behavior for most
versions. The Ingress lists \`/api/v2\` (targeting \`api-gateway\`) before
the more specific \`/api/v2/reports\` (targeting \`reports-service\`) -
under this quirk, that means the broader rule wins for every overlapping
request, which is exactly why reports-service's own logs show it never
receiving any traffic at all, and every request lands on api-gateway
instead.

The fix is reordering the paths so the more specific rule is listed
first:

\`\`\`yaml
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api/v2/reports
            pathType: Prefix
            backend:
              service:
                name: reports-service
                port: { number: 80 }
          - path: /api/v2
            pathType: Prefix
            backend:
              service:
                name: api-gateway
                port: { number: 80 }
\`\`\`

Even where a given ingress controller's matching is documented to sort by
specificity automatically, it's safest to always list more specific
overlapping paths before broader ones explicitly - it costs nothing when
specificity-based sorting works as expected, and avoids exactly this kind
of silent shadowing when a particular version or edge case doesn't.`,
};
