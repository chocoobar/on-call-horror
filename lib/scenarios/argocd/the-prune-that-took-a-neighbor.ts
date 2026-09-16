import type { Scenario } from "../types";

export const thePruneThatTookANeighbor: Scenario = {
  id: "the-prune-that-took-a-neighbor",
  title: "The Prune That Took a Neighbor",
  subtitle: "a routine cleanup sync for catalog-api deleted a Secret that payments-api still needed",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "prune", "shared-resources"],
  briefing: `A routine manifest cleanup for "catalog-api" removed a couple of
long-unused ConfigMaps from its GitOps repo. The sync ran cleanly - and a
few minutes later, "payments-api" (an entirely separate Application)
started failing to start new pods, unable to mount a Secret that had
simply vanished from the cluster.`,
  constraints: [
    "The immediate priority is restoring payments-api, but the fix needs to prevent this class of incident from recurring, not just recreate the one Secret.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-prune-that-took-a-neighbor", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/catalog-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "shared-services" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced", revision: "f6a7b8c" },
          health: { status: "Healthy" },
          operationState: {
            phase: "Succeeded",
            syncResult: {
              resources: [
                { kind: "Secret", name: "shared-db-creds", status: "Pruned" },
                { kind: "ConfigMap", name: "catalog-legacy-flags", status: "Pruned" },
              ],
            },
          },
        },
        age: "15m",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "payments-api", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/payments-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "shared-services" },
          syncPolicy: { automated: { prune: false, selfHeal: false } },
        },
        status: { sync: { status: "OutOfSync" }, health: { status: "Degraded" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shared-namespace-history-notes", namespace: "shared-services" },
        spec: {
          data: {
            "notes.md":
              "catalog-api and payments-api were both set up, years ago, to deploy\ninto the same shared 'shared-services' namespace as a shortcut, before\nper-service namespaces became the norm. `shared-db-creds` was originally\ncreated by catalog-api's own manifests years ago and was, at the time,\nonly used by catalog-api - payments-api started consuming the exact same\nSecret later on as a convenient shortcut, without ever declaring or\nowning it in payments-api's own GitOps manifests. From catalog-api's\nApplication's point of view, `shared-db-creds` was a legitimately owned,\nno-longer-referenced resource being correctly pruned as part of today's\ncleanup - it had no way to know a second, unrelated Application had come\nto depend on it.",
          },
        },
        age: "15m",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-prune-that-took-a-neighbor -n argocd` - the sync result's resource list shows exactly what was pruned, including a Secret with a name that doesn't obviously belong to catalog-api's own domain.",
    "Both Applications deploy into the same namespace, `shared-services` - check whether the pruned Secret was ever actually declared in payments-api's own manifests, or just consumed by it.",
    "`kubectl get configmap shared-namespace-history-notes -n shared-services -o yaml` for how this cross-Application dependency came to exist in the first place.",
  ],
  options: [
    {
      id: "shared-secret-owned-by-one-app-consumed-by-another",
      label:
        "shared-db-creds was declared and owned only by catalog-api's manifests, but payments-api quietly started consuming the same Secret without ever declaring it in its own GitOps source - so when catalog-api's routine cleanup correctly pruned a Secret it legitimately owned and no longer referenced, it took down an entirely separate Application that had an undeclared dependency on it.",
      explanation:
        "`shared-namespace-history-notes` confirms both Applications share the same namespace as a historical shortcut, and that payments-api consumed `shared-db-creds` without ever declaring it in its own manifests - meaning ArgoCD had no way to know a second Application depended on it. From catalog-api's Application's own point of view, pruning an unreferenced resource it legitimately owns is exactly correct, routine behavior; the actual problem is an undeclared cross-Application dependency that made 'legitimate cleanup' and 'breaking payments-api' the same action.",
    },
    {
      id: "prune-cascaded-via-ownerreferences",
      label: "Kubernetes ownerReferences caused the Secret's deletion to cascade and delete a related resource in payments-api.",
      explanation:
        "The sync result shows `shared-db-creds` itself was directly pruned by catalog-api's own sync operation - there's no indication of an ownerReference-driven cascade deleting a *different* resource as a side effect; the Secret payments-api needed was the one ArgoCD directly targeted for pruning, not collateral damage from a cascade.",
    },
    {
      id: "selfheal-payments-api-caused-deletion",
      label: "payments-api's own selfHeal setting caused it to delete the Secret thinking it was drift.",
      explanation:
        "payments-api's Application explicitly has both `prune: false` and `selfHeal: false` - it isn't configured to delete anything at all, whether drift-related or otherwise. The deletion is directly attributed to catalog-api's own sync operation's resource list, a different Application entirely.",
    },
    {
      id: "rbac-allowed-cross-namespace-prune",
      label: "An RBAC misconfiguration let catalog-api's Application prune resources outside its intended scope.",
      explanation:
        "The pruned Secret was in the same namespace (`shared-services`) that catalog-api's Application is already correctly configured to deploy into - there's no cross-namespace or scope-violation element here. The issue is entirely about which Application declares ownership of a shared resource within a namespace both legitimately deploy to.",
    },
  ],
  correctOptionId: "shared-secret-owned-by-one-app-consumed-by-another",
  resolution: `\`shared-namespace-history-notes\` explains the real setup: catalog-api and
payments-api were both, years ago, pointed at the same shared
\`shared-services\` namespace as a convenience shortcut. \`shared-db-creds\`
was originally created by catalog-api's own manifests - payments-api
later started consuming the same Secret without ever declaring it in its
own GitOps source. From catalog-api's Application's perspective, this
morning's cleanup correctly identified \`shared-db-creds\` as a resource it
legitimately owns that's no longer referenced anywhere in its own
manifests, and pruned it exactly as \`prune: true\` is supposed to work.
ArgoCD has no visibility into an undeclared, out-of-band dependency from
a completely separate Application - there was no way for this sync to
know payments-api needed that Secret to keep existing.

Immediate fix: recreate the Secret so payments-api recovers:

\`\`\`
kubectl apply -f shared-db-creds.yaml -n shared-services
\`\`\`

The real fix is giving payments-api its own explicit ownership of what it
actually depends on, rather than silently relying on a resource owned by
a different Application:

\`\`\`yaml
# payments-api's own manifests/
apiVersion: v1
kind: Secret
metadata:
  name: shared-db-creds
  namespace: shared-services
# payments-api now declares and owns this itself
\`\`\`

(coordinate with catalog-api's team so it's removed from *their*
manifests once payments-api owns it directly, to avoid two Applications
fighting over the same declared resource). Longer term, this is also a
good argument for giving each service its own namespace rather than
sharing one as a historical shortcut - shared namespaces make this exact
kind of invisible cross-Application dependency easy to create and hard to
see coming.`,
};
