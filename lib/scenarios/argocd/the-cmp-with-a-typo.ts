import type { Scenario } from "../types";

export const theCmpWithATypo: Scenario = {
  id: "the-cmp-with-a-typo",
  title: "The CMP With a Typo",
  subtitle: "risk-scoring-service's Application can't find its own plugin",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "config-management-plugin", "cmp"],
  briefing: `"risk-scoring-service" uses a custom Config Management Plugin to render
its manifests through a small templating tool. It's synced this way for
almost a year - until this week's ArgoCD version upgrade, after which the
Application fails comparison immediately, claiming the plugin doesn't
exist at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-cmp-with-a-typo", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/risk-scoring-service.git",
            targetRevision: "main",
            path: "manifests",
            plugin: { name: "risk-templater-v1" },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "risk-scoring" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            { type: "ComparisonError", message: "Unable to load plugin \"risk-templater-v1\": no matching plugin found" },
          ],
        },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cmp-upgrade-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "Before this week's ArgoCD upgrade, config management plugins were\nregistered via a legacy `argocd-cm` ConfigMap entry\n(`configManagementPlugins`), and this plugin's registered name there\nwas `risk-templater-v1`. The version upgraded to *removes support* for\nthat legacy registration method entirely (a documented breaking change\nin this release's upgrade notes) - CMPs must now be registered as\nsidecar containers on argocd-repo-server with their own\nConfigManagementPlugin manifest. The platform team did migrate this\nplugin to a sidecar during the upgrade - but named the new\nConfigManagementPlugin resource `risk-scoring-templater` instead of\nkeeping the original name `risk-templater-v1`, and nobody updated the\nApplication's own `spec.source.plugin.name` to match the new name.",
          },
        },
        age: "40m",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-cmp-with-a-typo -n argocd` - the error is about the plugin not being *found*, not a plugin execution failure.",
    "`kubectl get configmap cmp-upgrade-notes -n argocd -o yaml` for what changed about how plugins are registered in this ArgoCD version.",
    "Check the actual name of the ConfigManagementPlugin resource registered as a sidecar now, versus the name the Application's `spec.source.plugin.name` still references.",
  ],
  options: [
    {
      id: "plugin-renamed-during-sidecar-migration-not-updated",
      label:
        "This week's ArgoCD upgrade removed support for the old ConfigMap-based plugin registration entirely, and the plugin was migrated to the new sidecar-based ConfigManagementPlugin approach as part of that upgrade - but it was renamed in the process, and the Application's spec.source.plugin.name still references the old name, so ArgoCD can no longer find a plugin registered under it.",
      explanation:
        "`cmp-upgrade-notes` confirms this version removed the legacy ConfigMap-based CMP registration entirely (a documented breaking change), and the plugin was correctly migrated to the new sidecar approach - but renamed from `risk-templater-v1` to `risk-scoring-templater` in the process, without updating the Application's own `spec.source.plugin.name`, which still says `risk-templater-v1`. The error - 'no matching plugin found' for exactly that old name - matches precisely.",
    },
    {
      id: "repo-server-sidecar-not-deployed",
      label: "The plugin's sidecar container was never actually deployed onto argocd-repo-server.",
      explanation:
        "The notes confirm the plugin genuinely was migrated to a sidecar as part of the upgrade - it does exist and is registered, just under a different name than the Application references. If the sidecar itself were missing entirely, this would still be the right general direction, but the actual documented cause here is a naming mismatch, not a missing deployment.",
    },
    {
      id: "plugin-version-incompatible-upgrade",
      label: "The plugin itself is incompatible with the new ArgoCD version and needs to be rewritten.",
      explanation:
        "There's no indication the plugin's own logic or execution is incompatible - the error occurs at the plugin *lookup* stage ('no matching plugin found'), before ArgoCD would ever attempt to run the plugin's generate command and potentially hit a compatibility issue in its actual logic.",
    },
    {
      id: "appproject-blocks-plugin-cmp",
      label: "The AppProject doesn't permit this Application to use a config management plugin.",
      explanation:
        "An AppProject-level plugin restriction would produce an InvalidSpecError-style condition naming the project policy, not a 'no matching plugin found' error - this error is specifically about ArgoCD's plugin registry not having an entry under the referenced name, which is a naming/registration issue, not a policy restriction.",
    },
  ],
  correctOptionId: "plugin-renamed-during-sidecar-migration-not-updated",
  resolution: `\`cmp-upgrade-notes\` confirms the mechanism: this week's ArgoCD upgrade
removed support for the legacy ConfigMap-based plugin registration
entirely, a documented breaking change in that release. The platform team
did correctly migrate the plugin to the new sidecar-based
ConfigManagementPlugin approach during the upgrade - but named the new
resource \`risk-scoring-templater\` rather than keeping the original
\`risk-templater-v1\`, and nobody updated this Application's
\`spec.source.plugin.name\`, which still references the old name. ArgoCD's
plugin lookup correctly reports it can't find a plugin registered under
that name - because, post-migration, nothing is registered under it
anymore.

Fix by updating the Application to reference the plugin's actual current
name:

\`\`\`yaml
spec:
  source:
    plugin:
      name: risk-scoring-templater
\`\`\`

Once the name matches, ArgoCD's next comparison finds and runs the
sidecar-based plugin correctly. Worth a quick audit of every other
Application that was using a CMP before this upgrade - any of them
referencing a plugin name that changed during the same sidecar migration
will hit the identical "no matching plugin found" error the moment
someone gets around to re-syncing them.`,
};
