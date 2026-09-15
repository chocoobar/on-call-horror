import type { Scenario } from "./types";

export const silentFailure: Scenario = {
  id: "silent-failure",
  title: "The Silent Failure",
  subtitle: "everything is green, and yet",
  difficulty: "hard",
  type: "fix",
  timeMinutes: 30,
  tags: ["argocd", "networking", "health-checks"],
  briefing: `Customer support has three tickets about the "silent-failure" web app
timing out. You check ArgoCD: the Application is Synced and Healthy. You
check the Deployment: desired replicas match available replicas, every pod
is Running and Ready. Nothing is red anywhere.

ArgoCD's (and Kubernetes') built-in health checks only know what the
Kubernetes API can tell them - a process that started and didn't crash
looks "healthy" even if it isn't actually serving what it's supposed to.
This app has no readiness or liveness probes at all, so nothing is even
checking that.`,
  constraints: [
    "Every top-level status you'll see already claims success. The bug is in how two independent pieces of config relate to each other, not in any single resource's status field.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "silent-failure", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/silent-failure.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "silent-failure" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "4f5e6d7c8b9a" }, health: { status: "Healthy" } },
        age: "3h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "web", namespace: "silent-failure", labels: { app: "web" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "web-5f7c9d8b6-x7k2p", namespace: "silent-failure", labels: { app: "web" } },
        status: { phase: "Running", containerStatuses: [{ name: "web", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Normal", reason: "Scheduled", age: "3h", message: "Successfully assigned silent-failure/web-5f7c9d8b6-x7k2p to node-1" },
          { type: "Normal", reason: "Pulled", age: "3h", message: 'Container image "nginx:1.27-alpine" already present on machine' },
          { type: "Normal", reason: "Created", age: "3h", message: "Created container web" },
          { type: "Normal", reason: "Started", age: "3h", message: "Started container web" },
        ],
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "web", namespace: "silent-failure", labels: { app: "web" } },
        spec: { type: "ClusterIP", clusterIP: "10.96.44.211", selector: { app: "web" }, ports: [{ port: 80, targetPort: 80 }] },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "nginx-conf", namespace: "silent-failure" },
        spec: {
          data: {
            "default.conf":
              "server {\n    listen 8080;\n    server_name localhost;\n\n    location / {\n        root /usr/share/nginx/html;\n        index index.html;\n    }\n}\n",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "Every status field you check - Application, Deployment, Pod - will say everything is fine. Don't trust the summary columns; read the actual spec of each object.",
    "`kubectl get configmap nginx-conf -n silent-failure -o yaml` - this gets mounted straight into the nginx container as its listen config.",
    "Now compare that against `kubectl get service web -n silent-failure -o yaml`. Specifically, what port is nginx actually listening on inside the container, versus what port does the Service send traffic to?",
  ],
  options: [
    {
      id: "selector-mismatch",
      label: "The Service's selector doesn't match the pod's labels.",
      explanation:
        "The Service's selector is `app: web` and the pod's label is `app: web` - they match fine. Traffic does get routed to the pod; the problem is what happens once it arrives.",
    },
    {
      id: "not-enough-replicas",
      label: "The Deployment doesn't have enough replicas to handle the traffic.",
      explanation:
        "This is a connectivity failure (timeouts), not a capacity/latency problem, and there's no indication of load - the single pod that exists can't be reached at all, regardless of replica count.",
    },
    {
      id: "port-mismatch",
      label: "The nginx config (via ConfigMap) listens on port 8080, but the Service sends traffic to port 80, and nothing checks for the mismatch.",
      explanation:
        "Correct. `nginx-conf` sets `listen 8080;`, but the Service's `targetPort` is 80 - nginx isn't listening where the Service expects. With no readiness/liveness probe defined, Kubernetes has no way to detect this: the container process started fine, so the pod shows Ready, and ArgoCD's health check (which just reads Kubernetes' own status) reports Healthy too.",
    },
    {
      id: "network-policy",
      label: "A NetworkPolicy is blocking traffic to the pod.",
      explanation:
        "There's no NetworkPolicy resource in this namespace at all - nothing is restricting traffic at the network layer. The mismatch is entirely inside the app's own config: which port nginx binds vs. which port the Service targets.",
    },
  ],
  correctOptionId: "port-mismatch",
  resolution: `Every status check looks clean - Application Synced/Healthy, Deployment
Available, Pod Running/Ready. None of that means traffic actually gets
through.

\`nginx-conf\` (mounted into the container as nginx's own site config) sets
\`listen 8080;\`, but the Service (\`web\`) sends traffic to \`targetPort: 80\`.
nginx is listening on 8080 inside the pod; nothing is listening on 80.
Since there's no readiness/liveness probe, Kubernetes has no way to know
the app isn't actually reachable on the port the Service expects - the pod
is "Ready" purely because the container process didn't crash.

Fix either side so they agree (simplest: fix the ConfigMap back to the
standard port):

\`\`\`yaml
# nginx-conf: default.conf
server {
    listen 80;
    ...
\`\`\`

commit it, and ArgoCD's automated sync rolls it out - and this time, a real
request actually gets a response.`,
};
