import type { Scenario } from "./types";

export const thePolicyCsvLockout: Scenario = {
  id: "the-policy-csv-lockout",
  title: "The policy.csv Lockout",
  subtitle: "half the platform team can view Applications but can't sync anything",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "rbac", "policy-csv"],
  briefing: `After a routine RBAC cleanup meant to tighten up who can delete
Applications, several platform engineers report they can still browse and
view every Application in the ArgoCD UI, but every sync attempt fails
with a permission-denied error - including on Applications they've always
been able to deploy.`,
  constraints: [
    "The cleanup's actual goal (restricting delete access to a smaller admin group) should be preserved - don't just revert the whole change.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-rbac-cm", namespace: "argocd" },
        spec: {
          data: {
            "policy.csv":
              "p, role:platform-engineer, applications, get, */*, allow\np, role:platform-engineer, applications, delete, */*, deny\ng, platform-team, role:platform-engineer\n",
            "notes.md":
              "This week's RBAC cleanup added the explicit deny rule for `delete` and\nreorganized the file. Before the cleanup, `role:platform-engineer` had a\nsingle broad rule: `p, role:platform-engineer, applications, *, */*,\nallow` (every applications action, including get/sync/delete). That\nbroad rule was removed and replaced only with the narrow `get` allow and\nthe `delete` deny shown above - the `sync` action (and several others\nlike `override`, `action/*`) were never re-added as their own explicit\nallow rules, so they now fall through to ArgoCD's default-deny.",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap argocd-rbac-cm -n argocd -o yaml` - list every `p, role:platform-engineer, ...` line and note which specific actions each one covers.",
    "ArgoCD RBAC policy is default-deny: an action not explicitly allowed by some rule is denied, even if a broader rule used to cover it before an edit.",
    "The cleanup replaced one broad wildcard rule with narrower rules - check whether every action the old wildcard covered (get, sync, delete, override, action/*, ...) has its own explicit allow now, not just the two that were top of mind (get and delete).",
  ],
  options: [
    {
      id: "wildcard-replaced-missing-sync-allow",
      label:
        "The cleanup replaced a single broad `applications, *, */*, allow` rule with only a narrow `get` allow and an explicit `delete` deny, but never added back an explicit `sync` allow - since ArgoCD RBAC is default-deny, every action that isn't now explicitly allowed (sync included) is silently denied, even though it used to work under the old wildcard rule.",
      explanation:
        "`argocd-rbac-cm`'s notes confirm the old policy had one wildcard `*` action rule covering everything, including sync; the cleanup replaced it with only `get` (allow) and `delete` (deny), and never added `sync` (or other actions like `override`) back explicitly. ArgoCD's RBAC model denies anything not explicitly allowed - engineers can still `get` (view) Applications because that's explicitly allowed, but `sync` now falls through to the default deny, exactly matching 'can view, can't sync'.",
    },
    {
      id: "delete-deny-rule-blocks-sync-too",
      label: "The new `delete` deny rule is being incorrectly applied to sync operations as well.",
      explanation:
        "ArgoCD RBAC rules match on the specific action named in the rule (`delete` here) - a deny rule scoped to `delete` has no effect on a different action like `sync`. The actual gap is that `sync` was never granted an allow rule at all after the wildcard was removed, not that an unrelated deny rule is over-matching.",
    },
    {
      id: "platform-team-group-mapping-broken",
      label: "The `g, platform-team, role:platform-engineer` group mapping is broken, so engineers aren't getting the role at all.",
      explanation:
        "If the group mapping were broken, engineers wouldn't have the `get` permission either - they'd be denied everything, including viewing Applications. Since browsing/viewing works fine, the role is clearly being applied correctly; it's specifically missing a `sync` allow rule.",
    },
    {
      id: "sso-token-scope-missing-sync",
      label: "The engineers' SSO tokens are missing a scope needed for sync operations.",
      explanation:
        "ArgoCD's own policy.csv is what determines authorization once a user is authenticated via SSO - there's no separate SSO-token-scope layer governing individual ArgoCD actions like sync. The RBAC policy file itself, per its own notes, is missing the explicit sync allow rule that used to be covered by the old wildcard.",
    },
  ],
  correctOptionId: "wildcard-replaced-missing-sync-allow",
  resolution: `The notes on \`argocd-rbac-cm\` confirm the mechanism: before this week's
cleanup, \`role:platform-engineer\` had a single broad rule covering every
\`applications\` action via a wildcard. The cleanup correctly tightened
\`delete\` access by replacing that wildcard with narrower rules - but only
added back \`get\` as an explicit allow, never re-adding \`sync\` (or other
actions the old wildcard used to cover, like \`override\` and
\`action/*\`). ArgoCD's RBAC is default-deny: anything not explicitly
allowed by some matching rule is denied, no matter how permissive things
used to be before an edit removed the rule that covered it. Viewing works
because \`get\` is explicitly allowed; syncing doesn't because nothing
allows it anymore.

Fix by adding back the specific actions actually needed, rather than
restoring the original wildcard (preserving the cleanup's real goal of
restricting delete):

\`\`\`csv
p, role:platform-engineer, applications, get, */*, allow
p, role:platform-engineer, applications, sync, */*, allow
p, role:platform-engineer, applications, action/*, */*, allow
p, role:platform-engineer, applications, delete, */*, deny
g, platform-team, role:platform-engineer
\`\`\`

Once \`sync\` is explicitly allowed again, platform engineers regain their
ability to deploy while \`delete\` stays restricted as the cleanup
intended. Worth a full inventory of every action \`role:platform-engineer\`
actually needs day to day before finalizing - a wildcard-to-explicit-list
migration like this is exactly the kind of change where "narrow it down"
easily narrows further than intended.`,
};
