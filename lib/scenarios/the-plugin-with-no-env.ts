import type { Scenario } from "./types";

export const thePluginWithNoEnv: Scenario = {
  id: "the-plugin-with-no-env",
  title: "The Plugin With No Env",
  subtitle: "pricing-calculator renders manifests full of empty placeholder strings",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 15,
  tags: ["argocd", "config-management-plugin", "cmp"],
  briefing: `"pricing-calculator" uses a custom Config Management Plugin (CMP) that
runs a small templating script over the manifests before ArgoCD applies
them. After today's sync, every manifest that should reference the
current region got rendered with a literal empty string instead - the
Deployment's env vars, labels, everything that should say "us-east-1"
just says nothing.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-plugin-with-no-env", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/pricing-calculator.git",
            targetRevision: "main",
            path: "manifests",
            plugin: { name: "region-templater" },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "pricing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "7a6b5c4" }, health: { status: "Healthy" } },
        age: "35m",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-calculator", namespace: "pricing", labels: { region: "" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "app", env: [{ name: "REGION", value: "" }] }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "35m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cmp-plugin-notes", namespace: "argocd" },
        spec: {
          data: {
            "plugin.yaml.excerpt":
              "apiVersion: argoproj.io/v1alpha1\nkind: ConfigManagementPlugin\nmetadata:\n  name: region-templater\nspec:\n  generate:\n    command: [\"sh\", \"-c\"]\n    args: [\"envsubst < deployment.yaml.tpl\"]\n",
            "notes.md":
              "The `region-templater` plugin runs `envsubst`, which substitutes\n`${REGION}` in the template with the value of the REGION environment\nvariable *in the plugin sidecar container's own environment* at render\ntime - not from anything in the Application's manifests. The plugin\nsidecar's container spec (in the ArgoCD repo-server Deployment) has no\n`env` section defined at all, so REGION is unset inside the sidecar, and\nenvsubst substitutes it with an empty string, exactly matching what's\nrendered into every manifest.",
          },
        },
        age: "35m",
      },
    ],
  },
  hints: [
    "`kubectl get deployment pricing-calculator -n pricing -o yaml` - the REGION env var and region label are both present but empty, not missing entirely. That's a substitution artifact, not a template structure problem.",
    "`kubectl get configmap cmp-plugin-notes -n argocd -o yaml` - read what the plugin's `generate` command actually does and where it gets its input values from.",
    "envsubst-style templating pulls values from the *environment the templating process runs in* - check whether that environment (the plugin sidecar container) actually has REGION set anywhere.",
  ],
  options: [
    {
      id: "plugin-sidecar-missing-region-env",
      label:
        "The region-templater CMP runs envsubst, which substitutes `${REGION}` from the environment of the sidecar container it runs in - but that sidecar's container spec has no env vars configured at all, so REGION is unset during rendering and envsubst quietly substitutes an empty string everywhere.",
      explanation:
        "`cmp-plugin-notes` shows the plugin's generate command is a plain `envsubst`, which reads substitution values from its own process environment - not from anything declared in the Application's manifests. The plugin sidecar container has no `env` section defined at all, so `${REGION}` has nothing to substitute with, and envsubst's documented behavior for an unset variable is to substitute an empty string - exactly matching the rendered Deployment's blank env var and label.",
    },
    {
      id: "template-file-missing-placeholder",
      label: "The deployment.yaml.tpl template file is missing the ${REGION} placeholder entirely.",
      explanation:
        "If the placeholder were missing from the template, the rendered output would contain a literal, unmodified string like the word REGION or nothing related to it at all - not a clean empty string exactly where a substituted value would go. An empty string is the signature of envsubst substituting an *unset* variable, not a missing placeholder.",
    },
    {
      id: "appproject-blocks-plugin",
      label: "The AppProject doesn't allow this Application to use a config management plugin.",
      explanation:
        "If the plugin were blocked at the AppProject level, the Application would fail comparison entirely with an InvalidSpecError-style condition, rather than successfully rendering manifests (just with empty substituted values) and reaching a clean Synced status.",
    },
    {
      id: "repo-server-plugin-not-registered",
      label: "The region-templater plugin isn't registered with argocd-repo-server at all.",
      explanation:
        "If the plugin weren't registered, ArgoCD would fail to find a plugin matching `spec.source.plugin.name` and report a clear comparison error naming the missing plugin - it wouldn't successfully run a different, unrelated rendering path that happens to produce blank values.",
    },
  ],
  correctOptionId: "plugin-sidecar-missing-region-env",
  resolution: `\`cmp-plugin-notes\` shows the \`region-templater\` plugin's \`generate\`
command is just \`envsubst < deployment.yaml.tpl\` - a standard tool that
substitutes \`${'${VAR}'}\`-style placeholders using the *environment
variables of the process running it*, not anything read from the
Application's own spec or git manifests. The plugin sidecar container (a
separate container running alongside argocd-repo-server, per ArgoCD's CMP
architecture) has no \`env\` section configured at all - so when
\`envsubst\` looks for \`REGION\`, it finds nothing set, and per its
documented behavior for unset variables, substitutes an empty string
everywhere the placeholder appears. That's exactly the blank env var and
label rendered into the Deployment.

Fix by giving the plugin sidecar the environment it needs to actually
template correctly:

\`\`\`yaml
# argocd-repo-server Deployment, plugin sidecar container
- name: region-templater
  env:
    - name: REGION
      value: us-east-1
\`\`\`

(For a plugin meant to vary per-Application rather than being fixed
per-repo-server-deployment, ArgoCD CMPs also support reading parameters
from the Application's own \`spec.source.plugin.env\` - worth considering
if different Applications using this same plugin need different region
values.) Once the sidecar actually has \`REGION\` set, the next sync
re-renders with the real value substituted in.`,
};
