import type { Scenario } from "./types";

export const theAppOfAppsLoop: Scenario = {
  id: "the-app-of-apps-loop",
  title: "The App-of-Apps Loop",
  subtitle: "platform-root and platform-addons keep re-syncing each other in circles",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "app-of-apps", "circular"],
  briefing: `During a platform refactor, "platform-addons" was split out of the
"platform-root" app-of-apps Application into its own top-level app-of-
apps, meant to bootstrap a separate set of optional addon services. Since
then, both Applications have been flapping between Synced and OutOfSync
every few minutes, each one apparently reacting to the other's changes.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-app-of-apps-loop", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/platform-bootstrap.git", targetRevision: "main", path: "root-apps" },
          destination: { server: "https://kubernetes.default.svc", namespace: "argocd" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "OutOfSync", revision: "aa11bb2" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "platform-addons", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/platform-bootstrap.git", targetRevision: "main", path: "addon-apps" },
          destination: { server: "https://kubernetes.default.svc", namespace: "argocd" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "OutOfSync", revision: "cc33dd4" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "app-of-apps-split-notes", namespace: "argocd" },
        spec: {
          data: {
            "root-apps-kustomization.yaml.excerpt":
              "resources:\n  - checkout-app.yaml\n  - billing-app.yaml\n  - metrics-addon-app.yaml   # <- leftover: this addon was meant to move\n                             #    to addon-apps/ during the split, but\n                             #    the entry in root-apps was never removed\n",
            "addon-apps-kustomization.yaml.excerpt":
              "resources:\n  - metrics-addon-app.yaml   # the same file, now also declared here\n  - logging-addon-app.yaml\n",
            "notes.md":
              "Both root-apps and addon-apps declare an Application named\n`metrics-addon` (same name, same destination, same underlying resource).\nplatform-root and platform-addons are two entirely separate app-of-apps\ntrees, each applying its own version of metrics-addon's child\nApplication object with its own tracking-id pointing at a different\nparent. Every reconciliation, whichever parent last applied it 'wins'\nownership of the live object, which the other parent's next\nreconciliation immediately detects as drift and reapplies - producing a\nperpetual flip between the two.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get application metrics-addon -n argocd -o yaml` and check `metadata.annotations` for the ArgoCD tracking-id - does it point at platform-root, platform-addons, or does it keep changing?",
    "`kubectl get configmap app-of-apps-split-notes -n argocd -o yaml` for exactly what the split left behind.",
    "This isn't a genuinely circular dependency between the two root apps - it's two separate app-of-apps trees both declaring ownership of the exact same child Application.",
  ],
  options: [
    {
      id: "leftover-duplicate-child-app-declaration",
      label:
        "The metrics-addon child Application was meant to move from root-apps to addon-apps during the split, but the old entry in root-apps's kustomization.yaml was never removed - so both platform-root and platform-addons now declare and reapply the same child Application, each one's sync overwriting the other's ownership and triggering the next cycle's drift detection.",
      explanation:
        "`app-of-apps-split-notes` shows metrics-addon-app.yaml is listed in *both* root-apps' and addon-apps' kustomization.yaml files - a leftover from an incomplete split. Both platform-root and platform-addons apply their own version of the same-named metrics-addon Application object, each with its own tracking-id; whichever synced most recently 'wins' the object until the other tree's next reconciliation notices the mismatch and reapplies its own version, producing the perpetual flip-flop.",
    },
    {
      id: "genuine-circular-dependency",
      label: "platform-root and platform-addons have a genuine circular dependency on each other via sync waves.",
      explanation:
        "There's no sync-wave or explicit dependency relationship between these two Applications at all - they're two independent app-of-apps trees. The actual conflict is both trees declaring ownership of the same single child Application object, not a wave-ordering cycle between the two root apps themselves.",
    },
    {
      id: "selfheal-fighting-between-roots",
      label: "selfHeal being enabled on both root Applications is inherently incompatible and causes flapping.",
      explanation:
        "selfHeal on two unrelated, non-overlapping app-of-apps trees works fine simultaneously - the problem here isn't selfHeal in general, it's that these two trees aren't actually non-overlapping: they both declare the identical child Application, which is what selfHeal on each one keeps 'correcting' back to its own version.",
    },
    {
      id: "repo-server-serving-stale-revision",
      label: "argocd-repo-server is alternating between serving stale and fresh revisions of the repo to each Application.",
      explanation:
        "Both Applications show real, current, different revisions being synced (not a stale-cache symptom) - the actual conflicting behavior is explained entirely by both kustomization.yaml files independently declaring the same child Application, which is a source-of-truth duplication, not a repo-server caching issue.",
    },
  ],
  correctOptionId: "leftover-duplicate-child-app-declaration",
  resolution: `\`app-of-apps-split-notes\` shows the actual gap: \`metrics-addon-app.yaml\`
is listed under \`resources\` in *both* root-apps' and addon-apps'
kustomization.yaml files. During the split, the addon was correctly added
to the new addon-apps tree, but the original entry in root-apps was never
removed. Both platform-root and platform-addons now independently declare
and apply their own version of the same child Application object
(\`metrics-addon\`), each stamping it with a different tracking-id pointing
at a different parent. Every reconciliation cycle, whichever tree synced
most recently "owns" the live object - until the other tree's own next
reconciliation notices its version no longer matches and reapplies,
flipping ownership back. Repeat forever.

Fix by removing the leftover entry from root-apps, leaving addon-apps as
the single source of truth for this child:

\`\`\`yaml
# root-apps/kustomization.yaml
resources:
  - checkout-app.yaml
  - billing-app.yaml
  # metrics-addon-app.yaml removed - now owned by addon-apps
\`\`\`

Once only one app-of-apps tree declares \`metrics-addon\`, both
platform-root and platform-addons settle into a stable Synced state on
their next reconciliation, with no more ownership flapping. Worth a
quick audit of every other file that moved during the same split, for
the same leftover-declaration pattern.`,
};
