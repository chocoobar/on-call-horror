import type { Scenario } from "./types";

export const thePluginSidecarThatCrashed: Scenario = {
  id: "the-plugin-sidecar-that-crashed",
  title: "The Plugin Sidecar That Crashed",
  subtitle: "one Application out of dozens using the same plugin can never compare successfully",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "config-management-plugin", "repo-server"],
  briefing: `Dozens of Applications share the same "ytt-renderer" Config Management
Plugin sidecar on argocd-repo-server. All but one work fine.
"warehouse-slotting"'s Application has failed comparison for two days
with a generic "plugin generate command failed" error - the on-call
engineer confirmed the plugin sidecar container itself is healthy and
running, and every other Application using the exact same plugin
continues to sync normally the entire time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-plugin-sidecar-that-crashed", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/warehouse-slotting.git",
            targetRevision: "main",
            path: "manifests",
            plugin: { name: "ytt-renderer" },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "warehouse-slotting" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [{ type: "ComparisonError", message: "plugin generate command failed: exit status 1" }],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ytt-plugin-notes", namespace: "warehouse-slotting" },
        spec: {
          data: {
            "manifests-tree.txt":
              "manifests/\n  base.yaml\n  overlay-prod.yaml\n  slotting-rules/\n    zone-a.yaml\n    zone-b.yaml\n    ZONE-C.yaml       <- note the casing\n",
            "notes.md":
              "Running the plugin's exact `ytt -f .` command by hand against a local\ncheckout of this exact repo path reproduces the failure with a much\nmore specific error the generic ArgoCD condition doesn't surface: 'ytt:\nError: Expected file path casing to match exactly on case-sensitive\nfilesystem, found duplicate-looking paths differing only in case:\nslotting-rules/zone-b.yaml, slotting-rules/ZONE-C.yaml'. This repo was\noriginally developed and tested exclusively on macOS, whose default\nfilesystem is case-insensitive - `zone-b.yaml` and a file someone later\nadded as `ZONE-C.yaml` (meant as a separate, distinct file) looked and\nbehaved like two clearly different files to every contributor's local\nmachine and to git itself (which is case-sensitive and stores both\nfine) - but ytt's own file-loading validation, running inside\nargocd-repo-server's Linux-based plugin sidecar container (a\ncase-sensitive filesystem, same as git, but with an extra check ytt\nspecifically performs), flags the two paths as suspiciously\nnear-duplicate and refuses to proceed, a safety check most other\nplugins/tools don't perform at all - which is exactly why this is the\nonly Application affected despite dozens of others sharing the identical\nsidecar and runtime environment.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "The ArgoCD condition itself is unhelpfully generic - run the plugin's exact generate command by hand against a local checkout of this repo's manifests path to get the real underlying error.",
    "`kubectl get configmap ytt-plugin-notes -n warehouse-slotting -o yaml` - look closely at the file tree, specifically the casing of every filename in the slotting-rules directory.",
    "Every other Application sharing this exact plugin sidecar works fine - the problem has to be something specific to this repo's own file contents, not the plugin or sidecar infrastructure itself.",
  ],
  options: [
    {
      id: "case-insensitive-dev-produced-near-duplicate-filenames",
      label:
        "Two files in this repo's slotting-rules directory differ only in case (zone-b.yaml and ZONE-C.yaml) - invisible as a conflict on the case-insensitive macOS filesystems the repo was developed on, and fine as far as case-sensitive git is concerned, but ytt's own file-loading validation specifically checks for and refuses near-duplicate-looking paths differing only in case, a safety check most other tools (and every other Application's plugin invocation) never trigger.",
      explanation:
        "Running the plugin's exact command locally surfaces the real error: ytt explicitly refusing to proceed due to `zone-b.yaml` and `ZONE-C.yaml` differing only in case. `ytt-plugin-notes` explains why this is invisible to everyone except ytt itself - macOS's default case-insensitive filesystem meant every contributor's local environment (and git, which is case-sensitive but doesn't flag this on its own) never surfaced a conflict, while ytt's own specific validation catches exactly this pattern. Since it's unique to this repo's actual file contents, it explains why every other Application sharing the identical plugin sidecar and runtime is completely unaffected.",
    },
    {
      id: "plugin-sidecar-resource-limits-warehouse",
      label: "The plugin sidecar is running out of memory specifically when processing this Application's larger manifest set.",
      explanation:
        "A resource-exhaustion failure would typically show as an OOMKilled event on the sidecar container, or a generic timeout/connection-reset style error - not a clean 'exit status 1' from the plugin's own command completing (if unsuccessfully) on its own terms. Running the exact same command locally reproduces the identical, specific ytt validation error with no resource constraints involved at all.",
    },
    {
      id: "ytt-version-mismatch-local-vs-sidecar",
      label: "The plugin sidecar is running a different, incompatible version of ytt than what's expected.",
      explanation:
        "The error reproduces identically when running the exact same command against a local checkout, independent of the sidecar - meaning this is a genuine issue with the repo's own file content interacting with ytt's validation logic, not a version-specific behavior difference between two different ytt installations.",
    },
    {
      id: "appproject-blocks-plugin-warehouse",
      label: "The AppProject doesn't permit this specific Application to use the ytt-renderer plugin.",
      explanation:
        "A project-level plugin restriction would produce an InvalidSpecError-style condition rejecting the plugin outright, before ever attempting to run its generate command - here the plugin's command genuinely executes and fails on its own internal validation logic, which is a different point in the process entirely.",
    },
  ],
  correctOptionId: "case-insensitive-dev-produced-near-duplicate-filenames",
  resolution: `Running the plugin's exact \`ytt -f .\` command by hand against a local
checkout surfaces the real, specific error that ArgoCD's generic
condition hides: ytt explicitly refuses to proceed because
\`slotting-rules/zone-b.yaml\` and \`slotting-rules/ZONE-C.yaml\` differ only
in case. \`ytt-plugin-notes\` explains why nobody caught this until now -
this repo was developed exclusively on macOS, whose default filesystem is
case-insensitive, so every contributor's local environment (and even git
itself, which stores both files fine as genuinely distinct) never
surfaced any conflict between the two. ytt's own file-loading validation
specifically checks for and rejects this exact near-duplicate-casing
pattern as a safety measure - a check most other tools, and every other
Application's own manifests, never happen to trigger, which is exactly
why this is the only one of dozens of Applications sharing the identical
plugin sidecar that's affected.

Fix by renaming one of the two files to something unambiguous, resolving
the actual naming collision at its source:

\`\`\`
git mv manifests/slotting-rules/ZONE-C.yaml manifests/slotting-rules/zone-c.yaml
git commit -m "fix: rename ZONE-C.yaml to zone-c.yaml to resolve case-only filename collision"
\`\`\`

Once the two filenames are unambiguous under case-sensitive semantics
(matching both git's and the Linux-based plugin sidecar's actual
filesystem behavior), ytt's validation passes and the next comparison
succeeds. Worth flagging to the team as a broader gotcha: any repo
primarily developed on a case-insensitive filesystem (macOS or Windows
defaults) is carrying latent risk of this exact class of issue for any
future file added with a name that happens to collide by case alone -
worth a pre-commit or CI check scanning for near-duplicate filenames
across the whole repo, not just this one directory.`,
};
