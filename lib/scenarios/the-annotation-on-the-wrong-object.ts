import type { Scenario } from "./types";

export const theAnnotationOnTheWrongObject: Scenario = {
  id: "the-annotation-on-the-wrong-object",
  title: "The Annotation On The Wrong Object",
  subtitle: "the CORS fix was approved, merged, deployed - and browsers still reject it",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["ingress", "annotations", "cors"],
  briefing: `A frontend team asked platform to enable CORS for "widget-api" so their
new marketing site can call it directly from the browser. The annotation
was added, the PR merged and deployed. Every browser request still fails
CORS preflight, exactly as before the change.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "widget-api", namespace: "widgets", labels: { app: "widget-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "4d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "widget-api",
          namespace: "widgets",
          annotations: {
            "nginx.ingress.kubernetes.io/enable-cors": "true",
            "nginx.ingress.kubernetes.io/cors-allow-origin": "https://marketing.example.com",
          },
        },
        spec: { type: "ClusterIP", clusterIP: "10.96.19.55", selector: { app: "widget-api" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "4d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "widget-api", namespace: "widgets", annotations: { "kubernetes.io/ingress.class": "nginx" } },
        spec: { rules: [{ host: "widgets.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "widget-api", port: { number: 80 } } } }] } }] },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get svc widget-api -n widgets -o yaml` and `kubectl get ingress widget-api -n widgets -o yaml` - which object actually has the new CORS annotations on it?",
    "nginx ingress controller annotations like `nginx.ingress.kubernetes.io/enable-cors` are only ever read from the Ingress object - a Service carrying the same annotation key has no effect on the controller's behavior at all.",
    "The PR added the right annotation keys with the right values - just check which Kubernetes object it actually modified.",
  ],
  options: [
    {
      id: "cors-annotation-on-service-not-ingress",
      label:
        "The CORS annotations (`enable-cors`, `cors-allow-origin`) were added to the Service object instead of the Ingress object - the nginx ingress controller only ever reads `nginx.ingress.kubernetes.io/*` annotations from the Ingress resource it's directly managing, so annotations on the Service have zero effect on its behavior, and CORS was never actually enabled from the controller's perspective.",
      explanation:
        "Both annotations are present, correctly spelled, with the correct values - but on the Service object, not the Ingress. The nginx ingress controller's annotation-driven configuration is scoped specifically to the Ingress resource; it never inspects the backing Service's own annotations for this purpose, so the change had no effect on the actual proxy configuration at all, exactly matching CORS preflight still failing identically to before.",
    },
    {
      id: "cors-allow-origin-wrong-domain",
      label: "The `cors-allow-origin` value doesn't match the marketing site's actual domain.",
      explanation:
        "The configured value, `https://marketing.example.com`, does match the frontend team's actual domain - the values themselves are correct, they're just set on an object (the Service) the ingress controller never reads CORS configuration from in the first place.",
    },
    {
      id: "ingress-controller-version-lacks-cors",
      label: "The ingress controller version in use doesn't support CORS annotations at all.",
      explanation:
        "nginx ingress controller has supported CORS-related annotations for a long time across essentially all commonly-deployed versions - there's no indication of a version incompatibility here, and the actual issue is more directly explained by which object the annotations were applied to.",
    },
    {
      id: "widget-api-app-cors-middleware-conflict",
      label: "widget-api's own application has CORS middleware that's conflicting with the ingress-level configuration.",
      explanation:
        "Since the ingress-level CORS annotations never took effect at all (being on the wrong object), there's no ingress-level CORS behavior to conflict with anything at the application layer - whatever widget-api itself does or doesn't do with CORS headers is unaffected by, and unrelated to, this specific failure.",
    },
  ],
  correctOptionId: "cors-annotation-on-service-not-ingress",
  resolution: `Both CORS-related annotations - \`nginx.ingress.kubernetes.io/enable-cors\`
and \`nginx.ingress.kubernetes.io/cors-allow-origin\` - are present with
correct, valid values, but they were added to the Service object rather
than the Ingress object. The nginx ingress controller only ever reads
its \`nginx.ingress.kubernetes.io/*\` configuration annotations from the
Ingress resource it manages directly; it has no mechanism for reading
configuration from a backing Service's annotations at all. The PR merged
and deployed cleanly because nothing about it was syntactically invalid -
it just modified an object the ingress controller never looks at for
this purpose, so its actual nginx configuration never changed, and CORS
preflight requests kept failing exactly as before.

The fix is moving the annotations to the Ingress object:

\`\`\`yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: widget-api
  namespace: widgets
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://marketing.example.com"
spec:
  rules:
    - host: widgets.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: widget-api
                port: { number: 80 }
\`\`\`

It's worth removing the leftover annotations from the Service too, since
they serve no purpose there and could mislead the next person debugging
this. As a general rule, any \`nginx.ingress.kubernetes.io/*\` annotation
only ever takes effect on the Ingress resource - never the Service or the
Deployment behind it.`,
};
