import type { Scenario } from "./types";

export const theResourceExclusionNobodyRemembered: Scenario = {
  id: "the-resource-exclusion-nobody-remembered",
  title: "The Resource Exclusion Nobody Remembered",
  subtitle: "a rogue CronJob has been running unmanaged in prod for who knows how long",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "resource-exclusions", "security"],
  briefing: `A security scan flagged a CronJob, "legacy-data-export", running in the
"analytics" namespace with an overly broad ServiceAccount and no
corresponding entry anywhere in any team's GitOps repo. Nobody can
explain how it got there, and more worryingly, it doesn't show up in any
ArgoCD Application's resource list at all - not even as an "unmanaged
resource" warning, which is unusual, since the "analytics" namespace is
otherwise fully GitOps-managed.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "legacy-data-export", namespace: "analytics" },
        spec: { schedule: "0 3 * * *" },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "resource-exclusions-audit-notes", namespace: "argocd" },
        spec: {
          data: {
            "argocd-cm.excerpt":
              "resource.exclusions: |\n  - apiGroups:\n      - batch\n    kinds:\n      - CronJob\n    clusters:\n      - \"*\"\n",
            "notes.md":
              "This cluster-wide resource.exclusions rule excludes EVERY CronJob, in\nevery namespace, from ArgoCD's reconciliation and comparison entirely -\ngit blame shows it was added 10 months ago by a former team member, with\na commit message reading only 'temp fix for CronJob noise', during an\nincident where a different, now-fixed CronJob's frequently-changing\n`status.lastScheduleTime` field was causing constant OutOfSync flapping\n(the same class of issue documented elsewhere as fixed via a proper\nignoreDifferences entry on that one specific CronJob, rather than a\nblanket kind-wide exclusion). The 'temp fix' was never reverted, and\nsince ArgoCD's orphaned-resources warning explicitly only evaluates\nresource kinds that aren't excluded, CronJobs excluded this way don't\ngenerate orphaned-resource warnings either - they're not just unmanaged,\nthey're functionally invisible to ArgoCD's tooling entirely, which is\nexactly how legacy-data-export was able to exist, unmanaged and\nunflagged, for potentially the full 8 months since it was created.",
          },
        },
        age: "10mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap argocd-cm -n argocd -o yaml` and check `resource.exclusions` for anything covering CronJobs broadly, not scoped to a specific one.",
    "ArgoCD's orphaned-resources warning only evaluates resource kinds it's actually configured to look at - a kind excluded entirely doesn't generate warnings for unmanaged instances of it either.",
    "`kubectl get configmap resource-exclusions-audit-notes -n argocd -o yaml` for the git history behind this exclusion and why it was originally added.",
  ],
  options: [
    {
      id: "blanket-cronjob-exclusion-hides-everything",
      label:
        "A cluster-wide resource.exclusions rule excludes every CronJob, in every namespace, from ArgoCD's reconciliation entirely - added 10 months ago as an unreverted 'temp fix' for a since-resolved status-flapping issue on a different CronJob - which means CronJobs are also invisible to the orphaned-resources warning, letting an unmanaged CronJob like legacy-data-export exist, undetected by any ArgoCD tooling, for however long it's actually been there.",
      explanation:
        "`resource-exclusions-audit-notes` confirms the exclusion covers the entire CronJob kind cluster-wide, was meant as a temporary fix for a narrower, now-resolved problem, and was never reverted. Since orphaned-resources warnings only evaluate kinds ArgoCD is actually configured to look at, an excluded kind produces no warning for an unmanaged instance either - which is exactly why legacy-data-export was able to exist completely off ArgoCD's radar, invisible to both normal comparison and the orphaned-resources safety net that would otherwise have flagged it.",
    },
    {
      id: "cronjob-created-in-excluded-namespace",
      label: "The analytics namespace itself is excluded from ArgoCD entirely.",
      explanation:
        "The rest of the analytics namespace is confirmed to be fully GitOps-managed and visible to ArgoCD as normal - the exclusion is specifically scoped to the CronJob *kind* cluster-wide, not to this namespace as a whole, which is why every other resource type in analytics is properly tracked and managed.",
    },
    {
      id: "rbac-allowed-unauthorized-creation",
      label: "An RBAC gap let someone create this CronJob without any ArgoCD involvement, which is the real issue to fix.",
      explanation:
        "How the CronJob was originally created (RBAC gaps allowing manual creation) is a real, separate security question worth investigating - but it doesn't explain why ArgoCD's own tooling never flagged its existence as an unmanaged resource, which is squarely explained by the blanket kind-wide exclusion making CronJobs invisible to that detection mechanism entirely.",
    },
    {
      id: "appproject-namespaced-resource-blacklist",
      label: "The AppProject's namespacedResourceBlacklist is hiding this CronJob from the relevant Application.",
      explanation:
        "A per-project namespacedResourceBlacklist would only affect Applications scoped to that specific project, not ArgoCD's cluster-wide orphaned-resources detection or comparison generally - the actual mechanism here is a cluster-wide `resource.exclusions` entry in `argocd-cm`, which is a different, broader-reaching setting entirely.",
    },
  ],
  correctOptionId: "blanket-cronjob-exclusion-hides-everything",
  resolution: `\`resource-exclusions-audit-notes\` traces the root cause: \`argocd-cm\`'s
\`resource.exclusions\` has a rule excluding the entire CronJob kind,
cluster-wide, in every namespace - added 10 months ago as an unreverted
"temp fix" for a narrower, unrelated problem (one specific CronJob's
frequently-changing \`status.lastScheduleTime\` causing OutOfSync
flapping, which has its own proper, scoped fix documented elsewhere via
\`ignoreDifferences\`). Because ArgoCD's orphaned-resources detection only
evaluates kinds it's actually configured to compare, a kind excluded this
broadly is also invisible to that safety net - not just unmanaged by any
Application, but genuinely undetectable by any of ArgoCD's own tooling.
That's exactly the gap that let \`legacy-data-export\` exist, unflagged,
for as long as it has.

Fix in two parts. First, narrow the exclusion down to the original,
specific problem it was meant to solve, rather than the entire kind:

\`\`\`yaml
# argocd-cm - remove the blanket batch/CronJob exclusion entirely,
# and rely on the properly-scoped ignoreDifferences already in place
# on the one Application that originally needed it
\`\`\`

Second, once CronJobs are visible to ArgoCD's tooling again, run a
cluster-wide orphaned-resources check to catch \`legacy-data-export\` and
anything else that may have accumulated in the same blind spot over the
last 10 months, then investigate and remediate each one on its own merits
(bring it into GitOps if legitimate, remove it if not, per this
CronJob's overly-broad ServiceAccount flagged by the security scan). This
incident is also a good argument for periodically auditing
\`resource.exclusions\` itself - a broad, unscoped exclusion added as a
"temporary" fix for a narrow problem is exactly the kind of change that's
easy to forget existed at all.`,
};
