import type { Scenario } from "./types";

export const clusteripUsedExternallyFails: Scenario = {
  id: "clusterip-used-externally-fails",
  title: "The ClusterIP Nobody Outside Could Reach",
  subtitle: "a partner integration guide points straight at an IP that only exists inside the cluster",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["service", "clusterip", "external-access"],
  briefing: `A new partner was given connection details for "quote-api" so their
systems could call it directly. Every attempt they make times out with no
response at all. Every internal caller inside the cluster reaches
quote-api without any problem, instantly.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "quote-api", namespace: "quotes", labels: { app: "quote-api" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "quote-api", namespace: "quotes" },
        spec: { type: "ClusterIP", clusterIP: "10.96.14.201", selector: { app: "quote-api" }, ports: [{ port: 443, targetPort: 8443 }] },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "partner-integration-notes", namespace: "quotes" },
        spec: {
          data: {
            "notes.md":
              "The connection details sent to the partner were\n`10.96.14.201:443`, copied directly from `kubectl get svc quote-api -o\nwide`. That's quote-api's ClusterIP - a virtual IP that only exists\nwithin the cluster's own internal software-defined network (implemented\nby each node's kube-proxy). It has no meaning and is completely\nunroutable from outside the cluster, including from the partner's own\nnetwork over the internet - there's no cloud load balancer, NodePort, or\nIngress exposing quote-api externally at all right now.\n",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl get svc quote-api -n quotes -o yaml` - what type is this Service? What was actually handed to the partner?",
    "`kubectl get configmap partner-integration-notes -n quotes -o yaml` - where did the connection details the partner was given actually come from?",
    "A ClusterIP is a virtual address meaningful only inside the cluster's own internal network - nothing routes it from the public internet at all, regardless of firewall rules.",
  ],
  options: [
    {
      id: "clusterip-given-to-external-partner",
      label:
        "quote-api is a ClusterIP Service, and its ClusterIP address was handed directly to the external partner as connection details - a ClusterIP only exists within the cluster's own internal network and is completely unroutable from outside it, so every external attempt to reach it just vanishes with no response, while every internal caller (which can actually route to it) works fine.",
      explanation:
        "`partner-integration-notes` confirms exactly what happened: the partner was given `10.96.14.201:443`, copied straight from the Service's ClusterIP, which per the Service's own `type: ClusterIP` is only valid inside the cluster's internal networking. There's no LoadBalancer, NodePort, or Ingress exposing quote-api externally at all - external traffic to a ClusterIP address isn't rejected with an error, it simply has nowhere to be routed to and disappears.",
    },
    {
      id: "firewall-blocking-partner-ip",
      label: "A firewall is blocking the partner's specific source IP range.",
      explanation:
        "There's no external exposure of quote-api at all right now - a firewall rule blocking a specific source would only be relevant if there were a public entry point being reached in the first place. The ClusterIP given out isn't routable from outside the cluster regardless of any firewall configuration.",
    },
    {
      id: "quote-api-tls-cert-issue",
      label: "quote-api's TLS certificate isn't trusted by the partner's systems.",
      explanation:
        "A TLS trust issue would produce a handshake failure or certificate warning after a successful connection - the partner's attempts are timing out with no response of any kind, which happens before any TLS negotiation could even begin, consistent with the address itself simply not being reachable at all.",
    },
    {
      id: "partner-dns-not-configured",
      label: "The partner hasn't configured DNS to resolve quote-api's hostname.",
      explanation:
        "The connection details given to the partner were a raw IP address, not a hostname - there's no DNS resolution step involved in this specific failure at all; the problem is that the IP address itself isn't reachable from outside the cluster, regardless of how it was looked up.",
    },
  ],
  correctOptionId: "clusterip-given-to-external-partner",
  resolution: `\`partner-integration-notes\` confirms the mistake directly: the partner was
handed \`10.96.14.201:443\`, quote-api's ClusterIP, copied straight out of
\`kubectl get svc -o wide\`. A ClusterIP is a virtual address implemented
entirely within the cluster's own internal software-defined network -
each node's kube-proxy knows how to route it, but nothing outside the
cluster, including the partner's systems over the public internet, has
any way to reach it at all. It isn't blocked or rejected; it's simply not
a routable address from anywhere external, which is why the partner's
attempts time out with no response whatsoever while every internal
caller works perfectly.

The fix is actually exposing quote-api externally, through whichever
mechanism fits the partner's needs - typically an Ingress (if HTTP/HTTPS
routing by hostname is enough) or a LoadBalancer Service (for a
dedicated external IP):

\`\`\`yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: quote-api
  namespace: quotes
  annotations:
    kubernetes.io/ingress.class: nginx
spec:
  tls:
    - hosts: ["quotes-partner-api.example.com"]
      secretName: quote-api-tls
  rules:
    - host: quotes-partner-api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: quote-api
                port: { number: 443 }
\`\`\`

Then the partner gets a real, public hostname instead of an internal
ClusterIP. As a general rule, a ClusterIP is never something to hand to
anyone or anything outside the cluster - it's an implementation detail of
in-cluster routing, not a public address.`,
};
