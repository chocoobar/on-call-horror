import type { Scenario } from "../types";

export const wrongIngressClassPickedUpNothing: Scenario = {
  id: "wrong-ingress-class-picked-up-nothing",
  title: "Wrong Ingress Class Picked Up Nothing",
  subtitle: "the new Ingress exists, has an address, and returns nothing but connection refused",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["ingress", "ingress-class", "kubernetes"],
  briefing: `"search-api" just launched behind a brand-new Ingress object. It shows up
fine in \`kubectl get ingress\`, the Service and pods behind it are healthy,
but every request to its hostname comes back "connection refused" -
not a 404, not a 502, nothing that looks like any controller even tried
to handle the request.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-api", namespace: "search", labels: { app: "search-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "search-api", namespace: "search", labels: { app: "search-api" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.55.12", selector: { app: "search-api" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "40m",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "search-api", namespace: "search" },
        spec: {
          rules: [
            {
              host: "search.example.com",
              http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "search-api", port: { number: 80 } } } }] },
            },
          ],
        },
        status: { loadBalancer: {} },
        age: "35m",
        events: [
          { type: "Warning", reason: "NoIngressClass", age: "35m", message: "no IngressClass found matching Ingress - no ingressClassName set and no default IngressClass exists" },
        ],
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "IngressClass",
        metadata: { name: "nginx" },
        spec: { controller: "k8s.io/ingress-nginx" },
        age: "1y",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "billing-api", namespace: "billing", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: { rules: [{ host: "billing.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "billing-api", port: { number: 80 } } } }] } }] },
        status: { loadBalancer: { ingress: [{ ip: "203.0.113.44" }] } },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get ingress search-api -n search -o yaml` - does it have an `ingressClassName`, or an equivalent legacy annotation?",
    "`kubectl get ingressclass` - there's exactly one IngressClass in the cluster (`nginx`), and it isn't marked default. What happens to an Ingress that names no class at all?",
    "Compare against `billing-api`'s working Ingress in another namespace - what does it have that `search-api`'s Ingress doesn't?",
  ],
  options: [
    {
      id: "no-ingress-class-set-no-default-exists",
      label:
        "`search-api`'s Ingress has no `ingressClassName` set and no legacy `kubernetes.io/ingress.class` annotation, and there's no IngressClass marked as default in the cluster - the nginx ingress controller has nothing telling it to claim this Ingress, so no controller ever picks it up or programs any routing for it at all.",
      explanation:
        "The Ingress's own event log says it directly: `no IngressClass found matching Ingress - no ingressClassName set and no default IngressClass exists`. The one IngressClass that does exist (`nginx`) isn't annotated as the cluster default, so it doesn't get used implicitly. `billing-api`'s working Ingress, by contrast, explicitly sets the class via the legacy annotation - nothing ever claims `search-api`'s Ingress, so there's no controller listening on its hostname at all, producing connection refused rather than any HTTP-level response.",
    },
    {
      id: "service-selector-mismatch",
      label: "The Service's selector doesn't match the pod labels behind it.",
      explanation:
        "search-api's Deployment and Service both use the label `app: search-api` consistently, and the pods are confirmed healthy with 2/2 ready - a selector mismatch would show up as empty Endpoints, but the failure here happens before any traffic even reaches the Service, at the Ingress/controller layer.",
    },
    {
      id: "dns-not-pointing-at-lb",
      label: "search.example.com's DNS record doesn't point at the ingress controller's load balancer.",
      explanation:
        "The failure is connection refused, which means something did accept the TCP connection attempt (or a host actively refused it) rather than a DNS lookup failure, which would produce an unknown-host error before any connection was attempted at all - the more direct explanation is the Ingress event itself, showing no controller ever claimed this Ingress.",
    },
    {
      id: "tls-secret-missing",
      label: "The Ingress is missing a TLS secret reference required for HTTPS.",
      explanation:
        "This Ingress doesn't define a `tls` block at all - it's plain HTTP - so a missing TLS secret isn't relevant here, and the connection is being refused rather than failing during a TLS handshake.",
    },
  ],
  correctOptionId: "no-ingress-class-set-no-default-exists",
  resolution: `The Ingress's own event confirms it directly:
\`no IngressClass found matching Ingress - no ingressClassName set and no
default IngressClass exists\`. Modern Ingress objects need to declare which
controller should handle them, either via \`spec.ingressClassName\` or the
older \`kubernetes.io/ingress.class\` annotation. \`search-api\`'s Ingress has
neither, and the one \`IngressClass\` in the cluster (\`nginx\`) isn't marked
as the cluster default, so nothing implicitly claims it either. With no
controller ever programming routing for this Ingress's hostname, there's
nothing listening to accept the connection at all - hence connection
refused, rather than any HTTP-level response a controller would normally
produce even for a broken backend.

The fix is setting the class explicitly:

\`\`\`yaml
spec:
  ingressClassName: nginx
  rules:
    - host: search.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: search-api
                port: { number: 80 }
\`\`\`

Alternatively, marking the existing IngressClass as the cluster default
(\`ingressclass.kubernetes.io/is-default-class: "true"\`) would fix this
Ingress and every future one that omits the field - but explicit is
usually safer in a cluster that might ever run more than one ingress
controller.`,
};
