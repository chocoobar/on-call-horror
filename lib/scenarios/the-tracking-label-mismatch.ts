import type { Scenario } from "./types";

export const theTrackingLabelMismatch: Scenario = {
  id: "the-tracking-label-mismatch",
  title: "The Tracking Label Mismatch",
  subtitle: "two Applications, one Deployment, and a prune that took the wrong side",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "resource-tracking", "annotation-tracking"],
  briefing: `The platform switched the whole cluster from label-based to
annotation-based resource tracking last month, for better resilience
against label conflicts. Ever since, "content-moderation-api" has been
strange: it reports Synced, but every so often a pruning sync deletes a
resource that then has to be manually recreated, and the same resource
gets pruned again a few syncs later.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-tracking-label-mismatch", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/content-moderation-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "moderation" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced" }, health: { status: "Healthy" } },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "moderation-rules", namespace: "moderation" },
        spec: { data: { "rules.yaml": "block_threshold: 0.85" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tracking-migration-notes", namespace: "moderation" },
        spec: {
          data: {
            "notes.md":
              "`argocd-cm`'s `application.resourceTrackingMethod` was changed from\n`label` to `annotation` cluster-wide last month. This changes how NEW\napplies stamp tracking info (via the\n`argocd.argoproj.io/tracking-id` annotation instead of the\n`app.kubernetes.io/instance` label going forward) - but it does not\nretroactively rewrite tracking info already stamped on existing live\nresources from before the switch. moderation-rules ConfigMap still only\ncarries the OLD label-based tracking (`app.kubernetes.io/instance:\ncontent-moderation-api`) from before the migration, with no\ntracking-id annotation at all, because it hasn't been touched by a\nfresh apply since the switch (it hasn't changed in git in over a year).\nWith `resourceTrackingMethod: annotation` now active cluster-wide,\nArgoCD's ownership check for this resource looks for the annotation,\ndoesn't find it, concludes the resource looks unowned/untracked by\ncurrent policy, and (with prune enabled) treats it as prune-eligible on\nsyncs where its detection logic re-evaluates ownership - selfHeal then\nrecreates it on the following sync since it's still declared in git,\nrestarting the cycle.",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap moderation-rules -n moderation -o yaml --show-labels` and check its annotations too - does it have the new `argocd.argoproj.io/tracking-id` annotation the cluster now expects?",
    "`kubectl get configmap argocd-cm -n argocd -o yaml` and check `application.resourceTrackingMethod` - when was it changed, and does that change retroactively update resources already stamped under the old method?",
    "`kubectl get configmap tracking-migration-notes -n moderation -o yaml` for the exact mechanism of this migration gap.",
  ],
  options: [
    {
      id: "resource-never-restamped-after-tracking-method-switch",
      label:
        "Switching resourceTrackingMethod from label to annotation cluster-wide changes how new applies stamp ownership going forward, but doesn't retroactively restamp existing live resources - a ConfigMap that hasn't changed in git (and so hasn't been freshly applied) since before the switch still only carries the old label-based tracking, so ArgoCD's annotation-based ownership check periodically concludes it's untracked and prunes it, then selfHeal recreates it since it's still declared in git, repeating the cycle.",
      explanation:
        "`tracking-migration-notes` explains this precisely: the tracking method switch changes stamping behavior for new applies only, and `moderation-rules` hasn't been freshly applied (its git content hasn't changed) since before the switch - so it's stuck with only the old label-based tracking info. With annotation-based tracking now the cluster's active policy, ArgoCD's ownership evaluation for this specific resource doesn't find the expected tracking-id annotation, treats it as prune-eligible on syncs where ownership gets re-evaluated, and selfHeal recreates it on the next sync since it's still genuinely declared in git - producing exactly the repeated prune/recreate cycle described.",
    },
    {
      id: "two-applications-both-declare-configmap",
      label: "A second Application also declares this same ConfigMap, and they're fighting over it.",
      explanation:
        "There's only one Application declaring `moderation-rules` here - the notes trace the prune/recreate cycle entirely to a tracking-method transition gap on a single resource under a single Application's ownership, not a cross-Application conflict over the same declared resource.",
    },
    {
      id: "configmap-immutable-recreate-loop",
      label: "The ConfigMap has an immutable flag, forcing ArgoCD to delete and recreate it on every change.",
      explanation:
        "There's no `immutable` field on this ConfigMap, and more importantly its contents haven't actually changed in git in over a year - an immutable-field recreate cycle would be driven by genuine content changes requiring replacement, not by an ownership-detection gap from a tracking method migration.",
    },
    {
      id: "prune-policy-flapping-random",
      label: "ArgoCD's prune evaluation is simply flaky/non-deterministic for this Application.",
      explanation:
        "The behavior isn't random - it's fully explained by a specific, identifiable gap: a resource stamped under the old tracking method not being recognized under the newly-active tracking method. It happens consistently for resources that were never re-applied since the migration, not unpredictably across the board.",
    },
  ],
  correctOptionId: "resource-never-restamped-after-tracking-method-switch",
  resolution: `\`tracking-migration-notes\` lays out the exact gap: switching
\`application.resourceTrackingMethod\` from \`label\` to \`annotation\`
cluster-wide changes how *new* applies stamp ownership - it doesn't
retroactively rewrite tracking info already stamped on resources from
before the switch. \`moderation-rules\` hasn't changed in git in over a
year, so it hasn't been freshly applied since the migration and still
only carries the old \`app.kubernetes.io/instance\` label, with no
\`argocd.argoproj.io/tracking-id\` annotation at all. With annotation-based
tracking now active, ArgoCD's ownership check for this resource doesn't
find what it's now looking for, periodically concludes the resource looks
untracked, and (with prune on) removes it - only for selfHeal to recreate
it on the next sync since it's still genuinely declared in git, and the
cycle repeats.

The fix is forcing a fresh apply of every resource that hasn't changed
since the migration, so it gets restamped under the new tracking method -
a targeted hard refresh does this without requiring an actual manifest
change:

\`\`\`
argocd app sync the-tracking-label-mismatch --force
\`\`\`

(A \`--force\` sync bypasses ArgoCD's diff-based skip-if-unchanged
optimization and re-applies every resource, restamping tracking info
under the currently active method.) After this, worth doing the same
across every other Application in the cluster with resources that
haven't changed since the tracking-method migration - any of them are
sitting on the same latent prune/recreate risk until they're freshly
applied at least once under the new method.`,
};
