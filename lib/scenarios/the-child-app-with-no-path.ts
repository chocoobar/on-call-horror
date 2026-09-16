import type { Scenario } from "./types";

export const theChildAppWithNoPath: Scenario = {
  id: "the-child-app-with-no-path",
  title: "The Child App With No Path",
  subtitle: "the app-of-apps root is Synced but one whole service was never deployed",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "app-of-apps", "bootstrap"],
  briefing: `The platform team uses an app-of-apps root Application to bootstrap every
service's own child Application. A new service, "webhook-relay", was
added to the root's list a week ago during onboarding - the root
Application shows Synced, but "webhook-relay" itself was never actually
created anywhere, and nobody can find it in "kubectl get applications".`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-child-app-with-no-path", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/platform-bootstrap.git", targetRevision: "main", path: "root-apps" },
          destination: { server: "https://kubernetes.default.svc", namespace: "argocd" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "1a2b3c4" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "root-apps-listing", namespace: "argocd" },
        spec: {
          data: {
            "root-apps/webhook-relay-app.yml":
              "# Note the extension: this file is named .yml, while every other\n# child Application manifest in this directory (checkout-app.yaml,\n# billing-app.yaml, etc.) uses .yaml. The root Application's own source\n# is a plain git directory source with no glob restriction specified\n# beyond the default, which normally picks up any recognized manifest\n# file in the directory regardless of the .yaml/.yml distinction -\n# EXCEPT this repo's root-apps directory has a committed\n# kustomization.yaml that explicitly lists each child file by exact\n# name under `resources:`, and whoever added webhook-relay-app.yml\n# copy-pasted an entry for a `.yaml` file and never updated the\n# extension in the copy, so the list still says\n# 'webhook-relay-app.yaml' - a file that doesn't exist.",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "`kubectl get application the-child-app-with-no-path -n argocd -o yaml` - check what `spec.source.path` (root-apps) actually contains and how it's structured (plain directory, or does it use Kustomize?).",
    "`kubectl get configmap root-apps-listing -n argocd -o yaml` for the actual file listing in that directory, including exact filenames.",
    "If the root-apps directory has its own kustomization.yaml, it explicitly enumerates which files to include - a typo in that list (even just a wrong file extension) means the file is silently skipped, with no error.",
  ],
  options: [
    {
      id: "kustomization-lists-wrong-extension",
      label:
        "The root-apps directory has a kustomization.yaml that explicitly lists every child Application file by exact name, and the entry for webhook-relay was copy-pasted with the wrong file extension (.yaml instead of the actual .yml file) - so Kustomize silently skips a file that doesn't exist under that name, and webhook-relay's Application was never created.",
      explanation:
        "`root-apps-listing` shows the actual committed file is `webhook-relay-app.yml`, while the root's kustomization.yaml resources list (per the note) still references `webhook-relay-app.yaml` from a copy-paste of another entry. Since the kustomization.yaml explicitly enumerates files rather than picking up everything in the directory, a name that doesn't match anything on disk is simply never included in the render - Kustomize doesn't error on this the way a missing `resources: [../../base]` reference would if the path were wildly wrong, it just quietly produces one fewer manifest.",
    },
    {
      id: "child-project-blocks-it",
      label: "The AppProject for webhook-relay's own child Application blocks its destination namespace.",
      explanation:
        "An AppProject restriction would only come into play once the child Application object actually exists and attempts to sync - here the child Application was never even created in the first place, so there's no InvalidSpecError condition to find on anything, because there's no Application object at all.",
    },
    {
      id: "root-sync-wave-too-early",
      label: "webhook-relay's sync-wave places it before the root Application itself, so it can't be created yet.",
      explanation:
        "Sync waves order resources *within* a single sync operation of one Application - they don't govern whether an app-of-apps root even attempts to render/include a given child manifest file in the first place. The issue here is the file never being included in the render at all, not an ordering problem between an already-included child and its root.",
    },
    {
      id: "repo-server-timeout-child-app",
      label: "argocd-repo-server timed out generating manifests for the root Application.",
      explanation:
        "The root Application itself reports a clean Synced status with no comparison errors or timeouts - if generation had timed out, the whole root Application would show a failed/unknown state, not a clean sync that's simply missing one specific child due to a naming mismatch.",
    },
  ],
  correctOptionId: "kustomization-lists-wrong-extension",
  resolution: `\`root-apps-listing\` shows the actual committed child manifest file is
named \`webhook-relay-app.yml\`, but the root-apps directory's own
kustomization.yaml - which explicitly enumerates every child file under
\`resources:\` rather than picking up everything in the directory
automatically - still lists \`webhook-relay-app.yaml\`, almost certainly
from copy-pasting another entry's line and forgetting to fix the
extension. Kustomize simply can't include a file by a name that doesn't
exist; it doesn't error loudly on a listed-but-missing resource entry the
way it would on a badly malformed base reference, it just fails that one
resource silently while the rest of the kustomization renders fine -
which is exactly why the root Application still shows a clean Synced
status.

Fix by correcting the filename in the list:

\`\`\`yaml
# root-apps/kustomization.yaml
resources:
  - checkout-app.yaml
  - billing-app.yaml
  - webhook-relay-app.yml   # corrected extension
\`\`\`

On the root Application's next sync, the webhook-relay child Application
is finally created and begins its own independent sync. Worth a quick
scan of the rest of the kustomization.yaml's resources list against the
actual directory contents (\`ls root-apps/\`) to catch any other silent
mismatches the same way.`,
};
