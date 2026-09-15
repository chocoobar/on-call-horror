import type { Scenario } from "./types";

export const ingressBodySizeTooSmall: Scenario = {
  id: "ingress-body-size-too-small",
  title: "The Upload Nobody Sized For",
  subtitle: "small documents upload fine. anything over a megabyte gets an ugly 413 from something that isn't the app",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["ingress", "nginx", "uploads"],
  briefing: `"document-intake" lets customers upload signed PDFs. Small files upload
without issue. Anything larger than roughly a megabyte - a common size for
a scanned, multi-page contract - fails instantly with a 413 error page
that doesn't match document-intake's own error format at all.`,
  constraints: [
    "document-intake's own logs show it never receives the large uploads - the request never reaches the application.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "document-intake", namespace: "intake", labels: { app: "document-intake" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "document-intake-2a3b4c-d5e6f", namespace: "intake", labels: { app: "document-intake" } },
        status: { phase: "Running", containerStatuses: [{ name: "document-intake", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "document-intake": [
            '10.244.2.9 - - [15/Sep/2026:13:02:01 +0000] "POST /upload HTTP/1.1" 200 340',
            '10.244.2.9 - - [15/Sep/2026:13:02:01 +0000] "POST /upload HTTP/1.1" 200 340',
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "document-intake", namespace: "intake" },
        spec: { type: "ClusterIP", clusterIP: "10.96.61.7", selector: { app: "document-intake" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "5d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: "document-intake",
          namespace: "intake",
          annotations: { "kubernetes.io/ingress.class": "nginx" },
        },
        spec: {
          rules: [
            { host: "intake.example.com", http: { paths: [{ path: "/upload", pathType: "Prefix", backend: { service: { name: "document-intake", port: { number: 80 } } } }] } },
          ],
        },
        age: "5d",
        events: [
          { type: "Warning", reason: "RequestEntityTooLarge", age: "3m", message: "client intended to send too large body: 3842211 bytes, exceeds proxy-body-size limit (1m default)" },
        ],
      },
    ],
  },
  hints: [
    "document-intake's own access log never shows the failing large-upload requests - where's the 413 actually coming from?",
    "`kubectl get ingress document-intake -n intake -o yaml` and check its events - does it define a `nginx.ingress.kubernetes.io/proxy-body-size` annotation at all?",
    "nginx ingress controllers default `proxy-body-size` to 1 megabyte unless a larger value is explicitly configured - a scanned multi-page PDF very plausibly crosses that.",
  ],
  options: [
    {
      id: "proxy-body-size-default-1m",
      label:
        "The Ingress has no `nginx.ingress.kubernetes.io/proxy-body-size` annotation set, so the ingress controller falls back to its default 1MB request body limit - uploads larger than that are rejected with a 413 by the ingress controller itself, before document-intake ever sees the request, which matches its access log never showing the failed attempts at all.",
      explanation:
        "The Ingress's own event log states it directly: a 3.8MB upload exceeded the \"proxy-body-size limit (1m default)\". Without an explicit `proxy-body-size` annotation, nginx ingress controllers cap request bodies at 1MB by default - well below the size of a legitimate scanned multi-page contract. document-intake's access log shows only small, successful uploads, confirming the large ones never make it past the ingress controller.",
    },
    {
      id: "document-intake-app-limit",
      label: "document-intake's own application framework has a request body size limit configured too low.",
      explanation:
        "document-intake's access log shows it never receives the large upload requests at all - there's nothing for the application's own body-size limit to reject, because the request is being stopped at the ingress layer first.",
    },
    {
      id: "clusterip-service-payload-limit",
      label: "The ClusterIP Service itself is imposing a payload size restriction.",
      explanation:
        "Kubernetes Services operate at the connection/packet level and have no concept of HTTP request body size at all - any body-size enforcement happens at either the ingress controller or the application layer, not at the Service.",
    },
    {
      id: "client-side-upload-bug",
      label: "The client-side upload code is truncating or corrupting large files before sending them.",
      explanation:
        "The Ingress's own event log shows it explicitly rejecting the request based on declared content length before the body is even fully processed - this is a server-side size limit being enforced, not a client-side file corruption issue.",
    },
  ],
  correctOptionId: "proxy-body-size-default-1m",
  resolution: `The Ingress's event log states the cause plainly: a 3.8MB upload attempt
exceeded the \"proxy-body-size limit (1m default)\". The Ingress has no
\`nginx.ingress.kubernetes.io/proxy-body-size\` annotation set at all, so
the ingress controller falls back to its conservative 1MB default - far
smaller than a typical scanned, multi-page signed contract. Because the
rejection happens at the ingress controller, document-intake's own
access log never shows these requests arriving in the first place, which
is exactly what's observed.

The fix is setting an explicit, appropriately sized limit on the Ingress:

\`\`\`yaml
metadata:
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/proxy-body-size: "25m"
\`\`\`

Sized generously enough to cover realistic legitimate uploads (with some
headroom) while still guarding against truly oversized or abusive
requests. Any service that accepts file uploads behind an nginx ingress
controller needs to explicitly size this annotation to its real-world
use case - the 1MB default is meant as a safe, conservative baseline, not
a limit tuned for any particular application's needs.`,
};
