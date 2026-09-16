import type { Scenario } from "../types";

export const theAppsetTemplatePatchBug: Scenario = {
  id: "the-appset-template-patch-bug",
  title: "The AppSet Template Patch Bug",
  subtitle: "one tenant out of forty is quietly missing its dedicated resource limits override",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "applicationset", "template-patch"],
  briefing: `The "tenant-apps" ApplicationSet generates 40 near-identical tenant
Applications from a shared base template, with a per-tenant "templatePatch"
overriding things like resource limits for the handful of tenants on a
premium tier. "tenant-globex", a premium tier customer, has been running
on standard-tier resource limits for two weeks - support only found it
after the customer complained about performance, well past their upgrade
date.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "tenant-apps", namespace: "argocd" },
        spec: {
          generators: [
            {
              list: {
                elements: [
                  { tenant: "acme", tier: "standard" },
                  { tenant: "globex", tier: "premium" },
                  { tenant: "initech", tier: "standard" },
                ],
              },
            },
          ],
          template: {
            metadata: { name: "tenant-{{tenant}}" },
            spec: {
              source: { repoURL: "https://github.com/example/tenant-configs.git", targetRevision: "main", path: "{{tenant}}" },
              destination: { server: "https://kubernetes.default.svc", namespace: "tenant-{{tenant}}" },
            },
          },
          templatePatch: "spec:\n  source:\n    helm:\n      parameters:\n        - name: resources.limits.memory\n          value: '{{ if eq .tier \"premium\" }}4Gi{{ else }}1Gi{{ end }}'\n",
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "templatepatch-history-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "git blame on this ApplicationSet shows the list generator's elements\nfor `globex` were updated 2 weeks ago, changing `tier` from 'standard'\nto 'premium' as part of their contract upgrade - that part of the change\nwas made correctly. BUT: 3 weeks ago (before the tier upgrade, in a\nseparate, unrelated commit), someone renamed the generator element's key\nfrom `tier` to `pricingTier` across the whole file as part of a naming\ncleanup, intending better clarity - and updated the `destination`/`path`\ntemplate fields accordingly, but MISSED updating the templatePatch\nstring itself, which is a plain multi-line string (not parsed/validated\nas referencing real generator fields by any tooling) and still reads\n`.tier` rather than `.pricingTier`. Since `.tier` no longer exists on any\ngenerator element after the rename, Go templating resolves it to an\nempty/zero value for every tenant, meaning the `eq .tier \"premium\"`\ncomparison is false for all 40 tenants regardless of their actual\npricingTier value - every tenant, including globex, silently renders the\nelse-branch 1Gi limit.",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get applicationset tenant-apps -n argocd -o yaml` - check the generator's list elements field names exactly, then check the templatePatch string's field references against them, character for character.",
    "A templatePatch is a plain string template - nothing validates that the field names it references (like `.tier`) actually still exist on the generator's elements after someone renames them elsewhere.",
    "`kubectl get configmap templatepatch-history-notes -n argocd -o yaml` for the full history: two separate changes, three weeks apart, and which fields each one did and didn't touch.",
  ],
  options: [
    {
      id: "templatepatch-references-renamed-field",
      label:
        "A naming cleanup three weeks ago renamed the generator's `tier` field to `pricingTier` everywhere except inside the templatePatch string, which is unvalidated free text - so `.tier` now resolves to an empty value for every tenant, the premium-tier comparison is false across the board, and every tenant (globex included, despite its later, correctly-applied tier upgrade) silently renders the standard-tier resource limit.",
      explanation:
        "`templatepatch-history-notes` traces two separate changes: a field rename from `tier` to `pricingTier` three weeks ago that updated every other template reference except the templatePatch string (which nothing validates against real generator fields), and a correct, later tier upgrade for globex that updated the generator element's `tier` value - except that field doesn't exist anymore under that name. `.tier` resolves to empty in the templatePatch's Go template evaluation, so `eq .tier \"premium\"` is false for every tenant, explaining why globex silently got standard-tier limits despite its legitimate premium upgrade.",
    },
    {
      id: "globex-list-entry-not-updated",
      label: "The globex element's tier field was simply never actually changed from 'standard' to 'premium'.",
      explanation:
        "Git blame confirms the tier field's value genuinely was updated to 'premium' for globex two weeks ago as part of the contract upgrade - the update to the *value* happened correctly. The actual break is that the templatePatch references the field by a name (`tier`) that no longer exists on any generator element after an earlier, unrelated rename to `pricingTier`.",
    },
    {
      id: "appset-controller-caching-old-template",
      label: "The ApplicationSet controller is caching an old version of the templatePatch and not picking up changes.",
      explanation:
        "This isn't a caching/staleness issue - the templatePatch is being evaluated fresh each time against its own current (if outdated-field-name) content, and the resulting empty value for every tenant, not just globex, is fully and deterministically explained by the field name mismatch, not by stale content being served.",
    },
    {
      id: "helm-parameter-override-precedence-appset",
      label: "A separate Helm parameter override elsewhere is taking precedence over the templatePatch's value.",
      explanation:
        "There's no indication of a competing override elsewhere in the Application spec - the templatePatch itself is the only mechanism setting `resources.limits.memory` here, and its own internal logic (comparing against a field that no longer exists) fully explains why every tenant, not just globex, ends up with the standard-tier value.",
    },
  ],
  correctOptionId: "templatepatch-references-renamed-field",
  resolution: `\`templatepatch-history-notes\` traces two separate changes that combined to
cause this. Three weeks ago, a naming cleanup renamed the generator list's
\`tier\` field to \`pricingTier\` everywhere it's referenced in structured
template fields (\`destination\`, \`path\`) - but missed the
\`templatePatch\` string, which is unvalidated free text that nothing
checks against the generator's actual field names. Two weeks ago,
globex's tier was correctly updated to \`"premium"\` as part of their
contract upgrade - except under the *new* field name, \`pricingTier\`,
since that's what the generator element actually has now. The
templatePatch's Go template still evaluates \`{{ if eq .tier "premium" }}\`
against a field name that no longer exists on any element - \`.tier\`
resolves to an empty value for every one of the 40 tenants, so the
premium comparison is false across the board, and every tenant silently
renders the standard-tier \`1Gi\` limit, globex included.

Fix by updating the templatePatch to reference the field's actual current
name:

\`\`\`yaml
templatePatch: |
  spec:
    source:
      helm:
        parameters:
          - name: resources.limits.memory
            value: '{{ if eq .pricingTier "premium" }}4Gi{{ else }}1Gi{{ end }}'
\`\`\`

On the ApplicationSet's next reconciliation, every Application regenerates
with the corrected comparison, and globex (along with any other premium
tenant that was silently affected the same way) picks up its intended
4Gi limit. Worth a broader lesson for the team: a templatePatch's field
references are plain text with zero compile-time or validation-time
checking against the generator's real schema - a field rename anywhere
in an ApplicationSet needs an explicit grep across every templatePatch
string too, since nothing else will catch a stale reference like this
until, as here, a customer notices the consequences.`,
};
