import type { Scenario } from "../types";

export const thePostRendererThatBrokeOutput: Scenario = {
  id: "the-post-renderer-that-broke-output",
  title: "The Post-Renderer That Broke Output",
  subtitle: "settlement-processor's manifests apply fine, but half the pod annotations are just wrong",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "helm", "config-management-plugin"],
  briefing: `"settlement-processor" uses a Helm chart with a Kustomize post-renderer (a
custom CMP that runs "helm template" and pipes the output through
"kustomize build" for final patching). Every sync applies cleanly with no
errors - but a security audit found the pod annotations that are supposed
to enforce a specific seccomp profile are silently missing from every
running pod, even though they're clearly present in both the Helm
templates and the Kustomize patch meant to reinforce them.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-post-renderer-that-broke-output", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/settlement-processor.git",
            targetRevision: "main",
            path: "chart",
            plugin: { name: "helm-kustomize-postrender" },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "settlement" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "d3e4f5a" }, health: { status: "Healthy" } },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "postrender-pipeline-notes", namespace: "settlement" },
        spec: {
          data: {
            "plugin-generate-command.excerpt":
              "helm template . -f values-prod.yaml | kustomize build --load-restrictor LoadRestrictionsNone /dev/stdin\n",
            "seccomp-patch.yaml.excerpt":
              "- op: add\n  path: /spec/template/metadata/annotations/seccomp.security.alpha.kubernetes.io~1pod\n  value: runtime/default\n",
            "notes.md":
              "`kustomize build` cannot take piped stdin as its target directly the\nway this command assumes - it requires a real path to a directory\ncontaining a kustomization.yaml (or, in newer versions, explicit stdin\nsupport that this exact invocation syntax doesn't correctly trigger).\nWhen given `/dev/stdin` as a bare path argument like this, this version\nof kustomize actually DOES accept it and build successfully off of\nwhatever helm printed - but only interprets it as a Kustomize resource\nset if a kustomization.yaml is also piped as part of that same stream,\nwhich it isn't here (only the rendered manifests are piped, no\nkustomization.yaml). Kustomize silently falls back to a bare passthrough\nof the piped resources completely unpatched in this specific edge case\nrather than erroring, because `kustomize build` on a raw resource stream\nwith no kustomization.yaml present is, by its own documented behavior,\na valid (if unusual) no-op case - the command exits 0, ArgoCD sees valid\nYAML output and applies it, and the seccomp patch never actually runs.",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "The sync applies cleanly with exit code 0 and valid manifests - this isn't a crash or error, it's silently wrong output. Run the plugin's exact generate command locally and diff the result against what the seccomp-patch.yaml is supposed to add.",
    "`kubectl get configmap postrender-pipeline-notes -n settlement -o yaml` - read the plugin's generate command and the seccomp patch file, and think carefully about what `kustomize build /dev/stdin` actually needs to work as intended.",
    "A command pipeline that exits 0 and produces syntactically valid YAML can still be silently doing the wrong thing - 'no error' isn't the same as 'did what was intended.'",
  ],
  options: [
    {
      id: "kustomize-build-stdin-no-kustomization-yaml-noop",
      label:
        "The plugin's command pipes helm's rendered output into `kustomize build /dev/stdin`, but a raw resource stream with no accompanying kustomization.yaml is a valid, documented no-op case for kustomize - it exits 0 and passes the manifests through completely unpatched, silently skipping the seccomp annotation patch entirely, rather than erroring in any way ArgoCD or a routine sync would surface.",
      explanation:
        "`postrender-pipeline-notes` explains the exact mechanism: `kustomize build` on a piped resource stream containing no `kustomization.yaml` is documented, valid behavior that passes the input through unmodified rather than failing - so the command exits 0, produces syntactically valid manifests, and ArgoCD applies them successfully, with the seccomp patch from `seccomp-patch.yaml` never actually being invoked at all. Every sync 'succeeding' is consistent with this exact silent-passthrough failure mode, not evidence that the patch is working.",
    },
    {
      id: "seccomp-annotation-key-typo",
      label: "The seccomp annotation's JSON pointer path has a typo in the escaped key name.",
      explanation:
        "The escaped path (`annotations/seccomp.security.alpha.kubernetes.io~1pod`, using `~1` for the required escaped `/` in JSON Patch) is correctly formed - the patch would apply the intended annotation correctly *if it were actually being invoked at all*. The real problem is the patch file never gets processed in the first place, due to how the pipeline is structured.",
    },
    {
      id: "helm-values-disable-seccomp",
      label: "A Helm values setting is disabling the seccomp annotation at the template level.",
      explanation:
        "The seccomp annotation is intentionally applied via the separate Kustomize post-render patch specifically, not through Helm's own templates or values - there's no indication any Helm value is meant to or does control it, and the actual break is in the Kustomize stage of the pipeline never running against the patch file at all.",
    },
    {
      id: "cmp-plugin-not-executing",
      label: "The helm-kustomize-postrender plugin isn't executing at all, and ArgoCD is falling back to raw Helm output.",
      explanation:
        "The plugin genuinely does execute (per the notes, both `helm template` and `kustomize build` run as part of the same piped command and exit 0) - the issue is specifically that the `kustomize build` step, while executing, processes the input as a no-op passthrough because of the missing kustomization.yaml, not that the plugin fails to run at all.",
    },
  ],
  correctOptionId: "kustomize-build-stdin-no-kustomization-yaml-noop",
  resolution: `\`postrender-pipeline-notes\` explains the exact, silent failure mode: the
plugin's generate command pipes Helm's rendered output straight into
\`kustomize build /dev/stdin\`, but a raw resource stream with no
accompanying \`kustomization.yaml\` is a documented, valid no-op case for
kustomize - it passes the input through completely unmodified rather than
erroring. The command exits 0, produces syntactically valid manifests
(because they're just Helm's original output, untouched), and ArgoCD
applies them successfully. \`seccomp-patch.yaml\` - correctly formed, with
a properly escaped JSON pointer path - is never actually invoked at all,
because kustomize never had a kustomization.yaml telling it to apply any
patches in the first place. Every "successful" sync has been silently
skipping the patch the entire time.

Fix by giving kustomize an actual kustomization.yaml to work from,
generated as part of the same pipeline, rather than relying on a bare
resource stream:

\`\`\`bash
#!/bin/sh
set -e
WORKDIR=$(mktemp -d)
helm template . -f values-prod.yaml > "$WORKDIR/rendered.yaml"
cat > "$WORKDIR/kustomization.yaml" <<EOF
resources:
  - rendered.yaml
patches:
  - path: seccomp-patch.yaml
EOF
cp seccomp-patch.yaml "$WORKDIR/"
kustomize build "$WORKDIR"
\`\`\`

With a real kustomization.yaml driving the build, kustomize actually
applies the seccomp patch on the next sync, and the pods finally carry
the intended annotation. Worth a broader lesson here: "the sync succeeded
with no errors" is not sufficient evidence that a multi-stage rendering
pipeline like this actually did what it was supposed to - it's worth
periodically diffing what a plugin's command actually produces locally
against what's expected, independent of whether ArgoCD reports success.`,
};
