import type { Scenario } from "../types";

export const theGeneratorPathThatMoved: Scenario = {
  id: "the-generator-path-that-moved",
  title: "The Generator Path That Moved",
  subtitle: "three tenants quietly vanished from the tenant-services ApplicationSet",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "applicationset", "git-generator"],
  briefing: `The "tenant-services" ApplicationSet uses a git directory generator
pointed at "tenants/*" to create one Application per tenant folder. A repo
reorganization last week moved every tenant's config into a new
"configs/tenants/*" structure for consistency with other repos - and now
three tenants that definitely still have valid configs no longer have
Applications at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "tenant-services", namespace: "argocd" },
        spec: {
          generators: [
            {
              git: {
                repoURL: "https://github.com/example/tenant-configs.git",
                revision: "main",
                directories: [{ path: "tenants/*" }],
              },
            },
          ],
          template: {
            metadata: { name: "{{path.basename}}" },
            spec: {
              source: { repoURL: "https://github.com/example/tenant-configs.git", targetRevision: "main", path: "{{path}}" },
              destination: { server: "https://kubernetes.default.svc", namespace: "{{path.basename}}" },
            },
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tenant-repo-reorg-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "Repo reorg 1 week ago: `tenants/<name>/` directories were moved to\n`configs/tenants/<name>/` for consistency with the platform-services and\napi-gateway repos, which already used a `configs/` prefix. All three\naffected tenants (acme, globex, initech) still have valid, unchanged\nconfig content at their new path - only the path itself moved. The\nApplicationSet's git directory generator was never updated to match.",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "`kubectl get applicationset tenant-services -n argocd -o yaml` - check `spec.generators[0].git.directories`.",
    "`kubectl get configmap tenant-repo-reorg-notes -n argocd -o yaml` for what actually happened to the repo layout.",
    "A git directory generator only creates Applications for directories matching its configured glob - if the real directories moved, the generator's list of matches simply shrinks, with no error raised anywhere.",
  ],
  options: [
    {
      id: "generator-path-not-updated-after-reorg",
      label:
        "A repo reorg moved tenant configs from tenants/* to configs/tenants/*, but the ApplicationSet's git directory generator is still globbing the old tenants/* path - it silently stops matching any directories at all, so the Applications for those tenants are quietly removed rather than erroring out.",
      explanation:
        "`tenant-repo-reorg-notes` confirms the exact move and that content itself is unchanged, just relocated. `spec.generators[0].git.directories` still points at `tenants/*`, the old path. A git directory generator simply produces the list of currently-matching directories on each refresh - when the old path stops matching anything, the ApplicationSet controller (by default) deletes the Applications it previously generated for those now-unmatched entries, with no error surfaced anywhere.",
    },
    {
      id: "appset-controller-crashed",
      label: "The ApplicationSet controller crashed and lost track of those three tenants.",
      explanation:
        "The ApplicationSet resource itself is present and otherwise functioning normally (other unaffected tenants, if any existed at the old path still, would still be generating fine) - a controller crash would be a broader, systemic symptom, not a clean, explainable disappearance of exactly the three tenants whose directories moved.",
    },
    {
      id: "appproject-blocks-three-tenants",
      label: "The AppProject started blocking those three tenants' destination namespaces.",
      explanation:
        "If an AppProject destination restriction were the cause, the affected Applications would still exist but show an InvalidSpecError condition - here the Applications aren't just failing, they've been generated out of existence entirely, which is what a generator no longer matching a directory produces.",
    },
    {
      id: "git-credentials-partial-failure",
      label: "ArgoCD's git credentials lost access to just those three tenant directories.",
      explanation:
        "Git repository access doesn't work at a sub-directory granularity - credentials are all-or-nothing for a given repo. If credentials had failed, the generator would fail to read the repo at all (affecting every tenant), not selectively lose exactly the three that happened to move.",
    },
  ],
  correctOptionId: "generator-path-not-updated-after-reorg",
  resolution: `\`tenant-repo-reorg-notes\` confirms the repo reorganization moved every
tenant's config from \`tenants/<name>/\` to \`configs/tenants/<name>/\` a
week ago - with the content itself untouched, just relocated. The
ApplicationSet's git directory generator, in \`spec.generators[0].git
.directories\`, is still globbing the old \`tenants/*\` path. A directory
generator's output is simply "whatever currently matches this glob" -
when the real directories moved, that list quietly shrank, and by
default the ApplicationSet controller deletes any Application it
previously generated for a directory that no longer matches, with no
error or warning surfaced anywhere.

Fix by updating the generator to the new path:

\`\`\`yaml
spec:
  generators:
    - git:
        repoURL: https://github.com/example/tenant-configs.git
        revision: main
        directories:
          - path: configs/tenants/*
  template:
    spec:
      source:
        path: "{{path}}"
\`\`\`

On the next generator refresh, all matching tenant directories (including
the three that moved) regenerate their Applications and sync normally.
Any reorg that touches a path an ApplicationSet generator depends on
needs the generator updated in the same change - otherwise the loss is
silent rather than an obvious failure.`,
};
