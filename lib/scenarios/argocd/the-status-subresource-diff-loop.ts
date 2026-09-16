import type { Scenario } from "../types";

export const theStatusSubresourceDiffLoop: Scenario = {
  id: "the-status-subresource-diff-loop",
  title: "The Status Subresource Diff Loop",
  subtitle: "cert-manager-issuer's Application never settles, even though nothing is actually wrong",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "crd", "diff-normalization"],
  briefing: `A custom "ClusterIssuer"-like CRD, "DomainCertPolicy", was added to the
platform last month. Its Application flips between Synced and OutOfSync
every couple of minutes, around the clock - despite nobody touching its
manifests and its actual certificate-issuing behavior working completely
correctly the whole time.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-status-subresource-diff-loop", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/domain-cert-policy.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "cert-system" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } },
        age: "1mo",
      },
      {
        apiVersion: "certs.example.com/v1",
        kind: "DomainCertPolicy",
        metadata: { name: "wildcard-prod", namespace: "cert-system" },
        status: {
          lastIssuedAt: "2026-09-15T09:12:44Z",
          nextRenewalAt: "2026-12-14T09:12:44Z",
          observedGeneration: 3,
        },
        age: "1mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "crd-diff-notes", namespace: "cert-system" },
        spec: {
          data: {
            "notes.md":
              "`argocd app diff` on this Application always shows the exact same kind\nof difference: `status.lastIssuedAt` and `status.nextRenewalAt` fields\npresent live but absent from git (as expected - status subresources\nare never declared in the git manifest for any resource, ArgoCD's\ndefault CRD diffing normally already ignores standard `status` entirely\nfor built-in kinds). This particular CRD's own controller updates\n`status` on every reconciliation pass it makes (roughly every 90\nseconds, for internal bookkeeping unrelated to actual cert issuance),\neach update bumping `metadata.generation`... except this CRD's\nspec/status split is malformed: it was generated without\n`subresources: {status: {}}` declared in the CRD's own schema, meaning\nKubernetes treats `status` as an ordinary top-level field rather than a\ntrue status subresource - which means ArgoCD's normal 'always ignore\nstatus' diffing behavior for CRDs, which specifically relies on\ndetecting a true status subresource, doesn't apply here at all.",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`argocd app diff the-status-subresource-diff-loop` - what specific fields does it flag as different, and do they look like configuration or like runtime status?",
    "`kubectl get crd domaincertpolicies.certs.example.com -o yaml` - check whether `spec.versions[].subresources.status` is actually declared.",
    "ArgoCD normally ignores a CRD's `status` field automatically, but only when Kubernetes itself treats it as a true status subresource - a CRD authored without that subresource declaration doesn't get that automatic treatment.",
  ],
  options: [
    {
      id: "crd-missing-status-subresource-declaration",
      label:
        "The DomainCertPolicy CRD was authored without declaring `subresources: {status: {}}` in its schema, so Kubernetes treats `status` as an ordinary top-level field rather than a true status subresource - which means ArgoCD's normal automatic ignoring of CRD status doesn't apply, and every routine status update from the controller (every ~90 seconds) shows up as real, comparable drift.",
      explanation:
        "`crd-diff-notes` explains the mechanism precisely: ArgoCD's default diffing normally ignores a CRD's `status` field entirely, but only because Kubernetes itself separates it out as a true status subresource - which requires the CRD to explicitly declare `subresources: {status: {}}`. This CRD was generated without that declaration, so `status` is just a regular field from ArgoCD's comparison's point of view, and every one of the controller's routine status bookkeeping updates (lastIssuedAt, nextRenewalAt) becomes a live/git difference ArgoCD dutifully flags, syncs (there's nothing to actually change since it's not in git), and re-flags on the next controller update.",
    },
    {
      id: "controller-fighting-argocd-selfheal",
      label: "The DomainCertPolicy controller and ArgoCD's selfHeal are actively fighting over the resource's fields.",
      explanation:
        "There's no indication either side is reverting the other's changes - the controller updates its own status fields for legitimate bookkeeping, and ArgoCD (attempting to sync status fields that aren't declared in git) has nothing meaningful to actually change, since status fields aren't specified in the manifest to sync toward. This is a comparison/diffing mechanics issue, not a fight over field ownership.",
    },
    {
      id: "wrong-apiversion-domaincertpolicy",
      label: "The Application's manifest uses the wrong apiVersion for the CRD.",
      explanation:
        "The Application successfully applies and compares the resource (it's just perpetually flagged as OutOfSync on status fields) - an apiVersion mismatch would produce a 'no matches for kind' style error rather than a clean apply with a status-field diff.",
    },
    {
      id: "observedgeneration-mismatch-loop",
      label: "observedGeneration is out of sync with metadata.generation, causing ArgoCD to think the resource needs reapplying.",
      explanation:
        "ArgoCD's comparison doesn't key off a resource's own internal observedGeneration convention at all - that's a pattern controllers use to track their own reconciliation progress, unrelated to how ArgoCD diffs live state against git. The actual mechanism is the missing status-subresource declaration in the CRD's own schema.",
    },
  ],
  correctOptionId: "crd-missing-status-subresource-declaration",
  resolution: `\`crd-diff-notes\` explains the exact mechanism: ArgoCD normally ignores a
CRD's \`status\` field automatically during comparison, the same way it
does for built-in Kubernetes kinds - but that automatic behavior relies
on Kubernetes treating \`status\` as a true status subresource, which
requires the CRD's own schema to explicitly declare
\`subresources: {status: {}}\`. The DomainCertPolicy CRD was generated
without that declaration, so from Kubernetes' (and therefore ArgoCD's)
point of view, \`status\` is just an ordinary field like any other. Every
time the controller updates its own bookkeeping fields
(\`lastIssuedAt\`, \`nextRenewalAt\`) - roughly every 90 seconds - ArgoCD
sees a real, comparable difference between live state and git (which
never declares those fields at all) and flags it as drift, syncing (with
nothing actually to change, since git has no opinion on status) and
re-flagging on the controller's next update.

The correct fix is on the CRD itself, adding the missing subresource
declaration:

\`\`\`yaml
# DomainCertPolicy CustomResourceDefinition
spec:
  versions:
    - name: v1
      served: true
      storage: true
      subresources:
        status: {}
\`\`\`

Once Kubernetes treats \`status\` as a true subresource, ArgoCD's default
CRD diffing normalization applies and stops comparing it, ending the
flapping for good. As an immediate stopgap without touching the CRD
schema, an explicit \`ignoreDifferences\` entry works too:

\`\`\`yaml
spec:
  ignoreDifferences:
    - group: certs.example.com
      kind: DomainCertPolicy
      jsonPointers:
        - /status
\`\`\`

but fixing the CRD's schema is the more correct long-term answer, since
it restores ArgoCD's normal, automatic handling for this and any future
status field the controller adds.`,
};
