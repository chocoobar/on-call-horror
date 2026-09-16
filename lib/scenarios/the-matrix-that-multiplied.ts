import type { Scenario } from "./types";

export const theMatrixThatMultiplied: Scenario = {
  id: "the-matrix-that-multiplied",
  title: "The Matrix That Multiplied",
  subtitle: "there are 40 Applications named after teams that don't own those environments",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "applicationset", "matrix-generator"],
  briefing: `The platform team set up a matrix generator to create one Application per
(team, environment) pair - intended for exactly the handful of
combinations where a team actually deploys to a given environment.
Instead, "kubectl get applications -n argocd -l generated-by=team-env-matrix"
returns 40 Applications: every one of 8 teams crossed with every one of 5
environments, including plenty that make no sense (the "mobile" team has
a "legacy-mainframe-bridge" environment Application, for instance).`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "team-env-matrix", namespace: "argocd" },
        spec: {
          generators: [
            {
              matrix: {
                generators: [
                  { list: { elements: [{ team: "checkout" }, { team: "search" }, { team: "mobile" }, { team: "billing" }, { team: "identity" }, { team: "growth" }, { team: "platform" }, { team: "data" }] } },
                  { list: { elements: [{ env: "dev" }, { env: "staging" }, { env: "prod" }, { env: "sandbox" }, { env: "legacy-mainframe-bridge" }] } },
                ],
              },
            },
          ],
          template: {
            metadata: { name: "{{team}}-{{env}}" },
            spec: {
              source: { repoURL: "https://github.com/example/team-configs.git", targetRevision: "main", path: "{{team}}/{{env}}" },
              destination: { server: "https://kubernetes.default.svc", namespace: "{{team}}-{{env}}" },
            },
          },
        },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "matrix-design-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "A matrix generator produces the full cross-product (Cartesian product)\nof every element from each of its child generators - here, 8 teams x 5\nenvironments = 40 combinations, every single one. There is no built-in\nconcept of 'only the valid pairs' in a matrix generator on its own; it\nalways generates every combination unless something explicitly narrows\nit (e.g. a shared label/key both list generators' elements carry, used\nvia templated matchLabels selection downstream, or restructuring away\nfrom a flat cross-product entirely, such as a single list generator\nwhose elements ARE the valid pairs). This ApplicationSet's template also\nhas no per-combination existence check - it renders `{{team}}/{{env}}`\nas a source path regardless of whether that path exists in the repo,\nwhich is why most of the 40 generated Applications are simply failing\ncomparison with 'path does not exist' rather than actually deploying\nanything harmful - only a handful of the 40 correspond to real,\nintended, existing paths.",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "`kubectl get applicationset team-env-matrix -n argocd -o yaml` - a matrix generator with two list generators inside it produces every combination of their elements, full stop.",
    "`kubectl get configmap matrix-design-notes -n argocd -o yaml` for exactly what a matrix generator does and doesn't do on its own.",
    "Check how many of the 40 generated Applications are actually Synced/Healthy versus failing comparison with a missing-path error - that tells you how many combinations are real versus generator noise.",
  ],
  options: [
    {
      id: "matrix-generates-full-cross-product-not-valid-pairs",
      label:
        "A matrix generator always produces the full cross-product of its child generators' elements - 8 teams x 5 environments = 40, every combination, with no concept of 'only the pairs that are actually valid' unless something explicitly narrows it, so most of the 40 generated Applications correspond to team/environment pairs that were never meant to exist.",
      explanation:
        "`matrix-design-notes` confirms this is exactly how a matrix generator works: full Cartesian product, no built-in narrowing. With two independent list generators (8 teams, 5 environments), 40 Applications is the mathematically correct - if unintended - output. Most fail comparison with a missing-path error rather than actually deploying anything, since the template's `{{team}}/{{env}}` source path only exists in the repo for the real, intended pairs.",
    },
    {
      id: "appset-controller-duplicated-generation-matrix",
      label: "The ApplicationSet controller has a bug that's duplicating generation output.",
      explanation:
        "40 is exactly 8 teams times 5 environments - a precise, expected cross-product count, not a duplicated or inflated one. A generation bug producing extra copies wouldn't neatly match the mathematical product of the two input lists; this is the matrix generator doing exactly what it's documented to do.",
    },
    {
      id: "list-generator-elements-duplicated",
      label: "One of the list generators has duplicate entries in its elements list.",
      explanation:
        "8 distinct team names and 5 distinct environment names are shown, with no repeats in either list - the count of 40 is fully explained by 8 x 5 as a clean cross-product, with no duplication needed to account for it.",
    },
    {
      id: "template-name-collision-matrix",
      label: "The template's Application naming pattern is causing name collisions that merge unrelated entries.",
      explanation:
        "`{{team}}-{{env}}` produces a unique name for every one of the 40 combinations (no two teams share a name, no two envs share a name) - there's no collision happening; all 40 are distinct, individually-generated Applications, which is itself the actual problem.",
    },
  ],
  correctOptionId: "matrix-generates-full-cross-product-not-valid-pairs",
  resolution: `\`matrix-design-notes\` confirms the mechanism: a matrix generator always
produces the full Cartesian product of its child generators' elements -
there's no built-in notion of "only the valid combinations" unless
something explicitly constrains it. With one list generator of 8 teams
and another of 5 environments, 40 is exactly the expected, mathematically
correct output of a matrix generator used this way - it just isn't what
anyone actually wanted, since only a handful of team/environment pairs
are real. Most of the 40 fail comparison with a missing-path error rather
than deploying anything, because the templated source path only resolves
for pairs that genuinely exist in the repo - which limited the blast
radius, but the noise (and the ones that *do* have a matching path but
shouldn't logically exist, like mobile's legacy-mainframe-bridge) is real.

The right fix is replacing the cross-product approach with a single list
generator whose elements are exactly the valid pairs:

\`\`\`yaml
spec:
  generators:
    - list:
        elements:
          - { team: checkout, env: prod }
          - { team: checkout, env: staging }
          - { team: search, env: prod }
          - { team: billing, env: prod }
          # ... only the pairs that are actually meant to exist
\`\`\`

If the valid-pairs list is itself large and data-driven, sourcing it from
a git file via a git generator (one file listing valid pairs, one
Application per line) keeps it maintainable without falling back to a
matrix's blind cross-product. Either way, the fix removes the 30+
never-intended Applications on its next reconciliation, since
ApplicationSets prune generated Applications whose generator no longer
produces a matching entry.`,
};
