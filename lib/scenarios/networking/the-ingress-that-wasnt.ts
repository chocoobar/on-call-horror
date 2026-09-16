import type { Scenario } from "../types";

export const theIngressThatWasnt: Scenario = {
  id: "the-ingress-that-wasnt",
  title: "The Ingress That Wasn't",
  subtitle: "/account works fine. /account/anything-else is a 404.",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 15,
  tags: ["ingress", "kubernetes", "routing"],
  briefing: `"account-api" just launched behind a new Ingress. Hitting
\`/account\` in a browser works perfectly. Hitting anything nested under it -
\`/account/profile\`, \`/account/settings\`, literally any sub-path - comes
back as a 404, and it's not account-api returning that 404: the response
doesn't even have account-api's usual error page format.`,
  constraints: [
    "account-api itself is healthy - `kubectl logs` shows it isn't receiving these sub-path requests at all, not that it's rejecting them.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "account-api", namespace: "accounts", labels: { app: "account-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "account-api-3f4g5h6i7-j8k9l", namespace: "accounts", labels: { app: "account-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "account-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "account-api": [
            '10.244.1.14 - - [15/Sep/2026:09:00:01 +0000] "GET /account HTTP/1.1" 200 512',
            '10.244.1.14 - - [15/Sep/2026:09:00:04 +0000] "GET /account HTTP/1.1" 200 512',
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "account-api", namespace: "accounts", labels: { app: "account-api" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.30.40", selector: { app: "account-api" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "2d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "account-api", namespace: "accounts", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: {
          rules: [
            {
              host: "shop.example.com",
              http: {
                paths: [
                  {
                    path: "/account",
                    pathType: "Exact",
                    backend: { service: { name: "account-api", port: { number: 80 } } },
                  },
                ],
              },
            },
          ],
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get ingress account-api -n accounts -o yaml` - look at `pathType` on the one rule that exists.",
    "`pathType: Exact` means the request path has to match the given `path` character-for-character. What would that mean for anything with extra characters after `/account`?",
    "The 404 isn't coming from account-api at all (its own logs never show the sub-path requests arriving) - it's the ingress controller itself declining to route a path that doesn't match any rule.",
  ],
  options: [
    {
      id: "pathtype-exact",
      label:
        "The Ingress rule uses `pathType: Exact` on `/account`, which only matches that literal path - any sub-path like `/account/profile` doesn't match the rule at all, so the ingress controller 404s it before it ever reaches account-api.",
      explanation:
        "`pathType: Exact` requires the request path to match `path` exactly, with no extra segments. `/account` matches; `/account/profile` does not, because it isn't a byte-for-byte match. account-api's own logs confirm it never even sees the sub-path requests - the ingress controller is rejecting them itself, before any backend routing happens, which produces a 404 that doesn't look like anything account-api would generate.",
    },
    {
      id: "service-port-wrong",
      label: "The Ingress points at the wrong Service port.",
      explanation:
        "Requests to the exact `/account` path succeed end-to-end, which means the Service and port are wired correctly - if the port were wrong, even the working path would fail.",
    },
    {
      id: "account-api-routing-bug",
      label: "account-api's own router doesn't have routes defined for `/account/profile` or `/account/settings`.",
      explanation:
        "account-api's logs show it never receives these sub-path requests at all - there's nothing for its internal router to reject, because the requests are being stopped at the Ingress layer before account-api is ever involved.",
    },
    {
      id: "missing-ingress-class",
      label: "The Ingress is missing an `ingressClassName`, so no controller is picking it up at all.",
      explanation:
        "The Ingress clearly is being served by something - `/account` returns a real 200 from account-api, which means an ingress controller is actively routing requests for this Ingress. The `kubernetes.io/ingress.class: nginx` annotation is already doing that job here.",
    },
  ],
  correctOptionId: "pathtype-exact",
  resolution: `The Ingress rule for \`/account\` is defined with \`pathType: Exact\`, which
means the request path has to match \`/account\` character-for-character -
nothing more, nothing less. \`/account/profile\` and \`/account/settings\`
aren't exact matches, so they don't match this rule at all. With no other
rule to catch them, the ingress controller itself returns a 404 before the
request ever reaches account-api - which is exactly why account-api's logs
never show those requests arriving, and why the 404 doesn't look like
anything the app would produce.

The fix is switching to a path type that covers sub-paths, typically
\`Prefix\`:

\`\`\`yaml
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /account
            pathType: Prefix
            backend:
              service:
                name: account-api
                port: { number: 80 }
\`\`\`

\`pathType: Prefix\` matches \`/account\` and anything nested under it
(\`/account/profile\`, \`/account/settings\`, ...) by path *segments*, which
is almost always what's intended for a service that owns everything under
a URL prefix. \`Exact\` is the right choice only when a path genuinely
should not have anything nested under it at all.`,
};
