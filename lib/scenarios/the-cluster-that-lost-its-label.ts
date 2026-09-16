import type { Scenario } from "./types";

export const theClusterThatLostItsLabel: Scenario = {
  id: "the-cluster-that-lost-its-label",
  title: "The Cluster That Lost Its Label",
  subtitle: "every Application on the APAC cluster vanished within the same minute",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "applicationset", "cluster-generator"],
  briefing: `Twenty minutes ago, every single Application generated for the "apac-prod"
cluster by the "regional-rollout" ApplicationSet disappeared simultaneously
- not failed, not OutOfSync, just gone, along with (since prune defaults
apply on ApplicationSet-managed deletion) every workload they managed.
The cluster itself is still registered, reachable, and shows up fine in
"argocd cluster list".`,
  constraints: [
    "Treat this as a live incident: workloads on apac-prod are currently down. Prioritize restoring service, and separately explain the mechanism.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "regional-rollout", namespace: "argocd" },
        spec: {
          generators: [
            {
              clusters: {
                selector: { matchLabels: { region: "apac", tier: "prod" } },
              },
            },
          ],
          template: {
            metadata: { name: "{{name}}-regional" },
            spec: {
              source: { repoURL: "https://github.com/example/regional-services.git", targetRevision: "main", path: "manifests" },
              destination: { server: "{{server}}", namespace: "regional-services" },
            },
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "apac-prod-cluster",
          namespace: "argocd",
          labels: { "argocd.argoproj.io/secret-type": "cluster", region: "apac" },
        },
        spec: { data: { name: "apac-prod", server: "https://apac-prod.example.com:6443" } },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "label-removal-incident-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "Audit log for the apac-prod-cluster Secret shows a label PATCH 22\nminutes ago that removed the `tier: prod` label - performed by a\nservice account belonging to an unrelated cost-tagging automation job\nthat runs cluster-wide, reconciling a DIFFERENT labeling schema\n(cost-center tags) against every Secret of type 'cluster'. That\nautomation's own reconciliation logic does a full label-set replace\n(not a merge/patch of only its own keys) against each cluster secret it\ntouches, based on a source-of-truth list that, for apac-prod\nspecifically, was missing the `tier: prod` label entirely in ITS OWN\nrecords (a separate, unrelated data quality gap in the cost-tagging\nsystem) - so its 'correct' full replacement inadvertently dropped a\nlabel it didn't know it needed to preserve. The moment `tier: prod`\ndisappeared, the ApplicationSet's cluster generator selector\n(`matchLabels: {region: apac, tier: prod}`) stopped matching\napac-prod-cluster at all, and ApplicationSet's default behavior for a\ncluster generator match disappearing is to prune every Application it\npreviously generated for that cluster - cascading the deletion down to\nevery live workload those Applications managed.",
          },
        },
        age: "22m",
      },
    ],
  },
  hints: [
    "`kubectl get secret apac-prod-cluster -n argocd --show-labels` - does it still carry every label the ApplicationSet's cluster generator selector requires?",
    "Check the Secret's audit/event history for any recent label changes - `kubectl get configmap label-removal-incident-notes -n argocd -o yaml` names exactly what happened and why.",
    "An ApplicationSet's cluster generator treats a cluster falling out of its selector's match the same as the cluster being deregistered entirely - by default, it prunes every Application it previously generated for that match.",
  ],
  options: [
    {
      id: "unrelated-automation-full-replace-dropped-required-label",
      label:
        "An unrelated cost-tagging automation job did a full label-set replace against every cluster Secret (rather than merging just its own keys), and because its own source-of-truth data was missing an entry for apac-prod's tier label, that replace inadvertently dropped the tier: prod label the ApplicationSet's cluster generator selector required - the cluster silently fell out of the selector's match, and the ApplicationSet's default prune-on-unmatch behavior cascaded the deletion down to every Application and workload it had generated.",
      explanation:
        "`label-removal-incident-notes` traces the exact chain: a full label-replace (not a scoped patch) from an unrelated automation, driven by that automation's own incomplete source-of-truth data, dropped `tier: prod` from the cluster secret. The ApplicationSet's selector requires both `region: apac` and `tier: prod` together - losing either one drops the match entirely, and the ApplicationSet controller's default behavior for a cluster generator match disappearing is to prune every Application it previously generated for it, explaining the simultaneous, total, cascading loss.",
    },
    {
      id: "apac-cluster-connectivity-lost",
      label: "ArgoCD lost network connectivity to the apac-prod cluster.",
      explanation:
        "`argocd cluster list` confirms the cluster is still registered and reachable - if connectivity were lost, Applications would show a connection error or Unknown status, not simply cease to exist. Applications actually being deleted (not merely failing to sync) points at a generator no longer matching the cluster, not a reachability problem.",
    },
    {
      id: "someone-deleted-applicationset",
      label: "The regional-rollout ApplicationSet itself was accidentally deleted and recreated.",
      explanation:
        "The ApplicationSet resource itself is present and correctly configured - it's still actively generating Applications for every *other* matching cluster normally. The issue is specific to apac-prod-cluster no longer matching its selector, not the ApplicationSet being deleted or reset.",
    },
    {
      id: "appproject-blocked-apac-destination",
      label: "The AppProject started blocking the apac-prod cluster as a valid destination.",
      explanation:
        "An AppProject destination restriction would cause newly-attempted Applications to fail with an InvalidSpecError, not cause existing, already-running Applications to be actively deleted - the audit trail points specifically at the ApplicationSet's own generator match disappearing and triggering its default prune-on-unmatch behavior.",
    },
  ],
  correctOptionId: "unrelated-automation-full-replace-dropped-required-label",
  resolution: `\`label-removal-incident-notes\` traces the full chain: an unrelated,
cluster-wide cost-tagging automation job did a full label-set *replace*
(not a scoped merge of only its own keys) against every cluster Secret,
including \`apac-prod-cluster\`. Its own source-of-truth data happened to
be missing an entry for this cluster's \`tier: prod\` label, so its
"correct" replacement inadvertently dropped a label it had no idea it
needed to preserve. The ApplicationSet's cluster generator selector
requires \`region: apac\` AND \`tier: prod\` together - losing either one
drops the match entirely. The moment that happened, every Application
this ApplicationSet had generated for apac-prod fell out of its
generator's result set, and the ApplicationSet controller's default
behavior for that situation is to prune them - cascading the deletion
down to every live workload they managed, all within the same
reconciliation pass.

Immediate fix: restore the missing label so the cluster matches the
selector again, which lets the ApplicationSet regenerate every
Application on its next reconciliation:

\`\`\`
kubectl label secret apac-prod-cluster -n argocd tier=prod --overwrite
\`\`\`

The ApplicationSet then regenerates every previously-deleted Application
automatically, and their automated sync (if selfHeal was on) restores the
workloads. This is a fast, largely self-healing recovery once the label
is back - but it's worth verifying nothing downstream (a database
migration, a stateful workload) was harmed by the brief total absence
before declaring the incident closed.

Longer term: this is a strong argument for two separate fixes on the
automation side - having the cost-tagging job merge/patch only its own
label keys instead of doing a full replace, and fixing its source-of-
truth data gap for apac-prod specifically. On the ArgoCD side, it's also
worth reconsidering whether a cluster generator's default prune-on-
unmatch behavior is the right choice for regions this critical -
\`preserveResourcesOnDeletion: true\` on the ApplicationSet's syncPolicy
would have left the workloads running (orphaned but intact) instead of
cascading a full deletion the instant an unrelated system's label change
caused a momentary selector mismatch.`,
};
