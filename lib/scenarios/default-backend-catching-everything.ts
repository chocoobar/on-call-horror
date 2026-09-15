import type { Scenario } from "./types";

export const defaultBackendCatchingEverything: Scenario = {
  id: "default-backend-catching-everything",
  title: "The Default Backend Is Catching Everything",
  subtitle: "a brand-new Ingress rule, and every single request to it comes back 404 default backend",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["ingress", "routing", "nginx"],
  briefing: `"loyalty-api" just got its own Ingress rule added to the shared
"storefront" Ingress object, on the host "loyalty.example.com". Every
request to it comes back with a plain-text "default backend - 404" page -
not loyalty-api's own 404, and not any response that looks like it came
from an nginx routing rule that actually matched something.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "loyalty-api", namespace: "storefront", labels: { app: "loyalty-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "loyalty-api", namespace: "storefront" },
        spec: { type: "ClusterIP", clusterIP: "10.96.90.14", selector: { app: "loyalty-api" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "1h",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "storefront", namespace: "storefront", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: {
          rules: [
            { host: "shop.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "storefront-web", port: { number: 80 } } } }] } },
            { host: "cart.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "cart-api", port: { number: 80 } } } }] } },
            { host: "loyalty.exmaple.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "loyalty-api", port: { number: 80 } } } }] } },
          ],
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl get ingress storefront -n storefront -o yaml` - list every `host` value across all three rules and compare them letter by letter.",
    "A request with a `Host` header that doesn't match any rule's `host` field exactly falls through to the ingress controller's own default backend - which produces a generic, unbranded 404, not anything from a real backend.",
    "The new rule's host is `loyalty.exmaple.com` - read that closely against what's actually being requested (`loyalty.example.com`).",
  ],
  options: [
    {
      id: "hostname-typo-exmaple",
      label:
        "The new Ingress rule's `host` field is `loyalty.exmaple.com` (transposed letters) instead of `loyalty.example.com` - no request's actual `Host` header ever matches that rule, so every request falls through to the ingress controller's own default backend, producing the generic, unbranded 404 rather than anything from loyalty-api or even a routing failure that looks ingress-specific.",
      explanation:
        "Reading each rule's `host` value shows the new one is `loyalty.exmaple.com` - two letters transposed - while requests actually arrive with `Host: loyalty.example.com`. Since Ingress host matching requires an exact match, nothing about this rule ever applies to real traffic; it falls through to the ingress controller's catch-all default backend, which serves a plain, generic 404 page that doesn't resemble loyalty-api's own error format or even indicate an Ingress rule almost matched.",
    },
    {
      id: "path-type-mismatch",
      label: "The new rule's `pathType` doesn't match the requests being sent.",
      explanation:
        "The rule uses `pathType: Prefix` on path `/`, which matches any path under the host - consistent with the other two working rules in the same Ingress object, which use the identical pattern successfully. The path matching itself isn't the issue here.",
    },
    {
      id: "loyalty-api-service-misconfigured",
      label: "loyalty-api's Service is misconfigured and not routing to its pods correctly.",
      explanation:
        "A default-backend 404 is served by the ingress controller itself when no Ingress rule matches the incoming request at all - it never gets far enough to even consider the Service or its pods, so a Service misconfiguration wouldn't be reachable as an explanation for this particular symptom.",
    },
    {
      id: "tls-certificate-missing-for-loyalty",
      label: "The Ingress is missing a TLS certificate covering the loyalty.example.com hostname.",
      explanation:
        "A missing TLS certificate for a given host would produce a TLS handshake failure (or a certificate warning) before any HTTP-level routing or 404 response could even be returned - the described symptom is a normal HTTP 404 response being received successfully, which implies the connection and any TLS handshake already succeeded.",
    },
  ],
  correctOptionId: "hostname-typo-exmaple",
  resolution: `Reading every rule's \`host\` field in the shared \`storefront\` Ingress
side by side shows the new one is \`loyalty.exmaple.com\` - two letters
transposed from the intended \`loyalty.example.com\`. Ingress host matching
requires an exact match against the incoming request's \`Host\` header;
real traffic to \`loyalty.example.com\` never matches this misspelled rule
at all. With no rule matching, the ingress controller falls through to
its own default backend - a generic, unbranded catch-all - which is
exactly the plain "default backend - 404" response being seen, distinct
from any 404 loyalty-api itself would ever generate.

The fix is a one-line correction to the hostname:

\`\`\`yaml
spec:
  rules:
    - host: loyalty.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: loyalty-api
                port: { number: 80 }
\`\`\`

A default-backend 404 (rather than any application-specific error page)
is a strong, distinct signal that the ingress controller itself never
matched a rule for the request at all - worth checking every \`host\` field
for typos before looking anywhere downstream at the Service or the
application.`,
};
