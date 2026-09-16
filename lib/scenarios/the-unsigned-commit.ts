import type { Scenario } from "./types";

export const theUnsignedCommit: Scenario = {
  id: "the-unsigned-commit",
  title: "The Unsigned Commit",
  subtitle: "compliance-gateway's Application has been quietly ignoring the last four merges",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "gpg-signing", "verification"],
  briefing: `"compliance-gateway" requires GPG-signed commits on main for regulatory
reasons, enforced both at the GitHub branch-protection level and via
ArgoCD's own commit signature verification. Four legitimate, properly-
reviewed and merged PRs over the past week never made it to production -
each one signed and verified fine by GitHub's own UI, yet the Application
never advanced past an older revision.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-unsigned-commit", namespace: "argocd" },
        spec: {
          project: "compliance-project",
          source: { repoURL: "https://github.com/example/compliance-gateway.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "compliance" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          conditions: [
            { type: "ComparisonError", message: "permission denied: revision c8d9e0f is not signed by an allowed GPG key" },
          ],
        },
        age: "4d",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AppProject",
        metadata: { name: "compliance-project", namespace: "argocd" },
        spec: {
          description: "Compliance-critical services, signature-verified sync only",
          sourceRepos: ["*"],
          destinations: [{ namespace: "compliance", server: "https://kubernetes.default.svc" }],
          signatureKeys: [{ keyID: "AABBCCDD11223344" }],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "gpg-key-rotation-notes", namespace: "compliance" },
        spec: {
          data: {
            "notes.md":
              "GitHub's own merge-verification UI shows every one of the last 4\nmerges as 'Verified' - because GitHub validates against whatever GPG\npublic keys individual committers have uploaded to their own GitHub\naccounts, which is a per-committer, GitHub-side check entirely separate\nfrom ArgoCD's own verification. ArgoCD's AppProject-level\n`signatureKeys` independently checks each commit's signature against\nits OWN configured allowlist of key IDs - currently just\nAABBCCDD11223344. The security team rotated to a new organizational\nsigning key 5 days ago and had every engineer re-key their local git\nsigning config with the new key (all 4 recent commits are correctly\nsigned with the NEW key, and that's exactly why GitHub - which trusts\nwhatever key is currently on each committer's account - shows them\nVerified) - but the AppProject's own `signatureKeys` allowlist, a\nseparate, ArgoCD-specific configuration, was never updated to include\nthe new key ID alongside or instead of the old one.",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "GitHub's 'Verified' badge and ArgoCD's own signature verification are two completely separate checks against two potentially different sets of trusted keys - don't assume one implies the other.",
    "`kubectl get appproject compliance-project -n argocd -o yaml` and check `spec.signatureKeys` - what key ID(s) does it actually allow, and when was that list last updated?",
    "`kubectl get configmap gpg-key-rotation-notes -n compliance -o yaml` for what happened to the org's signing key recently.",
  ],
  options: [
    {
      id: "appproject-signaturekeys-not-updated-after-rotation",
      label:
        "The security team rotated to a new organizational GPG signing key 5 days ago, and every engineer correctly re-keyed - which is why GitHub's own per-committer verification shows every recent commit as Verified - but the AppProject's own signatureKeys allowlist, a separate ArgoCD-specific configuration, was never updated to include the new key ID, so ArgoCD's independent verification rejects every commit signed with it.",
      explanation:
        "`gpg-key-rotation-notes` explains the two separate verification systems precisely: GitHub's 'Verified' badge checks against whatever key is currently on a committer's own account (which was correctly updated), while ArgoCD's AppProject-level `signatureKeys` is a completely separate, independently-configured allowlist that still only contains the old key ID. The comparison error names this directly - the revision isn't signed by an allowed key, from ArgoCD's own, un-updated point of view - even though it's genuinely, correctly signed and GitHub-verified with the org's new key.",
    },
    {
      id: "commits-actually-not-signed",
      label: "The four commits genuinely aren't GPG-signed at all, despite what GitHub's UI shows.",
      explanation:
        "GitHub's 'Verified' badge specifically confirms a valid signature was checked against a key on the committer's account - it isn't a UI display quirk. The commits are genuinely signed; the actual gap is that ArgoCD checks against a separate, independently-configured key allowlist that wasn't updated for the new key.",
    },
    {
      id: "branch-protection-bypassed",
      label: "GitHub's branch protection rule requiring signed commits was accidentally disabled.",
      explanation:
        "If branch protection allowing unsigned commits were the issue, GitHub's own UI wouldn't show these commits as 'Verified' - it would show them as unsigned or unverified. GitHub's own signature check is working correctly and passing; the gap is entirely in ArgoCD's separate, independent verification step.",
    },
    {
      id: "repo-server-gpg-keyring-corrupted",
      label: "argocd-repo-server's local GPG keyring became corrupted, causing it to reject all signatures.",
      explanation:
        "A corrupted keyring would typically cause verification failures against every key, including the old one still nominally trusted - the error here is specific and informative ('not signed by an allowed GPG key'), consistent with a correctly-functioning verification process checking against a list that simply doesn't include the new, actually-used key, not a broken keyring.",
    },
  ],
  correctOptionId: "appproject-signaturekeys-not-updated-after-rotation",
  resolution: `\`gpg-key-rotation-notes\` explains the two independent verification layers
at play: GitHub's own "Verified" badge checks a commit's signature
against whatever key is currently registered on the committer's GitHub
account - which the security team correctly updated when they rotated
the org's signing key five days ago, so every recent commit legitimately
shows Verified there. ArgoCD's own signature verification, configured via
the AppProject's \`spec.signatureKeys\`, is a completely separate
allowlist that ArgoCD checks independently - and it was never updated to
include the new key ID alongside (or instead of) the old one. The
comparison error is accurate from ArgoCD's own, outdated point of view:
the commit genuinely isn't signed by any key on *its* allowlist, even
though it's properly signed and GitHub-verified with the organization's
new, current key.

Fix by adding the new key ID to the AppProject's allowlist (keeping the
old one temporarily if any commits still need to verify against it, then
removing it once fully rotated):

\`\`\`yaml
spec:
  signatureKeys:
    - keyID: AABBCCDD11223344   # old key, remove once fully migrated
    - keyID: EEFF00112233 4455 # new key, obtained from the security team's rotation announcement
\`\`\`

Once the new key is allowlisted, ArgoCD's next comparison verifies the
four pending commits successfully and syncs them all at once. Worth
adding "update every AppProject's signatureKeys allowlist" as an explicit
step in the org's GPG key rotation runbook - it's a separate,
easy-to-forget configuration surface from the per-committer keys GitHub
itself checks, and this exact gap will recur on the next rotation
otherwise.`,
};
