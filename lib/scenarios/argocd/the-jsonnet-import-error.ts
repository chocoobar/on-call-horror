import type { Scenario } from "../types";

export const theJsonnetImportError: Scenario = {
  id: "the-jsonnet-import-error",
  title: "The Jsonnet Import Error",
  subtitle: "fraud-detection's config generation broke the moment a shared library got a minor version bump",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "jsonnet", "config-management-plugin"],
  briefing: `"fraud-detection" generates its manifests from Jsonnet via a custom Config
Management Plugin. A shared internal Jsonnet library used by dozens of
services got a routine minor version bump this morning, and
fraud-detection immediately started failing comparison - even though the
library's own changelog says this release is fully backward compatible.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-jsonnet-import-error", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/fraud-detection.git",
            targetRevision: "main",
            path: "manifests",
            plugin: { name: "jsonnet-renderer" },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "fraud-detection" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message: "RUNTIME ERROR: field does not exist: defaultResourceProfile\n  manifests/main.jsonnet:14:22-58",
            },
          ],
        },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "jsonnet-lib-notes", namespace: "fraud-detection" },
        spec: {
          data: {
            "main.jsonnet.excerpt":
              "local shared = import 'vendor/shared-jsonnet-lib/main.libsonnet';\n\nlocal profile = shared.profiles.defaultResourceProfile;\n",
            "shared-lib-changelog.txt":
              "shared-jsonnet-lib v3.4.0 (this morning):\n  - Renamed profiles.defaultResourceProfile to\n    profiles.standardResourceProfile for clarity (breaking rename,\n    listed under 'Breaking Changes' in this same changelog entry,\n    despite the release being labeled a 'minor' version bump per the\n    library's own versioning convention which treats renames as minor\n    if a compatibility alias is also provided)\n  - A compatibility alias, profiles.defaultResourceProfile ->\n    profiles.standardResourceProfile, WAS added specifically to avoid\n    breaking consumers during the transition period, but only in the\n    libsonnet source tree itself - the version of the library actually\n    vendored into fraud-detection's repo (via a flat file copy, not a\n    package manager) is a stale pre-alias snapshot from before the\n    alias was added.",
          },
        },
        age: "25m",
      },
    ],
  },
  hints: [
    "The Jsonnet runtime error names an exact field, `defaultResourceProfile`, and an exact line in main.jsonnet - it's a real reference to a real field that the library's own schema no longer directly provides that name for.",
    "`kubectl get configmap jsonnet-lib-notes -n fraud-detection -o yaml` and read the shared library's changelog carefully - was a compatibility alias actually added, and does fraud-detection's own vendored copy include it?",
    "How is the shared library actually brought into fraud-detection's repo - a package manager with version pinning, or a flat vendored copy that has to be manually refreshed?",
  ],
  options: [
    {
      id: "vendored-copy-stale-missing-alias",
      label:
        "The shared library's v3.4.0 release renamed the field fraud-detection references, but added a compatibility alias specifically to avoid breaking consumers during the transition - the alias exists in the library's own source, but fraud-detection vendors a flat, manually-copied snapshot of the library that predates the alias being added, so its copy only has the new name and none of the old one.",
      explanation:
        "`jsonnet-lib-notes` confirms the rename happened with a compatibility alias intentionally added to prevent exactly this kind of breakage - but fraud-detection's own vendored copy (a flat file copy rather than a package-manager-tracked dependency) is a stale pre-alias snapshot. The runtime error precisely matches a reference to the old field name against a copy of the library that no longer resolves it, even though the current, canonical version of the library does via its alias.",
    },
    {
      id: "shared-lib-changelog-wrong",
      label: "The shared library's changelog is simply inaccurate about backward compatibility.",
      explanation:
        "The changelog is accurate about the *current, canonical* version of the library - it did add a compatibility alias specifically to preserve backward compatibility. The actual gap is that fraud-detection's vendored copy is a stale snapshot from before that alias existed, not that the changelog's claim about the live library is false.",
    },
    {
      id: "cmp-plugin-broken-jsonnet",
      label: "The jsonnet-renderer CMP itself is broken and mis-evaluating the Jsonnet.",
      explanation:
        "The error is a genuine Jsonnet runtime error - a real reference to a field that a specific version of the library doesn't provide under that name - not a plugin execution failure. The plugin is correctly running the Jsonnet and correctly reporting the real evaluation error it hit.",
    },
    {
      id: "other-services-also-broken-jsonnet",
      label: "Every other service using the same shared library is also broken by this version bump.",
      explanation:
        "The scenario doesn't indicate other services were affected - and per the notes, the library's canonical current version does provide backward compatibility via the alias for anyone consuming it normally. fraud-detection's specific problem is its own stale, manually-vendored copy of the library, which is a fraud-detection-specific gap rather than a library-wide regression.",
    },
  ],
  correctOptionId: "vendored-copy-stale-missing-alias",
  resolution: `The runtime error - \`field does not exist: defaultResourceProfile\`, at
an exact line referencing that exact field - is real and precise.
\`jsonnet-lib-notes\` explains why: the shared library's v3.4.0 release did
rename that field, but specifically added a compatibility alias
(\`defaultResourceProfile -> standardResourceProfile\`) to avoid breaking
existing consumers during the transition. That alias genuinely exists in
the library's current, canonical source. The problem is entirely on
fraud-detection's side: its Jsonnet vendoring is a flat, manually-copied
snapshot of the library rather than something tracked through a package
manager with real version pinning - and that copied snapshot predates the
alias being added, so it only has the new field name, none of the old
one.

Two-part fix. Immediate: refresh fraud-detection's vendored copy to the
current library version (which does include the alias, unblocking sync
right away):

\`\`\`
cp -r shared-jsonnet-lib/* fraud-detection/manifests/vendor/shared-jsonnet-lib/
git commit -am "refresh vendored shared-jsonnet-lib to current version"
\`\`\`

Correct, forward-looking fix: update fraud-detection's own reference to
use the new field name directly, rather than relying on a compatibility
alias that's explicitly meant to be temporary:

\`\`\`jsonnet
local profile = shared.profiles.standardResourceProfile;
\`\`\`

Worth raising more broadly too: a flat, manually-vendored copy of a
shared library (versus a package-manager-tracked dependency with
explicit version pins and a documented update process) is exactly what
makes this kind of silent staleness possible - any service vendoring this
library the same way is one un-refreshed copy away from the same failure
mode.`,
};
