import type { Scenario } from "../types";

export const theIngressRewriteTargetMismatch: Scenario = {
  id: "the-ingress-rewrite-target-mismatch",
  title: "The Rewrite That Ate The Path",
  subtitle: "the backend gets a request for '/' no matter what the customer actually asked for",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["ingress", "rewrite", "routing"],
  briefing: `"legacy-invoice-viewer" was just put behind an Ingress with a path prefix
strip, so it can be reached at "/invoices/*" instead of at its own root.
Every request to any specific invoice URL, like "/invoices/8831", returns
the exact same generic landing page - never the specific invoice the
customer actually asked for.`,
  constraints: [
    "legacy-invoice-viewer's own access log confirms it receives every request, but always logs the path as just \"/\" regardless of what URL the customer actually visited.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "legacy-invoice-viewer", namespace: "invoices2", labels: { app: "legacy-invoice-viewer" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "legacy-invoice-viewer-1w2x3y-z4a5b", namespace: "invoices2", labels: { app: "legacy-invoice-viewer" } },
        status: { phase: "Running", containerStatuses: [{ name: "legacy-invoice-viewer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "legacy-invoice-viewer": [
            '10.244.3.20 - - [15/Sep/2026:14:00:01 +0000] "GET / HTTP/1.1" 200 890',
            '10.244.3.20 - - [15/Sep/2026:14:00:05 +0000] "GET / HTTP/1.1" 200 890',
            '10.244.3.20 - - [15/Sep/2026:14:00:09 +0000] "GET / HTTP/1.1" 200 890',
          ],
        },
        age: "1h",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: "legacy-invoice-viewer",
          namespace: "invoices2",
          annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "nginx.ingress.kubernetes.io/rewrite-target": "/",
          },
        },
        spec: {
          rules: [{ host: "invoices.example.com", http: { paths: [{ path: "/invoices", pathType: "Prefix", backend: { service: { name: "legacy-invoice-viewer", port: { number: 80 } } } }] } }],
        },
        age: "55m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nginx-rewrite-notes", namespace: "invoices2" },
        spec: {
          data: {
            "notes.md":
              "The `nginx.ingress.kubernetes.io/rewrite-target` annotation rewrites\nthe path forwarded to the backend to the exact literal string given -\nit isn't automatically 'strip this prefix and forward the rest'\nbehavior. A literal `rewrite-target: /` forwards *every* matching\nrequest to the backend as a request for `/`, discarding the actual\nremainder of the original path entirely, regardless of what came after\nthe matched `/invoices` prefix. Achieving an actual prefix-strip\n(forwarding `/invoices/8831` as `/8831`) requires the Ingress path to be\nwritten as a capture-group regex (e.g. `/invoices(/|$)(.*)`) paired with\na rewrite-target referencing that captured group (e.g. `/$2`) - a plain\nliteral path with a plain literal rewrite-target, as configured here,\nalways forwards the fixed literal string no matter what was actually\nrequested.\n",
          },
        },
        age: "55m",
      },
    ],
  },
  hints: [
    "legacy-invoice-viewer's own access log shows every request logged as `GET /` - even ones for a specific invoice number. Where's the actual path being lost?",
    "`kubectl get ingress legacy-invoice-viewer -n invoices2 -o yaml` - what's the literal value of the `rewrite-target` annotation, and is the `path` a plain string or a capture-group regex?",
    "`kubectl get configmap nginx-rewrite-notes -n invoices2 -o yaml` - does a plain `rewrite-target: /` actually mean 'strip the matched prefix and keep the rest', or does it mean something more literal?",
  ],
  options: [
    {
      id: "literal-rewrite-target-discards-full-path",
      label:
        "The Ingress's `rewrite-target` annotation is a plain literal `/`, and the `path` is a plain prefix match (`/invoices`) with no capture group - since `rewrite-target` rewrites the forwarded path to the exact literal value given rather than automatically preserving the remainder after the matched prefix, every request matching `/invoices*` gets forwarded to the backend as a request for `/`, discarding the actual invoice number (or any other sub-path) entirely, exactly matching every request being logged by the backend as `GET /`.",
      explanation:
        "`nginx-rewrite-notes` explains precisely how `rewrite-target` behaves: it's a literal replacement, not an automatic prefix-strip. The Ingress uses a plain string path (`/invoices`, `pathType: Prefix`) with no regex capture group, paired with a literal `rewrite-target: /` - so nginx always rewrites the forwarded request to exactly `/`, regardless of what came after `/invoices` in the original URL. legacy-invoice-viewer's own access log confirms this directly: every request, regardless of the actual invoice requested, arrives at the backend as `GET /`.",
    },
    {
      id: "legacy-invoice-viewer-routing-bug",
      label: "legacy-invoice-viewer's own internal router has a bug and always serves its default landing page.",
      explanation:
        "legacy-invoice-viewer's own access log shows it genuinely receiving every request as a plain `GET /` - there's no path information reaching the application for its router to act on differently in the first place; the application is behaving completely correctly given what it's actually being asked for.",
    },
    {
      id: "browser-caching-first-invoice-page",
      label: "The customer's browser is caching the first invoice page and serving it for subsequent requests.",
      explanation:
        "The backend's own access log shows fresh, distinct requests actually arriving at the server for each customer action (not being served from any client-side cache) - and every one of those server-side-received requests is logged identically as `GET /`, which is a server-visible fact independent of anything happening in a browser's cache.",
    },
    {
      id: "service-targetport-wrong",
      label: "The Service's `targetPort` doesn't match the port legacy-invoice-viewer listens on.",
      explanation:
        "Every request is confirmed to successfully reach legacy-invoice-viewer and receive a valid 200 response (just always for the wrong page) - a `targetPort` mismatch would prevent requests from reaching the application at all, producing connection failures rather than successful-but-wrong responses.",
    },
  ],
  correctOptionId: "literal-rewrite-target-discards-full-path",
  resolution: `\`nginx-rewrite-notes\` clarifies exactly how \`rewrite-target\` works: it's a
literal replacement of the path forwarded to the backend, not an
automatic "strip the matched prefix and keep whatever's left" behavior.
The Ingress here uses a plain string path (\`/invoices\`, matched as a
\`Prefix\`) with no regex capture group, paired with a literal
\`rewrite-target: /\` - so nginx rewrites *every* matching request to
exactly \`/\`, discarding whatever came after \`/invoices\` in the original
URL entirely, regardless of whether that was \`/invoices/8831\`,
\`/invoices/9042\`, or anything else. legacy-invoice-viewer's own access
log confirms this precisely: every request, no matter what the customer
actually visited, arrives at the backend as a plain \`GET /\`.

The fix is using a capture-group regex path paired with a rewrite-target
that references the captured remainder, which is nginx ingress's actual
mechanism for a true prefix-strip:

\`\`\`yaml
metadata:
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/rewrite-target: /\$2
spec:
  rules:
    - host: invoices.example.com
      http:
        paths:
          - path: /invoices(/|\$)(.*)
            pathType: ImplementationSpecific
            backend:
              service:
                name: legacy-invoice-viewer
                port: { number: 80 }
\`\`\`

With this pattern, a request for \`/invoices/8831\` is forwarded to the
backend as \`/8831\` - the captured remainder after the matched prefix -
rather than being flattened to a fixed literal path. This is one of the
most common nginx ingress footguns: \`rewrite-target\` alone, without a
matching capture-group path, always produces a fixed literal
destination regardless of the original request.`,
};
