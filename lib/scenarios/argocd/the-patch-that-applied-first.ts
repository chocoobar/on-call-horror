import type { Scenario } from "../types";

export const thePatchThatAppliedFirst: Scenario = {
  id: "the-patch-that-applied-first",
  title: "The Patch That Applied First",
  subtitle: "prod's toleration for the spot-instance nodepool disappeared after a routine overlay update",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "kustomize", "patch-order"],
  briefing: `"batch-processor"'s prod overlay applies two Kustomize patches: one
adding a toleration for the team's spot-instance node pool, and another
(added last week for an unrelated resource-limits tweak) that replaces
the entire pod spec's tolerations array wholesale. Ever since, prod's pods
have stopped scheduling onto spot instances at all, quietly falling back
to (much more expensive) on-demand nodes.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-patch-that-applied-first", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/batch-processor.git", targetRevision: "main", path: "overlays/prod" },
          destination: { server: "https://kubernetes.default.svc", namespace: "batch" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "d5e6f7a" }, health: { status: "Healthy" } },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kustomize-patch-notes", namespace: "batch" },
        spec: {
          data: {
            "kustomization.yaml.excerpt":
              "patches:\n  - path: resource-limits-patch.yaml   # added last week\n  - path: spot-toleration-patch.yaml   # existing, adds spot-instance toleration\n",
            "resource-limits-patch.yaml.excerpt":
              "- op: replace\n  path: /spec/template/spec/tolerations\n  value:\n    - key: dedicated\n      operator: Equal\n      value: batch-processing\n      effect: NoSchedule\n",
            "spot-toleration-patch.yaml.excerpt":
              "- op: add\n  path: /spec/template/spec/tolerations/-\n  value:\n    key: spot-instance\n    operator: Exists\n    effect: NoSchedule\n",
            "notes.md":
              "Kustomize applies `patches` entries strictly in the order listed in\nkustomization.yaml. resource-limits-patch.yaml runs first and *replaces*\nthe entire tolerations array outright with just the `dedicated` entry.\nspot-toleration-patch.yaml runs second and tries to *append* (via\n`tolerations/-`) the spot-instance toleration onto whatever the array\nlooks like at that point - which, after the replace, only contains the\nsingle `dedicated` entry, not the two-entry array the append patch's\nauthor originally wrote it against. The append still succeeds\nmechanically (appending to a 1-element array works fine), but the base's\noriginal tolerations that the replace wiped out - including a separate,\nunrelated `preemptible` toleration entirely unrelated to spot-instance -\nnever intentionally needed removing at all.",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl get deployment batch-processor -n batch -o jsonpath='{.spec.template.spec.tolerations}'` - what's actually in the live tolerations array right now?",
    "`kubectl get configmap kustomize-patch-notes -n batch -o yaml` and read both patch files plus the order they're listed in kustomization.yaml.",
    "Kustomize patches apply strictly in the order listed - a `replace` op on an entire array earlier in the list wipes out anything a later `add`/append patch assumed was still there.",
  ],
  options: [
    {
      id: "replace-patch-runs-before-append-wipes-base",
      label:
        "resource-limits-patch.yaml runs first (per its position in kustomization.yaml's patches list) and replaces the entire tolerations array outright, discarding the base's original toleration content - spot-toleration-patch.yaml then correctly appends its own entry, but onto the already-wiped array, so the resulting live tolerations only ever contain what the replace patch left plus the appended spot-instance entry, silently losing whatever else the base originally had (a separate preemptible toleration among them).",
      explanation:
        "`kustomize-patch-notes` shows the patches list order puts `resource-limits-patch.yaml` (a `replace` on the entire tolerations array) before `spot-toleration-patch.yaml` (an `add`/append). Kustomize applies patches strictly in listed order, so the replace runs first, discarding everything the base declared - including a toleration unrelated to spot instances - and the append patch then adds its own entry onto that already-reduced array. The mechanical append still 'succeeds', but the net tolerations no longer include what the base originally had beyond what the replace explicitly kept.",
    },
    {
      id: "wrong-jsonpath-in-append-patch",
      label: "The append patch's JSON pointer path (/spec/template/spec/tolerations/-) is malformed.",
      explanation:
        "A malformed JSON pointer would cause the patch to fail outright with an apply-time error, visible on the Application - here the patch mechanically succeeds (the spot-instance entry genuinely does get added), the problem is what array it's appending onto by the time it runs, not the pointer syntax itself.",
    },
    {
      id: "base-manifest-missing-tolerations",
      label: "The base manifest never declared any tolerations at all.",
      explanation:
        "The `resource-limits-patch.yaml`'s own `replace` operation targets an existing `tolerations` path and is explicitly a *replace* (not an *add*) - a replace op targeting a path that didn't already exist in the base would typically fail rather than silently succeeding. The base did have tolerations; the replace patch discarded them.",
    },
    {
      id: "argocd-diff-normalization-tolerations",
      label: "ArgoCD's diff normalization is collapsing the tolerations array incorrectly during comparison.",
      explanation:
        "This isn't a comparison/diff-display issue - the live Deployment's actual tolerations array genuinely and correctly (per how the two patches combine) no longer contains the base's original entries. ArgoCD is accurately applying and reporting exactly what the two ordered Kustomize patches produce.",
    },
  ],
  correctOptionId: "replace-patch-runs-before-append-wipes-base",
  resolution: `\`kustomize-patch-notes\` shows the patches list order: \`resource-limits-
patch.yaml\` (added last week, a \`replace\` on the entire \`tolerations\`
array) comes *before* \`spot-toleration-patch.yaml\` (an \`add\`/append) in
kustomization.yaml. Kustomize applies patches strictly in listed order,
so the replace runs first and wipes out the base's entire original
tolerations array, keeping only the single \`dedicated\` entry it
explicitly specifies. The append patch then runs second and does append
its spot-instance entry successfully - but onto that already-reduced
array, not the base's original one. The net result silently drops
whatever the base had beyond what the replace patch kept, including a
separate, unrelated \`preemptible\` toleration that nobody meant to touch
at all.

Fix by reordering the patches so the append runs against the base's
original array before anything replaces it, or better, avoid a wholesale
\`replace\` on a shared array field entirely and use a scoped merge/add
instead:

\`\`\`yaml
# resource-limits-patch.yaml - target the specific entry, not the whole array
- op: replace
  path: /spec/template/spec/tolerations/0
  value:
    key: dedicated
    operator: Equal
    value: batch-processing
    effect: NoSchedule
\`\`\`

That way each patch only touches the specific element it cares about,
regardless of patch ordering, and the spot-instance and preemptible
tolerations the base originally declared survive both patches intact.
Whenever two Kustomize patches touch the same array field, it's worth
double-checking whether one of them replaces the whole thing - that
silently invalidates any assumption a later patch makes about what's
already there.`,
};
