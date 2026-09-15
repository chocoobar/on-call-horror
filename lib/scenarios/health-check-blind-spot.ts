import type { Scenario } from "./types";

export const healthCheckBlindSpot: Scenario = {
  id: "health-check-blind-spot",
  title: "Health Check Blind Spot",
  subtitle: "ArgoCD says Healthy. The certificate expired six hours ago.",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "health-checks", "cert-manager"],
  briefing: `Customers started getting TLS warnings on "api.example.com" this morning.
The certificate expired six hours ago and cert-manager's renewal attempt
has been failing silently ever since. ArgoCD's dashboard for this
Application has shown a calm, green "Healthy" the entire time.`,
  constraints: [
    "Every standard Kubernetes object involved (the Deployment behind the API, its Service, its Ingress) is genuinely healthy - the failure is isolated to the Certificate resource itself.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "api-gateway", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/api-gateway.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "gateway" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "3c4d5e6f7a8b" }, health: { status: "Healthy" } },
        age: "6mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "api-gateway", namespace: "gateway", labels: { app: "api-gateway" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6mo",
      },
      {
        apiVersion: "cert-manager.io/v1",
        kind: "Certificate",
        metadata: { name: "api-example-com-tls", namespace: "gateway" },
        spec: { secretName: "api-example-com-tls", dnsNames: ["api.example.com"] },
        status: {
          conditions: [
            { type: "Ready", status: "False", reason: "Failed", message: "Failed to wait for order resource \"api-example-com-tls-order-1\" to become ready: order is in \"errored\" state" },
          ],
          notAfter: "2026-09-15T04:00:00Z",
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-health-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "ArgoCD ships with built-in health checks for common resource kinds\n(Deployment, Service, Ingress, etc.) but has no built-in understanding\nof cert-manager's `Certificate` CRD - without a custom Lua health check\nregistered for it, ArgoCD treats any resource kind it doesn't recognize\nas automatically Healthy, regardless of that resource's actual status\nconditions. No custom health check has ever been configured for\n`Certificate` in this cluster.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get certificate api-example-com-tls -n gateway -o yaml` - read `status.conditions` and `status.notAfter` directly; don't trust ArgoCD's rollup for this one.",
    "`kubectl get configmap argocd-health-notes -n argocd -o yaml` - does ArgoCD actually know how to interpret a `Certificate` resource's status, or does it just assume the best for kinds it doesn't recognize?",
    "ArgoCD's Application-level health status is a rollup of every managed resource's *individual* health, using a health check appropriate for that resource's kind. What happens to the rollup when one resource kind has no health check defined for it at all?",
  ],
  options: [
    {
      id: "no-custom-health-check-for-certificate",
      label:
        "ArgoCD has no built-in or custom health check registered for cert-manager's `Certificate` CRD, so it defaults to treating it as Healthy regardless of its actual status - the Certificate's own `status.conditions` clearly show it Failed and expired six hours ago, but that never factors into the Application's rolled-up health at all.",
      explanation:
        "The Certificate's own status is unambiguous: `Ready: False`, `reason: Failed`, and a `notAfter` timestamp six hours in the past - it has been failing and expired the entire time. `argocd-health-notes` confirms ArgoCD has no built-in understanding of this CRD and none was ever added, and that ArgoCD's default behavior for unrecognized kinds is to assume healthy rather than unknown or unhealthy. Every other resource ArgoCD *does* understand (Deployment, Service, Ingress) really is healthy, which is exactly why the Application-level rollup shows a calm, accurate-looking green that has nothing to say about the one resource actually failing.",
    },
    {
      id: "argocd-sync-status-stale",
      label: "ArgoCD's sync status is stale and hasn't picked up the certificate renewal failure.",
      explanation:
        "Sync status (whether live state matches git) and health status (whether resources are working correctly) are separate concerns in ArgoCD - this Application is genuinely `Synced` (git and live state match) and the Certificate resource's failure is a runtime condition, not a drift-from-git issue that a sync status would ever surface.",
    },
    {
      id: "cert-manager-controller-down",
      label: "The cert-manager controller itself is down and not processing anything.",
      explanation:
        "The Certificate resource shows an active, specific failure reason (`order is in \"errored\" state`) from a real renewal attempt - that requires cert-manager's controller to be running and actively processing the resource, not sitting idle or crashed.",
    },
    {
      id: "ingress-tls-misconfigured",
      label: "The Ingress's TLS configuration references the wrong secret name.",
      explanation:
        "The Certificate resource is targeting `secretName: api-example-com-tls`, and there's no indication of a naming mismatch anywhere in the manifests - the actual failure is upstream of any Ingress wiring, in the certificate issuance process itself.",
    },
  ],
  correctOptionId: "no-custom-health-check-for-certificate",
  resolution: `The Certificate resource's own status leaves no ambiguity:
\`Ready: False\`, \`reason: Failed\`, with an ACME order that errored out, and
a \`notAfter\` six hours in the past. None of that reaches ArgoCD's health
rollup for the Application, because - per \`argocd-health-notes\` - ArgoCD
has no built-in health check for cert-manager's \`Certificate\` CRD, and
none was ever custom-registered for this cluster. ArgoCD's default
behavior for a resource kind it doesn't specifically know how to evaluate
is to treat it as healthy by omission, not as unknown or suspect. Every
kind ArgoCD *does* understand here - Deployment, Service, Ingress - really
is fine, so the Application-level status genuinely, accurately reflects
"everything ArgoCD knows how to check is fine" while having nothing to say
about the one thing that's broken.

The fix is registering a custom Lua health check for the \`Certificate\`
kind, so ArgoCD actually inspects its \`status.conditions\` going forward:

\`\`\`yaml
# argocd-cm ConfigMap
data:
  resource.customizations.health.cert-manager.io_Certificate: |
    hs = {}
    if obj.status ~= nil and obj.status.conditions ~= nil then
      for i, condition in ipairs(obj.status.conditions) do
        if condition.type == "Ready" and condition.status == "False" then
          hs.status = "Degraded"
          hs.message = condition.message
          return hs
        end
        if condition.type == "Ready" and condition.status == "True" then
          hs.status = "Healthy"
          return hs
        end
      end
    end
    hs.status = "Progressing"
    return hs
\`\`\`

Any CRD an Application manages that ArgoCD doesn't ship a built-in health
check for is a silent blind spot in that Application's reported health -
worth auditing for any custom resource (cert-manager, external-dns,
database operators, and similar) that a team relies on ArgoCD's dashboard
to reflect accurately.`,
};
