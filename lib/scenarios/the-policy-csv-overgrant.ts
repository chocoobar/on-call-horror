import type { Scenario } from "./types";

export const thePolicyCsvOvergrant: Scenario = {
  id: "the-policy-csv-overgrant",
  title: "The policy.csv Overgrant",
  subtitle: "an intern's account can delete production Applications it was never supposed to touch",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "rbac", "policy-csv"],
  briefing: `A security review flagged that a read-only "support-tools" SSO group -
meant only to let support staff view Application status for
troubleshooting customer tickets - can actually sync and delete any
Application in the cluster, production included. Nobody remembers
granting that intentionally, and support staff have never even tried
using it, which is the only reason nothing has gone wrong yet.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-rbac-cm", namespace: "argocd" },
        spec: {
          data: {
            "policy.csv":
              "p, role:support-readonly, applications, get, */*, allow\np, role:support-readonly, logs, get, */*, allow\ng, support-tools, role:support-readonly\ng, support-tools, role:admin\n",
            "notes.md":
              "The two `p, role:support-readonly, ...` rules are exactly right and\nintentional - get on applications and logs, nothing more. The problem is\nthe second `g` line: `g, support-tools, role:admin` grants the entire\nsupport-tools SSO group ArgoCD's full built-in admin role (unrestricted\naccess to everything) in addition to the intended read-only role. Git\nblame shows this line was added 4 months ago in the same commit that\nadded the read-only role, likely a copy-paste of a line from a different\nsection meant for the platform-admins group, never caught in review.",
          },
        },
        age: "4mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap argocd-rbac-cm -n argocd -o yaml` - list every `g, support-tools, ...` line, not just the `p, role:support-readonly, ...` ones.",
    "A `g` line in policy.csv grants group membership in a *role* - a group can be granted more than one role, and each additional grant is purely additive (more access, never less).",
    "Check what `role:admin` actually grants in ArgoCD's built-in RBAC model, and whether any line grants it to a group that shouldn't have it.",
  ],
  options: [
    {
      id: "group-also-granted-builtin-admin-role",
      label:
        "Alongside the intentional, correctly-scoped read-only role, a separate `g` line also grants the entire support-tools group ArgoCD's built-in unrestricted admin role - almost certainly a copy-paste error from four months ago that was never caught, since the two roles are purely additive and nobody from support has tried using the extra access yet.",
      explanation:
        "`argocd-rbac-cm`'s notes confirm the `p, role:support-readonly, ...` rules are correctly scoped to `get` only. The actual overgrant is the second `g` line, `g, support-tools, role:admin`, which grants the same group full built-in admin access on top of the intended read-only role - group-to-role grants are additive, so support-tools now effectively has both, with the broader one dominating in practice. Git history points at a copy-paste mistake from four months ago.",
    },
    {
      id: "readonly-role-p-lines-too-broad",
      label: "The `p, role:support-readonly, applications, get, */*, allow` rule itself is overly broad.",
      explanation:
        "That rule only grants the `get` action - it can't be used to sync or delete anything regardless of scope (`*/*` broadens *which* Applications it applies to, not *what* can be done to them). The actual delete/sync capability comes entirely from the separate, unrelated `role:admin` grant, not from this rule being too wide.",
    },
    {
      id: "logs-permission-enables-delete",
      label: "The `logs, get` permission is what's unexpectedly enabling delete access.",
      explanation:
        "ArgoCD RBAC resource types (`applications`, `logs`, `certificates`, etc.) are independent of each other - permission to read logs has no bearing on whether delete or sync actions are allowed on applications. The delete capability traces entirely to the separate admin role grant.",
    },
    {
      id: "sso-group-mapping-typo-overgrant",
      label: "The SSO group name 'support-tools' is a typo that's accidentally matching a different, more privileged group.",
      explanation:
        "Both `g` lines correctly reference the exact same group name, `support-tools` - there's no typo or mismatch causing an unintended group to match. The support-tools group genuinely is granted both roles; the second one is simply the wrong grant to have made.",
    },
  ],
  correctOptionId: "group-also-granted-builtin-admin-role",
  resolution: `\`argocd-rbac-cm\`'s notes confirm the \`p, role:support-readonly, ...\` rules
themselves are correctly scoped to read-only \`get\` access - that part was
never the problem. The actual overgrant is a separate line,
\`g, support-tools, role:admin\`, added four months ago (likely a
copy-paste mistake from a section meant for a different, genuinely
admin-level group) that grants the entire support-tools SSO group
ArgoCD's full built-in admin role on top of the intended read-only one.
Group-to-role grants in policy.csv are purely additive - a group with two
role grants effectively has the union of both, and the broader one
(admin, which allows everything including delete) is what actually
governs in practice.

Fix by removing the erroneous admin grant, leaving only the intended
read-only role:

\`\`\`csv
p, role:support-readonly, applications, get, */*, allow
p, role:support-readonly, logs, get, */*, allow
g, support-tools, role:support-readonly
\`\`\`

Once the \`role:admin\` line is removed, support-tools is scoped back down
to view-only access, matching what was actually intended. Worth a full
audit of every \`g, ...\` line in policy.csv for the same pattern - a
copy-paste mistake in a group-to-role grant is exactly the kind of change
that's easy to make, easy to miss in review, and invisible in practice
until someone either notices it (as here) or actually uses the
unintended access.`,
};
