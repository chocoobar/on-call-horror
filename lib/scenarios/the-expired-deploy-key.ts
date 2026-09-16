import type { Scenario } from "./types";

export const theExpiredDeployKey: Scenario = {
  id: "the-expired-deploy-key",
  title: "The Expired Deploy Key",
  subtitle: "every Application against the reporting-suite repo just went dark at once",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "credentials", "repo-server"],
  briefing: `Three separate Applications - "reports-api", "reports-worker", and
"reports-scheduler" - all pull from the same "reporting-suite" git
repository. This morning, all three simultaneously stopped comparing
successfully, each showing the exact same authentication failure. Nothing
else on the cluster is affected.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-expired-deploy-key", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "git@github.com:example/reporting-suite.git", targetRevision: "main", path: "reports-api" },
          destination: { server: "https://kubernetes.default.svc", namespace: "reports" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Unknown" },
          conditions: [
            {
              type: "ComparisonError",
              message:
                "rpc error: code = Unknown desc = authentication required: Permission denied (publickey). fatal: Could not read from remote repository.",
            },
          ],
        },
        age: "20m",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "repo-reporting-suite",
          namespace: "argocd",
          labels: { "argocd.argoproj.io/secret-type": "repository" },
          annotations: { "rotated-by": "security-bot", "rotation-date": "2026-09-15" },
        },
        spec: {
          data: {
            url: "git@github.com:example/reporting-suite.git",
            sshPrivateKey: "<redacted - regenerated this morning by the security team's automated key rotation>",
          },
        },
        events: [
          { type: "Normal", reason: "SecretRotated", age: "25m", message: "Deploy key rotated by scheduled security rotation job" },
        ],
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-expired-deploy-key -n argocd` - `Permission denied (publickey)` is an SSH auth failure, not a manifest problem.",
    "`kubectl get secret repo-reporting-suite -n argocd -o yaml` - check its annotations for anything that happened recently.",
    "The public half of a rotated SSH key needs to actually be added as a deploy key on the GitHub repo side - rotating the private key locally doesn't do that automatically.",
  ],
  options: [
    {
      id: "rotated-key-not-added-to-github",
      label:
        "A scheduled security rotation replaced the repo's SSH deploy key in ArgoCD's Secret this morning, but the new public key was never added as an authorized deploy key on the GitHub repo side, so every Application using this repo now fails the SSH handshake.",
      explanation:
        "The Secret's own annotations show a rotation happened 25 minutes ago via an automated job, and the comparison error is `Permission denied (publickey)` - a classic symptom of a client presenting a key the server doesn't recognize. All three Applications sharing this one repo credential fail identically and simultaneously, which points straight at the shared credential, not at anything in any individual Application's own manifests.",
    },
    {
      id: "repo-renamed",
      label: "The GitHub repository was renamed or moved.",
      explanation:
        "A renamed/moved repo (assuming no redirect) would typically produce a 'repository not found' style error, not a publickey authentication failure - the error here is specifically about the SSH key not being accepted, not about the repo not existing at the given URL.",
    },
    {
      id: "network-policy-blocks-github",
      label: "A new NetworkPolicy is blocking egress from argocd-repo-server to github.com.",
      explanation:
        "A blocked network path would typically show as a connection timeout or DNS/TCP-level failure, not a `Permission denied (publickey)` response - that message specifically means the connection succeeded and GitHub's SSH server rejected the offered key.",
    },
    {
      id: "targetrevision-branch-deleted-easy",
      label: "The `main` branch was deleted from the repository.",
      explanation:
        "If the branch itself were the problem, the failure would be a 'reference not found' style error after a successful authentication - this fails at the authentication step itself (`Permission denied (publickey)`), before ArgoCD ever gets far enough to ask about a specific branch.",
    },
  ],
  correctOptionId: "rotated-key-not-added-to-github",
  resolution: `The Secret's own annotations show a security team's automated job rotated
the repo's SSH deploy key 25 minutes ago - right before all three
Applications sharing this repo started failing identically with
\`Permission denied (publickey)\`. Rotating the private key that ArgoCD
holds doesn't do anything on its own; the new key's *public* half also
has to be registered as an authorized deploy key on the GitHub repository
itself, and that step was apparently missed (or hasn't propagated yet).
Because all three Applications share the exact same repository Secret,
they all failed at the exact same moment for the exact same reason.

Fix: grab the public key that corresponds to the rotated private key ArgoCD
now holds, and add it as a deploy key on the GitHub repo (read access is
enough for a GitOps pull-only setup):

\`\`\`
ssh-keygen -y -f new-reporting-suite-deploy-key > reporting-suite.pub
# then add reporting-suite.pub under
# github.com/example/reporting-suite → Settings → Deploy keys
\`\`\`

Once GitHub accepts the new key, all three Applications recover their
comparison on the next reconciliation, with no changes needed to any of
them individually - the fix belongs entirely on the shared credential.`,
};
