import type { Scenario } from "../types";

export const theAppStuckInProgressing: Scenario = {
  id: "the-app-stuck-in-progressing",
  title: "The App Stuck in Progressing",
  subtitle: "shipment-tracker has looked identically 'almost done' for three days straight",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "health-check", "custom-resources"],
  briefing: `"shipment-tracker" deploys a custom "RouteOptimizer" CRD alongside its
Deployment. The Application has shown health status "Progressing" - not
Healthy, not Degraded, just perpetually Progressing - for three days.
Every underlying resource, checked individually, looks completely fine:
Deployment ready, Service has endpoints, RouteOptimizer's own status
fields all look populated and reasonable.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-app-stuck-in-progressing", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/shipment-tracker.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "shipment" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "b4c5d6e" }, health: { status: "Progressing" } },
        age: "3d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipment-tracker", namespace: "shipment" },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "3d",
      },
      {
        apiVersion: "routing.example.com/v1",
        kind: "RouteOptimizer",
        metadata: { name: "shipment-routes", namespace: "shipment" },
        status: { phase: "Active", routesComputed: 1420, lastComputedAt: "2026-09-15T08:00:00Z" },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "lua-health-check-notes", namespace: "argocd" },
        spec: {
          data: {
            "argocd-cm.excerpt":
              "resource.customizations.health.routing.example.com_RouteOptimizer: |\n  hs = {}\n  if obj.status ~= nil and obj.status.phase == \"Active\" then\n    hs.status = \"Healthy\"\n    return hs\n  end\n  hs.status = \"Progressing\"\n  return hs\n",
            "notes.md":
              "This Lua health check has an `if` branch for phase == 'Active' that\nreturns Healthy, but never sets `hs.message` on that path (harmless -\nmessage is optional) - the real issue is a missing `return hs` at the\nVERY end of the script outside the if block, combined with Lua allowing\na function-like script to fall through past the if/else without an\nexplicit final return statement in this ArgoCD health-check execution\ncontext. In practice this isn't the bug: reviewing execution, the `if`\nbranch DOES correctly return early for phase=='Active'. The actual bug:\nobj.status.phase reads 'Active' correctly in the RAW RouteOptimizer\nobject, but ArgoCD's Lua health check receives the object as read at\ncomparison time, and RouteOptimizer's `status` subresource is populated\nby a controller that runs on a slower reconciliation cadence than\nArgoCD's own comparison loop - for the each of the past 3 days,\nArgoCD's health evaluation has been intermittently racing a brief window\nwhere it reads the object BEFORE that reconciliation cycle's status\nupdate lands, seeing a stale intermediate representation cached from\njust before a rolling restart 3 days ago where phase was transiently\n'Initializing' - and because ArgoCD only re-evaluates health on watched\nresource change events, and this particular object's status hasn't\nchanged even slightly (same routesComputed, same lastComputedAt) since\nthat one stale read 3 days ago, there has been no subsequent update\nevent to trigger ArgoCD into re-reading and re-evaluating it since.",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get routeoptimizer shipment-routes -n shipment -o yaml` right now - what does `status.phase` actually say, live, this very moment?",
    "ArgoCD re-evaluates a resource's health when it observes a change event on that resource - if a resource's status hasn't changed at all in three days, when would ArgoCD have last actually re-read and re-evaluated it?",
    "`kubectl get configmap lua-health-check-notes -n argocd -o yaml` for the timeline: what happened three days ago, and why nothing since has prompted a re-evaluation.",
  ],
  options: [
    {
      id: "stale-cached-health-eval-no-new-change-event",
      label:
        "RouteOptimizer's status genuinely reads 'Active' right now, but ArgoCD's health evaluation is only re-triggered by a change event on the resource, and nothing about its status has changed in the three days since a brief rolling-restart window where it transiently read a stale, non-Active phase - so ArgoCD has simply never had a reason to re-read and re-evaluate it since that one stale snapshot.",
      explanation:
        "`lua-health-check-notes` traces the mechanism precisely: the Lua health check itself is correctly written and would return Healthy given the current status. But ArgoCD only re-evaluates health when it observes a resource change event, and RouteOptimizer's status (`routesComputed`, `lastComputedAt`) hasn't changed at all in three days - meaning there's been no event to prompt ArgoCD to re-read it since a brief, transient 'Initializing' phase during a rolling restart three days ago got cached as the last-evaluated state.",
    },
    {
      id: "lua-script-missing-return",
      label: "The Lua health check script is missing a final return statement, causing it to fail silently.",
      explanation:
        "Reviewing the script directly shows the `if obj.status.phase == \"Active\"` branch does correctly `return hs` with `hs.status = \"Healthy\"` - it doesn't fall through unhandled for the Active case. The script itself is fine; the problem is when (or rather, how infrequently) it's actually being invoked against fresh data.",
    },
    {
      id: "deployment-not-actually-ready",
      label: "The Deployment itself has a subtle readiness issue despite showing 3/3 ready.",
      explanation:
        "`readyReplicas`, `updatedReplicas`, and `availableReplicas` are all 3/3 with no other signals of trouble, and the Application's health aggregation depends on ALL of its resources, including RouteOptimizer specifically - there's no reason to suspect the Deployment's own reported status is inaccurate here.",
    },
    {
      id: "crd-status-subresource-not-declared-progressing",
      label: "The RouteOptimizer CRD is missing a status subresource declaration, same as a related but different bug elsewhere.",
      explanation:
        "A missing status-subresource declaration would cause perpetual OutOfSync-from-status-diffing noise (a different, if similar-sounding, failure mode) - not a health status stuck specifically on Progressing due to a stale, un-refreshed evaluation. The actual mechanism here is about when ArgoCD last evaluated health, not about diff normalization.",
    },
  ],
  correctOptionId: "stale-cached-health-eval-no-new-change-event",
  resolution: `\`lua-health-check-notes\` traces the actual sequence: the Lua health check
script is correctly written and does return Healthy for
\`obj.status.phase == "Active"\`. Three days ago, during a rolling restart,
RouteOptimizer's status transiently read a non-Active phase for a brief
window - and ArgoCD evaluated health against exactly that snapshot.
Because ArgoCD only re-evaluates a resource's health in response to a
watched change event on that resource, and RouteOptimizer's status
(\`routesComputed\`, \`lastComputedAt\`) hasn't changed even slightly since -
its own reconciliation controller runs on a slower, largely idle cadence
absent new work - there's been no subsequent event to prompt ArgoCD to
re-read and re-evaluate it. The live object has actually been Healthy
(phase: Active) this entire time; ArgoCD's cached health assessment
simply never got refreshed.

The immediate fix is forcing a fresh evaluation, either via a hard
refresh or by nudging the resource to emit a new change event:

\`\`\`
argocd app get the-app-stuck-in-progressing --hard-refresh
\`\`\`

or

\`\`\`
kubectl annotate routeoptimizer shipment-routes -n shipment \\
  argocd-refresh-trigger="$(date +%s)" --overwrite
\`\`\`

Either forces ArgoCD to re-read and re-evaluate the object, and health
correctly flips to Healthy immediately, matching its genuine live state.
Worth flagging to the platform team as a general gap: a controller whose
status can go long stretches without changing (like RouteOptimizer's,
once routes stabilize) can leave ArgoCD's cached health assessment stale
indefinitely if the one time it was evaluated happened to land during a
transient state - a periodic \`--hard-refresh\` or a controller that
touches a harmless status field (like a heartbeat timestamp) on every
reconciliation, even when nothing else changed, would prevent this from
recurring.`,
};
