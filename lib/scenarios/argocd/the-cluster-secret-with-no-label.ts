import type { Scenario } from "../types";

export const theClusterSecretWithNoLabel: Scenario = {
  id: "the-cluster-secret-with-no-label",
  title: "The Cluster Secret With No Label",
  subtitle: "a disaster-recovery cluster registered weeks ago has never received a single Application",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "multi-cluster", "cluster-generator"],
  briefing: `"dr-cluster-west" was registered with ArgoCD weeks ago as a disaster-
recovery target, meant to receive a mirrored copy of every production
Application via a cluster-generator ApplicationSet. A DR drill today
discovered it's completely empty - zero Applications, zero workloads.
"argocd cluster list" shows it registered and reachable the whole time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationSet",
        metadata: { name: "dr-mirror", namespace: "argocd" },
        spec: {
          generators: [
            {
              clusters: {
                selector: { matchExpressions: [{ key: "env", operator: "In", values: ["dr"] }] },
              },
            },
          ],
          template: {
            metadata: { name: "dr-{{name}}-mirror" },
            spec: {
              source: { repoURL: "https://github.com/example/production-services.git", targetRevision: "main", path: "manifests" },
              destination: { server: "{{server}}", namespace: "mirrored" },
            },
          },
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "dr-cluster-west",
          namespace: "argocd",
          labels: { "argocd.argoproj.io/secret-type": "cluster", "environment": "dr" },
        },
        spec: { data: { name: "dr-cluster-west", server: "https://dr-cluster-west.example.com:6443" } },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "selector-mismatch-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "The dr-cluster-west secret carries a label `environment: dr` (lowercase\nkey 'environment'). The ApplicationSet's cluster generator selector is a\n`matchExpressions` entry checking the key `env` (not 'environment') is\n'In' ['dr']. These are two different label keys entirely -\n`environment` vs `env` - so the selector never matches this cluster's\nactual label, no matter what its value is. Whoever registered\ndr-cluster-west three weeks ago used a labeling convention\n('environment') that doesn't match what the ApplicationSet was actually\nwritten to select on ('env') two months earlier - the two were authored\nby different people, weeks apart, and nobody cross-checked the exact\nkey name against the generator's selector before assuming registration\nalone would be sufficient.",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl get secret dr-cluster-west -n argocd --show-labels` - list every label key exactly as spelled.",
    "`kubectl get applicationset dr-mirror -n argocd -o yaml` - check the cluster generator's `selector.matchExpressions` key name exactly as spelled, character for character.",
    "A label selector match requires the exact key name to match, not just a semantically similar one - 'environment' and 'env' are two completely different keys as far as Kubernetes selectors are concerned.",
  ],
  options: [
    {
      id: "label-key-mismatch-environment-vs-env",
      label:
        "The cluster secret was registered with the label key `environment: dr`, but the ApplicationSet's cluster generator selector checks for the key `env`, not `environment` - two entirely different label keys, authored weeks apart by different people, so the selector has never matched this cluster regardless of its label's value.",
      explanation:
        "`selector-mismatch-notes` confirms the exact mismatch: the secret carries `environment: dr`, while the generator's `matchExpressions` checks for the key `env`. Kubernetes label selectors match on exact key names - `environment` and `env` are unrelated keys as far as matching is concerned, no matter how similar they look to a human. The generator has never seen this cluster as a match since it was registered, which is why zero Applications were ever generated for it.",
    },
    {
      id: "cluster-not-actually-registered",
      label: "dr-cluster-west was never actually properly registered with ArgoCD despite appearing in cluster list.",
      explanation:
        "`argocd cluster list` showing it registered and reachable, plus the cluster secret existing with the correct `argocd.argoproj.io/secret-type: cluster` label, both confirm registration succeeded correctly - the gap is entirely in the cluster generator's selector not matching this cluster's labels, not in registration itself.",
    },
    {
      id: "appset-controller-excludes-dr-clusters",
      label: "The ApplicationSet controller has special logic that excludes disaster-recovery clusters from generation.",
      explanation:
        "There's no such special-casing in how ApplicationSet cluster generators work - they operate purely on label selector matching against registered cluster secrets, with no concept of a cluster's 'purpose' beyond whatever labels happen to be on it. The exclusion here is fully explained by the label key mismatch, not any DR-specific logic.",
    },
    {
      id: "template-server-field-wrong",
      label: "The template's destination.server field ({{server}}) is referencing the wrong generator output variable.",
      explanation:
        "`{{server}}` is the correct, standard template variable a cluster generator provides for the target cluster's API server address - this would be the right reference *if* the generator ever matched and produced output for dr-cluster-west at all, which it never has, due to the selector never matching in the first place.",
    },
  ],
  correctOptionId: "label-key-mismatch-environment-vs-env",
  resolution: `\`selector-mismatch-notes\` pins down the exact gap: the \`dr-cluster-west\`
secret was registered with the label \`environment: dr\`, but the
ApplicationSet's cluster generator selector checks for the key \`env\`
(\`matchExpressions: [{key: "env", operator: "In", values: ["dr"]}]\`) -
two entirely different label keys. Kubernetes label selectors require
exact key matches; \`environment\` and \`env\` looking similar to a human
reader means nothing to the selector logic. The generator and the cluster
secret were authored weeks apart, by different people, with nobody
cross-checking the exact label key the generator actually selects on
against the label key used when registering the cluster - so the
generator has never once matched this cluster since it was registered,
and zero Applications were ever produced for it.

Fix by correcting the cluster secret's label to match what the generator
actually selects on:

\`\`\`
kubectl label secret dr-cluster-west -n argocd env=dr --overwrite
kubectl label secret dr-cluster-west -n argocd environment-   # remove the mismatched key, optional cleanup
\`\`\`

On the ApplicationSet's next reconciliation, \`dr-cluster-west\` starts
matching the selector and every production service's mirrored Application
gets generated against it - though worth planning that first sync
carefully (a full mirror standing up at once) rather than assuming it's
harmless just because it's "supposed to happen." Longer term, this is a
good case for a documented, single source of truth for cluster-label
conventions (or a linting/validation step comparing new cluster secrets'
labels against every ApplicationSet's generator selectors) - a silent
selector mismatch like this is invisible until someone actually checks
whether the DR mirror is populated, which by definition tends to only
happen during a drill or a real disaster.`,
};
