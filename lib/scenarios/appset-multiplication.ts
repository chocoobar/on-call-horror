import type { Scenario } from "./types";

export const appsetMultiplication: Scenario = {
  id: "appset-multiplication",
  title: "AppSet Multiplication",
  subtitle: "there are two Applications named almost the same thing, and they're fighting",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "applicationset", "gitops"],
  briefing: `An ApplicationSet was set up to generate one Application per customer
tenant, reading tenant names from a list. This week, "tenant-acme"'s
resources started flickering between two slightly different
configurations - because there are now two Applications both trying to
manage tenant-acme's namespace.`,
  constraints: [
    "The ApplicationSet's underlying git source and templates are otherwise correct - every other tenant it generates an Application for is fine.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "tenant-acme", namespace: "argocd", labels: { "argocd.argoproj.io/application-set-name": "tenant-apps" } },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/tenant-configs.git", targetRevision: "main", path: "tenants/acme" },
          destination: { server: "https://kubernetes.default.svc", namespace: "tenant-acme" },
        },
        status: { sync: { status: "Synced", revision: "1a1a1a1" }, health: { status: "Healthy" } },
        age: "2h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "tenant-acme-corp", namespace: "argocd", labels: { "argocd.argoproj.io/application-set-name": "tenant-apps" } },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/tenant-configs.git", targetRevision: "main", path: "tenants/acme-corp" },
          destination: { server: "https://kubernetes.default.svc", namespace: "tenant-acme" },
        },
        status: { sync: { status: "Synced", revision: "2b2b2b2" }, health: { status: "Healthy" } },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tenant-list-notes", namespace: "argocd" },
        spec: {
          data: {
            "tenants.yaml":
              "# ApplicationSet list generator source\ntenants:\n  - name: acme\n    displayName: \"Acme\"\n  - name: acme-corp\n    displayName: \"Acme Corp (formerly just 'Acme', renamed in CRM 2 days ago)\"\n",
            "notes.md":
              "`acme-corp` is a rename of the same customer previously listed as just\n`acme` - added as a new list entry two days ago when the CRM record was\nrenamed, instead of editing the existing `acme` entry in place. The\nApplicationSet's generated `destination.namespace` template derives from\na separate, un-updated `tenant-namespace-map` that still maps both\n`acme` and `acme-corp` to the same `tenant-acme` namespace.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get application -n argocd -l argocd.argoproj.io/application-set-name=tenant-apps` - how many Applications does this ApplicationSet currently have, and what are their `spec.destination.namespace` values?",
    "`kubectl get configmap tenant-list-notes -n argocd -o yaml` - look at both the list generator's tenant entries and the separate namespace-mapping notes.",
    "An ApplicationSet's list generator creates exactly one Application per list entry - it has no way of knowing two entries are 'really' the same underlying customer unless something explicitly de-duplicates or maps them.",
  ],
  options: [
    {
      id: "duplicate-tenant-entry-same-namespace",
      label:
        "The CRM rename from \"acme\" to \"acme-corp\" was added as a brand-new entry in the list generator's source instead of updating the existing one, so the ApplicationSet now generates two separate Applications from two separate list entries - both mapped to the same `tenant-acme` destination namespace via an un-updated namespace map - and both actively manage (and fight over) the same live resources.",
      explanation:
        "`tenant-list-notes` confirms `acme-corp` was added as a second list entry two days ago rather than renaming the existing `acme` entry, and that the separate namespace-mapping config still resolves both names to the identical `tenant-acme` namespace. An ApplicationSet's list generator has no concept of two entries referring to the same real-world tenant - it faithfully creates one Application per entry, and with both entries independently resolving to the same destination, both generated Applications now genuinely, correctly manage the exact same live resources, each periodically overwriting the other's most recent sync.",
    },
    {
      id: "applicationset-controller-bug",
      label: "The ApplicationSet controller has a bug causing it to duplicate Applications.",
      explanation:
        "Every other tenant generated by this same ApplicationSet is confirmed fine - a controller-level bug would be expected to affect generation broadly, not produce exactly one extra Application that traces directly back to a specific, identifiable duplicate entry in the source list.",
    },
    {
      id: "git-merge-conflict-duplicated-manifest",
      label: "A git merge conflict left two copies of the same tenant manifest in the repository.",
      explanation:
        "`tenants.yaml` shows two distinct, intentionally different entries (`acme` and `acme-corp`, each with its own `displayName`) rather than two identical copies of the same entry that a merge conflict would typically produce - this was a deliberate addition, just one that didn't account for the existing entry it was meant to replace.",
    },
    {
      id: "namespace-selector-too-broad",
      label: "The ApplicationSet's namespace selector is too broad and is matching extra namespaces.",
      explanation:
        "ApplicationSets using a list generator don't select existing namespaces to match against - they generate a destination namespace per list entry from a template. The duplication traces to two list entries resolving to the same destination, not to an overly broad selector picking up unintended existing namespaces.",
    },
  ],
  correctOptionId: "duplicate-tenant-entry-same-namespace",
  resolution: `\`tenant-list-notes\` traces the full chain: the CRM system's rename of
this customer from "acme" to "acme-corp" was reflected in the
ApplicationSet's list generator source as a brand-new entry, rather than
an edit to the existing \`acme\` entry - so the generator now has two
distinct tenant entries where there used to be one. A list generator
creates exactly one Application per entry, with no built-in way to notice
that two entries might refer to the same real customer; it did its job
correctly given the input it was given. The separate namespace-mapping
config compounds it by resolving *both* names to the same
\`tenant-acme\` destination namespace, so both generated Applications
end up genuinely, legitimately managing the identical set of live
resources - each one periodically re-asserting its own version of the
manifests over the other's.

The fix is removing the duplicate at the source - editing the CRM-derived
list so the rename replaces the old entry instead of sitting alongside
it:

\`\`\`yaml
tenants:
  - name: acme-corp        # renamed in place, not added alongside "acme"
    displayName: "Acme Corp"
\`\`\`

Once the list generator only has one entry for this customer, the
ApplicationSet reconciles down to a single Application on its next
generation pass, and ArgoCD automatically cleans up the now-unmatched
duplicate (ApplicationSets prune generated Applications whose source list
entry disappears, by default). Any rename or migration reflected in an
ApplicationSet's generator input needs to be an edit to the existing
entry, not an addition - two entries that resolve to the same destination
will always fight, regardless of how correct each one looks in isolation.`,
};
