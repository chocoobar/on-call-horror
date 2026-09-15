import type { Scenario } from "./types";

export const theLuaScriptThatLied: Scenario = {
  id: "the-lua-script-that-lied",
  title: "The Lua Script That Lied",
  subtitle: "cert-rotator has shown Healthy for three days while actually failing every renewal",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 15,
  tags: ["argocd", "health-check", "lua"],
  briefing: `"cert-rotator" runs a custom CRD-based controller with a custom Lua health
check configured in ArgoCD so the Application's health reflects the
controller's actual certificate-renewal status, not just whether its pod
is running. It's shown Healthy for three days straight - but a customer
just reported a certificate expiry that this controller was supposed to
prevent.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-lua-script-that-lied", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/cert-rotator.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "cert-rotator" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "a4b5c6d" }, health: { status: "Healthy" } },
        age: "3d",
      },
      {
        apiVersion: "example.com/v1",
        kind: "CertRotation",
        metadata: { name: "cert-rotator-main", namespace: "cert-rotator" },
        status: { phase: "RenewalFailed", lastRenewalError: "ACME challenge validation failed: DNS record not propagated in time", conditionsCount: 3 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-cm", namespace: "argocd" },
        spec: {
          data: {
            "resource.customizations.health.example.com_CertRotation":
              "hs = {}\nhs.status = \"Healthy\"\nhs.message = \"default\"\nreturn hs\n",
            "notes.md":
              "This custom Lua health check for the CertRotation CRD unconditionally\nreturns Healthy, ignoring `obj.status.phase` entirely - it was written as\na quick placeholder during initial setup three months ago ('just get\nsomething in so the Application shows a health status') and nobody ever\ncame back to make it actually inspect `.status.phase` or\n`.status.lastRenewalError`.",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "`kubectl get certrotation cert-rotator-main -n cert-rotator -o yaml` - check `status.phase` on the actual custom resource.",
    "`kubectl get configmap argocd-cm -n argocd -o yaml` and read the `resource.customizations.health.example.com_CertRotation` Lua script carefully - does it look at the object's status at all?",
    "A custom health check that always returns the same status regardless of input will make the Application look healthy no matter what the underlying resource is actually doing.",
  ],
  options: [
    {
      id: "lua-health-check-hardcoded-healthy",
      label:
        "The custom Lua health check for the CertRotation CRD is a placeholder that unconditionally returns Healthy without ever reading `obj.status.phase` or any other field - so no matter what the actual CertRotation resource's status says, including a real RenewalFailed state, ArgoCD reports the Application as Healthy.",
      explanation:
        "The CertRotation resource's own `status.phase` is `RenewalFailed` with a specific ACME error message - a real, ongoing failure. But `argocd-cm`'s Lua script for this CRD's health check literally just sets `hs.status = \"Healthy\"` unconditionally and returns, never once referencing `obj.status` - it's a placeholder from initial setup that nobody finished writing, so it reports Healthy regardless of what's actually happening.",
    },
    {
      id: "controller-not-updating-status",
      label: "The CertRotation controller itself isn't updating its own status field.",
      explanation:
        "The CertRotation resource's status is actively populated and specific - `phase: RenewalFailed` with a real ACME error message and a conditions count - which shows the controller is updating its status correctly. The problem is entirely that ArgoCD's health check script never looks at that status at all.",
    },
    {
      id: "sync-status-not-health-status",
      label: "The Application's sync status is what's wrong, not its health status.",
      explanation:
        "`status.sync.status` is `Synced`, which is accurate - the manifests in git really have been applied to the cluster correctly. The actual problem is entirely in `status.health.status`, which is misreporting Healthy due to the placeholder Lua script, not a sync/drift issue.",
    },
    {
      id: "crd-schema-mismatch",
      label: "The CertRotation CRD's schema doesn't match what the controller is writing to status.",
      explanation:
        "The CertRotation object's status is readable and contains a well-formed `phase` and `lastRenewalError` field, exactly as expected - there's no schema mismatch here. ArgoCD's health check script is just never reading those fields at all.",
    },
  ],
  correctOptionId: "lua-health-check-hardcoded-healthy",
  resolution: `The CertRotation resource's own \`status.phase\` is \`RenewalFailed\`, with a
specific ACME DNS-validation error - a genuine, ongoing failure that's
been sitting there for days. But \`argocd-cm\`'s custom Lua health check
for this CRD, written as a quick placeholder three months ago, simply
returns \`hs.status = "Healthy"\` unconditionally without ever reading
\`obj.status\` at all. ArgoCD faithfully reports whatever the health check
script tells it - here, that's "Healthy," no matter what's actually
happening underneath.

Fix by making the script actually inspect the resource's real status:

\`\`\`lua
hs = {}
if obj.status ~= nil and obj.status.phase ~= nil then
  if obj.status.phase == "Ready" then
    hs.status = "Healthy"
    hs.message = "Certificates current"
    return hs
  elseif obj.status.phase == "RenewalFailed" then
    hs.status = "Degraded"
    hs.message = obj.status.lastRenewalError or "Renewal failed"
    return hs
  end
end
hs.status = "Progressing"
hs.message = "Waiting for status"
return hs
\`\`\`

Once this is in \`argocd-cm\` under
\`resource.customizations.health.example.com_CertRotation\`, the
Application's health immediately reflects the real RenewalFailed state,
and any future renewal failure will actually be visible instead of
silently hidden behind a placeholder that was never finished.`,
};
