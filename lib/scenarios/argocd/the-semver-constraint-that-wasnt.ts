import type { Scenario } from "../types";

export const theSemverConstraintThatWasnt: Scenario = {
  id: "the-semver-constraint-that-wasnt",
  title: "The Semver Constraint That Wasn't",
  subtitle: "payment-gateway jumped two major versions overnight, unattended",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "image-updater", "semver"],
  briefing: `"payment-gateway" uses ArgoCD Image Updater with a semver constraint meant
to auto-deploy patch and minor releases only, treating major version
bumps as requiring manual review given the service's sensitivity.
Overnight, it auto-deployed straight from v2.4.1 to v4.0.0 - two major
versions at once, unreviewed - and the new version's breaking API changes
immediately started rejecting a chunk of legitimate transactions.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-semver-constraint-that-wasnt",
          namespace: "argocd",
          annotations: {
            "argocd-image-updater.argoproj.io/image-list": "gateway=registry.example.com/payment-gateway",
            "argocd-image-updater.argoproj.io/gateway.update-strategy": "semver",
            "argocd-image-updater.argoproj.io/gateway.allow-tags": "regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/payment-gateway.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "payments" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "f7a8b9c" }, health: { status: "Degraded" } },
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "semver-constraint-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "The 'auto-deploy patch and minor only, not major' policy the team\nintended is a real, well-known ArgoCD Image Updater feature - but it\nrequires an explicit CONSTRAINT expression on the image-list annotation\nitself (e.g. `gateway=registry.example.com/payment-gateway:~2.4` for\n'anything compatible with 2.4.x', or a caret-range equivalent), which\nconstrains candidate tags to a specific major/minor range BEFORE the\nupdate-strategy picks among them. This Application's image-list\nannotation has no such constraint at all - just the bare image\nreference. `update-strategy: semver` on its own means 'pick the highest\nversion that satisfies the tag format allowed by allow-tags', with NO\nupper bound implied by the strategy name itself - `allow-tags`'\nregexp only validates that a tag LOOKS like a semver string\n(`vX.Y.Z`), it doesn't and can't restrict which major version is\nacceptable. The 'no major bumps without review' intent was never\nactually encoded anywhere in this Application's configuration - it was\na team assumption about what 'semver strategy' implies, not something\nthe tooling was ever told to enforce.",
          },
        },
        age: "8h",
      },
    ],
  },
  hints: [
    "`kubectl get application the-semver-constraint-that-wasnt -n argocd -o yaml` - check the full `argocd-image-updater.argoproj.io/*` annotation set. Is there an actual version constraint anywhere, or just an update-strategy?",
    "`update-strategy: semver` picks the highest version matching `allow-tags` - it has no inherent concept of 'stay within the current major version' unless something explicitly constrains it that way.",
    "`kubectl get configmap semver-constraint-notes -n argocd -o yaml` for exactly what mechanism would have been needed to actually enforce the 'no major bumps' intent, and whether it was ever configured.",
  ],
  options: [
    {
      id: "no-explicit-constraint-just-strategy-name",
      label:
        "The team's 'auto-deploy patch/minor only' policy was never actually encoded in the Application's configuration - update-strategy: semver on its own has no upper bound and will happily pick the highest version matching allow-tags' format check regardless of major version, and allow-tags' regexp only validates that a tag looks like semver, it doesn't and can't restrict which major version is acceptable; a real constraint expression was needed and was never added.",
      explanation:
        "`semver-constraint-notes` confirms the real mechanism needed - a version constraint expression on the image-list annotation itself (like `:~2.4` or an equivalent range) - was never configured; only a bare image reference and an `allow-tags` regexp checking tag *format*, not version *range*, exist. `update-strategy: semver` on its own means 'pick the highest matching tag,' with no inherent ceiling - it did exactly that, correctly by its own definition, jumping to v4.0.0 because nothing told it not to. The team's intent was real but was never actually translated into a configuration the tooling enforces.",
    },
    {
      id: "allow-tags-regex-bug",
      label: "The allow-tags regexp has a bug that's incorrectly matching major version bumps it shouldn't.",
      explanation:
        "The regexp (`^v[0-9]+\\.[0-9]+\\.[0-9]+$`) is correctly and simply validating that a tag looks like `vX.Y.Z` - it was never designed to restrict which major version is acceptable, and no regexp of this shape could express a 'only within the current major version' constraint on its own without being rewritten as a genuinely different kind of expression (and Image Updater has a separate, dedicated mechanism for that instead).",
    },
    {
      id: "registry-serving-wrong-tag-major",
      label: "The container registry served the wrong tag due to a caching or indexing bug.",
      explanation:
        "v4.0.0 is a real, legitimately published tag matching the allowed format - there's no indication the registry served anything incorrect or unintended; Image Updater correctly found and selected a real, existing tag that happened to be the highest one matching its (unconstrained) selection criteria.",
    },
    {
      id: "selfheal-caused-major-jump",
      label: "selfHeal caused the Application to jump versions by reverting to a cached old spec, then re-resolving.",
      explanation:
        "selfHeal reconciles live state against the Application's currently declared spec - it doesn't independently select or change image tags at all, that's Image Updater's job. The version jump is fully and directly explained by Image Updater's own tag resolution having no upper bound configured, unrelated to selfHeal's behavior.",
    },
  ],
  correctOptionId: "no-explicit-constraint-just-strategy-name",
  resolution: `\`semver-constraint-notes\` clarifies the actual mechanism: ArgoCD Image
Updater does support constraining auto-updates to a specific
major/minor range, but it requires an explicit constraint expression on
the image reference itself (something like \`:~2.4\` for "stay within
2.4.x," or a broader caret-range equivalent) - not just an
\`update-strategy\` name. This Application's \`image-list\` annotation has
no such constraint at all, just the bare image reference, and
\`allow-tags\`' regexp only checks that a candidate tag *looks like* a
semver string (\`vX.Y.Z\`) - it has no way to express or enforce "only
within the current major version." \`update-strategy: semver\` on its own
simply means "pick the highest version matching the allowed tag format,"
full stop, with no inherent ceiling. Image Updater did exactly that,
correctly by its own definition - the team's "no major bumps without
review" policy was a real intention that was never actually translated
into configuration the tooling could enforce.

Fix by adding an explicit version constraint scoping candidate tags to
the current major version:

\`\`\`yaml
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: "gateway=registry.example.com/payment-gateway:~2"
    argocd-image-updater.argoproj.io/gateway.update-strategy: semver
    argocd-image-updater.argoproj.io/gateway.allow-tags: "regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+$"
\`\`\`

(the \`:~2\` constraint restricts Image Updater to selecting only 2.x.x
tags; bumping to 3.x or beyond then requires someone to deliberately
change that constraint, which is a natural, reviewable place to gate a
major version upgrade). Worth auditing every other Image Updater-managed
Application in the org for the same gap - "we're using the semver
strategy, so it won't jump majors" is a dangerously easy assumption to
make, and as this incident shows, it's simply not true without an
explicit constraint saying so.`,
};
