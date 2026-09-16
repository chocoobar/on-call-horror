import type { Scenario } from "../types";

export const theCreateNamespaceToggle: Scenario = {
  id: "the-create-namespace-toggle",
  title: "The CreateNamespace Toggle",
  subtitle: "a routine sync silently swallowed a security label from prod's namespace",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "namespace", "sync-options"],
  briefing: `"vault-agent-injector" recently had "CreateNamespace=true" added to its
sync options so a fresh install could bootstrap its own namespace without
a manual pre-step. After the next routine sync, security flagged that the
namespace's "pod-security.kubernetes.io/enforce: restricted" label - set
manually months ago and never declared in git - had silently disappeared.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-create-namespace-toggle", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/vault-agent-injector.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "vault-agent" },
          syncPolicy: {
            automated: { prune: true, selfHeal: true },
            syncOptions: ["CreateNamespace=true"],
          },
        },
        status: { sync: { status: "Synced", revision: "e2f3a4b" }, health: { status: "Healthy" } },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "namespace-management-notes", namespace: "vault-agent" },
        spec: {
          data: {
            "notes.md":
              "The `vault-agent` namespace already existed (created manually months\nago, with `pod-security.kubernetes.io/enforce: restricted` added by\nhand at that time and never declared anywhere in git). `CreateNamespace=\ntrue` was added to this Application's syncOptions two days ago purely to\nsupport *future* fresh installs in other clusters - nobody expected it to\naffect this already-existing namespace. In practice, ArgoCD's\nCreateNamespace behavior doesn't just create a namespace if it's\nmissing; when the namespace already exists, ArgoCD applies its own\nminimal managed namespace manifest as a server-side-apply patch against\nit on every sync, which - depending on ArgoCD version and configured\nmanagedNamespaceMetadata - can overwrite existing labels/annotations\nthat aren't declared in the field manager ArgoCD applies with, since\nserver-side-apply reconciles the fields *ArgoCD's own field manager\nowns* to exactly what it declares (nothing here), and a plain,\nunscoped namespace apply from ArgoCD didn't declare `labels` at all -\nwhich some ArgoCD versions treat as 'no opinion, leave alone' and others\nhandle by clearing fields under contested/shared ownership when no\nother manager present in that pass explicitly re-asserts them.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get namespace vault-agent -o yaml` - check `metadata.labels` now versus what security says was manually set months ago.",
    "`CreateNamespace=true` doesn't just create a namespace if it's missing - check what it does when the namespace already exists.",
    "`kubectl get configmap namespace-management-notes -n vault-agent -o yaml` for exactly what changed and why.",
  ],
  options: [
    {
      id: "createnamespace-overwrote-existing-manual-labels",
      label:
        "CreateNamespace=true was added purely to support future fresh installs, but for this already-existing namespace, ArgoCD's own namespace-management apply on each sync doesn't just skip an existing namespace - it applies its own minimal, label-less namespace manifest, which (depending on field-manager semantics) can silently clear manually-set labels that were never declared anywhere for ArgoCD's own apply to preserve.",
      explanation:
        "`namespace-management-notes` confirms the security label was applied manually months ago, never declared in git, and the namespace already existed before `CreateNamespace=true` was added purely for other clusters' future fresh installs. The notes explain the actual mechanism: ArgoCD's namespace management doesn't simply no-op on an existing namespace, it applies its own namespace manifest each sync, and an apply that declares no opinion on `labels` can still result in existing, undeclared labels being dropped under server-side-apply field-manager semantics - exactly matching a label disappearing right after this option was enabled with no explicit change to it anywhere.",
    },
    {
      id: "security-team-removed-label-directly",
      label: "The security team itself removed the label as part of an unrelated policy change.",
      explanation:
        "It's the security team that flagged the label's disappearance as a problem, not something they intentionally did themselves - and the timing lines up precisely with this Application's CreateNamespace option being enabled two days ago, not with any separate security-team action.",
    },
    {
      id: "prune-removed-the-namespace-label",
      label: "Pruning removed the label because it wasn't declared in git.",
      explanation:
        "Pruning deletes whole resources that are no longer declared in git, not individual fields/labels within a resource that's still very much present and managed - the namespace itself wasn't pruned, only one of its labels changed, which points at a namespace-apply/field-management interaction, not prune behavior.",
    },
    {
      id: "namespace-recreated-from-scratch",
      label: "ArgoCD deleted and recreated the namespace entirely, losing everything not in git.",
      explanation:
        "The namespace itself, and everything else in it (all the resources this Application manages), remained intact and continuously available throughout - there's no indication of a delete-and-recreate cycle, which would have caused far more disruption than a single label quietly disappearing.",
    },
  ],
  correctOptionId: "createnamespace-overwrote-existing-manual-labels",
  resolution: `\`namespace-management-notes\` confirms the security label was applied
manually months ago and never declared in git, and that
\`CreateNamespace=true\` was added purely to support *future* fresh
installs elsewhere - nobody expected it to touch this already-existing
namespace at all. The actual mechanism: ArgoCD's namespace management
doesn't simply skip a namespace that already exists once the option is
on - it applies its own namespace manifest on every sync. Since that
manifest doesn't declare any \`labels\` of its own, the resulting
server-side-apply interaction can end up clearing labels that were never
declared for ArgoCD's own field manager to preserve, exactly matching a
label quietly disappearing right after the option was enabled.

The fix is making the label something ArgoCD actually manages and
preserves, rather than something invisible to it - either declare it
explicitly via \`managedNamespaceMetadata\`, or bring the namespace fully
into git:

\`\`\`yaml
spec:
  syncPolicy:
    managedNamespaceMetadata:
      labels:
        pod-security.kubernetes.io/enforce: restricted
    syncOptions:
      - CreateNamespace=true
\`\`\`

This way ArgoCD explicitly declares and re-asserts the label on every
sync instead of leaving it as an undeclared, easily-dropped field. Worth
a broader reminder for the team: anything security- or compliance-
relevant applied manually outside GitOps (like this label) is exactly
the kind of thing that's invisible to ArgoCD and vulnerable to being
silently overwritten by an unrelated, well-intentioned change like
enabling CreateNamespace - it belongs in git or in \`managedNamespaceMetadata\`
explicitly, not as a manual one-off.`,
};
