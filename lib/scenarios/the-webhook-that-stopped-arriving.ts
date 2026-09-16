import type { Scenario } from "./types";

export const theWebhookThatStoppedArriving: Scenario = {
  id: "the-webhook-that-stopped-arriving",
  title: "The Webhook That Stopped Arriving",
  subtitle: "fast-track deploys for the incident-response tool have quietly gone back to 3-minute polling",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "webhook", "ingress"],
  briefing: `"incident-response-tool" has always deployed within seconds of a merge,
thanks to a GitHub webhook. Last week, deploys started taking the usual
default 3-minute polling delay instead - right after the platform team
rotated the ArgoCD server's Ingress TLS certificate and updated its
Ingress rules as part of routine cert-manager maintenance.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-webhook-that-stopped-arriving", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/incident-response-tool.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "incident-tools" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "d4e5f6a" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ingress-webhook-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "GitHub's webhook delivery log for this repo shows every recent delivery\nattempt to the ArgoCD webhook endpoint failing with '526 Invalid SSL\nCertificate'. Last week's Ingress maintenance rotated the TLS cert AND\nchanged the Ingress path rules - a new rule was added routing\n/api/webhook to a *different* backend service\n(argocd-server-internal, an internal-only variant added for a separate\nproject) ahead of the original rule routing it to the public-facing\nargocd-server service, due to how the Ingress controller\n(nginx-ingress) evaluates path rules by specificity/order when two\nrules could both match the same path. The internal-only backend\npresents a different (internal CA-signed, not the public cert) TLS\nidentity to external callers like GitHub, which GitHub's webhook\ndelivery correctly refuses to trust.",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "Check GitHub's own webhook delivery log for this repo (Settings > Webhooks > Recent Deliveries) - what's the actual HTTP/TLS-level failure reported?",
    "`kubectl get configmap ingress-webhook-notes -n argocd -o yaml` for what changed in the Ingress during last week's maintenance.",
    "Two Ingress rules can both technically match the same path - which one actually wins, and does it route to the service GitHub expects to be talking to?",
  ],
  options: [
    {
      id: "ingress-rule-reorder-routes-webhook-to-internal-backend",
      label:
        "Last week's Ingress maintenance added a new path rule for /api/webhook that, due to rule evaluation order, now matches ahead of the original rule and routes to an internal-only backend service presenting a different TLS identity - GitHub's webhook delivery correctly refuses to trust that certificate, so every delivery fails and ArgoCD falls back to its default 3-minute polling.",
      explanation:
        "`ingress-webhook-notes` traces this exactly: GitHub's own delivery log shows TLS certificate trust failures, and the Ingress now has two rules that can both match /api/webhook, with the new internal-only backend's rule winning due to evaluation order. That backend serves an internal CA-signed cert rather than the public one GitHub expects, so every webhook delivery fails at the TLS handshake - ArgoCD never receives the event and relies entirely on its normal polling loop, which explains the reversion to 3-minute-delay deploys.",
    },
    {
      id: "webhook-secret-rotated-mismatch",
      label: "The webhook's shared secret was rotated on the ArgoCD side but not updated in GitHub's webhook config.",
      explanation:
        "A shared-secret mismatch would produce a signature-verification failure *after* a successful TLS connection and HTTP response (typically a 401/403 from ArgoCD itself) - GitHub's own delivery log here shows deliveries failing at the TLS/certificate level, before any request payload or signature is even evaluated.",
    },
    {
      id: "github-webhook-disabled-accidentally",
      label: "The webhook itself was accidentally disabled in the GitHub repo settings.",
      explanation:
        "GitHub's delivery log shows active delivery *attempts* that are failing, not an absent or disabled webhook - if the webhook itself were disabled, there would be no delivery attempts logged at all, successful or failed.",
    },
    {
      id: "dns-changed-for-argocd-server",
      label: "The DNS record for the ArgoCD server hostname changed during the maintenance.",
      explanation:
        "If DNS itself had changed, the failure would typically be a connection/resolution failure rather than a TLS certificate trust failure - GitHub is clearly reaching *a* server at the expected address and being rejected specifically on certificate trust, consistent with reaching the wrong backend behind the same Ingress host rather than a DNS issue.",
    },
  ],
  correctOptionId: "ingress-rule-reorder-routes-webhook-to-internal-backend",
  resolution: `GitHub's own webhook delivery log shows every recent attempt failing with
a TLS certificate trust error. \`ingress-webhook-notes\` traces the cause:
last week's Ingress maintenance added a new path rule for a separate,
internal-only project that also happens to match \`/api/webhook\` - and due
to how the Ingress controller evaluates overlapping path rules, that new
rule now wins ahead of the original one routing to the public-facing
\`argocd-server\` service. The internal-only backend presents a different,
internal-CA-signed TLS identity, which GitHub's external webhook delivery
correctly refuses to trust. ArgoCD never receives the push event at all,
and falls back entirely to its default periodic polling, explaining the
reversion to a few-minutes delay.

Fix by making the Ingress path rule for the webhook endpoint
unambiguous - either more specific ordering/priority, or a dedicated,
narrowly-scoped rule that can't be shadowed by an unrelated one:

\`\`\`yaml
# Ingress rule for the ArgoCD webhook path, given explicit priority
# (nginx.ingress.kubernetes.io/priority or equivalent for the controller in use)
- path: /api/webhook
  pathType: Exact
  backend:
    service:
      name: argocd-server
      port:
        number: 443
\`\`\`

Once the webhook path routes back to \`argocd-server\` and its correct
public TLS certificate, GitHub's next delivery succeeds, and deploys
return to near-instant. Worth a broader review of the Ingress rule set
after any maintenance that adds a new path - two rules that can both
match the same request path is exactly the kind of thing that's easy to
introduce without noticing which one actually wins.`,
};
