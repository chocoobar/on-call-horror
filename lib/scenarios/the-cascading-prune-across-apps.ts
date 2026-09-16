import type { Scenario } from "./types";

export const theCascadingPruneAcrossApps: Scenario = {
  id: "the-cascading-prune-across-apps",
  title: "The Cascading Prune Across Apps",
  subtitle: "renaming one CRD field quietly deleted six other teams' custom resources",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "prune", "crd"],
  briefing: `The platform team renamed a field on the shared "ServiceQuota" CRD (used
by a dozen teams to request namespace resource quotas via GitOps) and
updated the owning "quota-controller" Application's own manifests to
match. Within minutes, six unrelated teams' Applications each pruned
their own ServiceQuota custom resource - none of which had anything to do
with the renamed field, or with the quota-controller repo at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-cascading-prune-across-apps", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/checkout-team-config.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "checkout" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
          operationState: { phase: "Succeeded", syncResult: { resources: [{ kind: "ServiceQuota", name: "checkout-quota", status: "Pruned" }] } },
        },
        age: "10m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "crd-field-rename-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "quota-controller's Application manifests declare the ServiceQuota CRD\nitself (its schema definition). The platform team's rename changed the\nCRD's `spec.versions[].schema` structure in a way that also (perhaps\nunintentionally) changed the version served/storage flags: the OLD CRD\nversion `v1beta1` had `served: true` and was what every consuming\nteam's own ServiceQuota manifests (checkout, billing, etc., each in\ntheir own separate repo/Application) were written against via\n`apiVersion: quota.example.com/v1beta1`. The updated CRD sets\n`v1beta1.served: false` (superseded by a new `v1` version with the\nrenamed field, intended for teams to migrate to on their own schedule) -\nbut ArgoCD's resource comparison for each consuming Application, upon\nits next comparison, could no longer read/find their own ServiceQuota\nresource via the now-unserved v1beta1 API (a 'served: false' version\nsimply stops being queryable through that apiVersion at all), which\nArgoCD's comparison logic interpreted as 'this declared resource no\nlonger exists live under this apiVersion' rather than distinguishing\nthat from 'this resource was intentionally removed from git' - and with\nprune enabled on each of those consuming Applications, treated the\nmismatch as prune-eligible, deleting each team's actual, still-declared-\nin-their-own-git ServiceQuota object.",
          },
        },
        age: "10m",
      },
    ],
  },
  hints: [
    "None of the six affected teams touched their own repos recently - the trigger has to be something shared and cluster-wide that changed underneath all of them at once. What did the quota-controller change actually touch?",
    "`kubectl get crd servicequotas.quota.example.com -o yaml` - check `spec.versions[].served` for every version, old and new.",
    "`kubectl get configmap crd-field-rename-notes -n argocd -o yaml` for exactly what the CRD update changed about which API version is actually servable, versus which version every other team's own manifests still declare.",
  ],
  options: [
    {
      id: "crd-update-disabled-old-served-version-pruned-consumers",
      label:
        "The CRD update disabled serving of the old v1beta1 API version that every consuming team's own ServiceQuota manifests still use - once that version stopped being queryable, ArgoCD's comparison for each of those Applications could no longer find their declared resource live at all, and with prune enabled, treated the now-unreadable resource as no-longer-existing-so-safe-to-delete rather than recognizing it as still genuinely declared in git under an API version that simply stopped being served.",
      explanation:
        "`crd-field-rename-notes` traces the mechanism precisely: the CRD update set `v1beta1.served: false`, and every affected team's manifests (checkout included, per the sync result showing their ServiceQuota pruned) still declare `apiVersion: quota.example.com/v1beta1`. Once that version stops being served, ArgoCD simply can't find the resource live under that apiVersion anymore during comparison - and rather than distinguishing 'genuinely removed from git' from 'still declared but unreachable via this API version,' each consuming Application's prune-enabled sync deleted what it could no longer see, even though nothing in any of those teams' own git repos had changed.",
    },
    {
      id: "quota-controller-manually-deleted-resources",
      label: "The quota-controller's own sync directly deleted the other teams' ServiceQuota resources.",
      explanation:
        "quota-controller's Application only manages the CRD definition itself, not other teams' individual ServiceQuota instances - each affected team's own separate Application performed its own prune of its own resource, per the sync result shown, driven by each Application's own comparison against the now-differently-served CRD, not by any direct action from quota-controller's sync.",
    },
    {
      id: "rbac-changed-for-consuming-teams",
      label: "RBAC permissions for the consuming teams' Applications changed as part of the CRD update.",
      explanation:
        "There's no indication of an RBAC change here at all - the affected Applications successfully performed a real prune operation (their own ServiceQuota was genuinely deleted, not blocked by a permission error), which is consistent with ArgoCD successfully executing a delete it believed was correct, not a permissions problem preventing an action.",
    },
    {
      id: "webhook-conversion-failure-crd",
      label: "A CRD conversion webhook between v1beta1 and v1 is failing, causing data loss.",
      explanation:
        "The issue isn't a conversion failure corrupting data mid-flight - it's that the old version stopped being *served* at all (a deliberate, if consequential, flag on the CRD), which is a simpler and more direct explanation fully supported by the notes, without needing a separate conversion webhook failure to account for what happened.",
    },
  ],
  correctOptionId: "crd-update-disabled-old-served-version-pruned-consumers",
  resolution: `\`crd-field-rename-notes\` traces the full mechanism: the platform team's
update to the ServiceQuota CRD set the old \`v1beta1\` version's
\`served: false\`, intending for teams to migrate to the new \`v1\` schema
on their own schedule. But every consuming team's own ServiceQuota
manifests - checkout's included, entirely unrelated to the
quota-controller repo - still declare \`apiVersion:
quota.example.com/v1beta1\`. The instant that version stopped being
served, those resources became unreachable via the API version each
team's manifests actually use. ArgoCD's comparison logic for each of
those Applications couldn't distinguish "this resource is genuinely gone
from git" from "this resource is still declared in git but currently
unreachable via its declared apiVersion" - both look identical as "the
declared resource doesn't exist live." With prune enabled on each of
those Applications (entirely standard, unrelated to anything about this
incident), each one deleted what it could no longer see, even though
nothing in any of those teams' own repos had changed at all.

Immediate fix: re-enable serving of the old version so the affected
teams' resources become visible (and therefore re-creatable/re-syncable)
again, while the migration to v1 happens properly:

\`\`\`yaml
spec:
  versions:
    - name: v1beta1
      served: true   # restored
      storage: false
    - name: v1
      served: true
      storage: true
\`\`\`

Then re-sync each affected team's Application to recreate their pruned
ServiceQuota resources. Longer term, any CRD version deprecation that
disables serving an old version needs to be treated as a breaking,
coordinated migration across every consumer - not a self-contained change
in the CRD-owning repo - with either a real transition window where both
versions serve, or explicit advance coordination with every team whose
manifests reference the version being retired, well before flipping
\`served: false\` on anything actively depended upon.`,
};
