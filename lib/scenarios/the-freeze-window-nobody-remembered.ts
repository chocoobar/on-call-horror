import type { Scenario } from "./types";

export const theFreezeWindowNobodyRemembered: Scenario = {
  id: "the-freeze-window-nobody-remembered",
  title: "The Freeze Window Nobody Remembered",
  subtitle: "a critical fix for loyalty-rewards won't sync, manual or automated",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 18,
  tags: ["argocd", "sync-windows", "appproject"],
  briefing: `A critical bug fix for "loyalty-rewards" is merged and ready, but every
sync attempt - automated or manual, from the UI or the CLI - fails
instantly with a permission-style rejection. Nobody on the current on-call
rotation remembers any deploy freeze being announced, and the usual
suspects (RBAC, AppProject destinations) all check out fine.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-freeze-window-nobody-remembered", namespace: "argocd" },
        spec: {
          project: "loyalty-project",
          source: { repoURL: "https://github.com/example/loyalty-rewards.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "loyalty" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          conditions: [
            { type: "SyncWindowInfo", message: "Sync is not permitted at this time: no manual sync allowed (deny window active)" },
          ],
        },
        age: "2h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AppProject",
        metadata: { name: "loyalty-project", namespace: "argocd" },
        spec: {
          description: "Loyalty rewards team project",
          sourceRepos: ["*"],
          destinations: [{ namespace: "loyalty", server: "https://kubernetes.default.svc" }],
          syncWindows: [
            {
              kind: "deny",
              schedule: "0 0 15 9 *",
              duration: "72h",
              applications: ["*"],
              manualSync: false,
            },
          ],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "freeze-window-history-notes", namespace: "loyalty" },
        spec: {
          data: {
            "notes.md":
              "This deny window was added two years ago for an annual September 15\nfinance close/quarterly-reporting freeze, when deploys to loyalty\nsystems were paused for 72 hours as a compliance requirement around\nrewards-balance reconciliation. It's a cron schedule that only fires\nonce a year, so it's easy for a rotating on-call team to have never\npersonally encountered it before - and unlike an ad-hoc freeze, there\nwas no recent announcement about it, since it's a standing, recurring\npolicy rather than a one-off event.",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-freeze-window-nobody-remembered -n argocd` - the condition explicitly mentions a deny window, and this time manual sync isn't permitted either.",
    "`kubectl get appproject loyalty-project -n argocd -o yaml` and check `spec.syncWindows` - specifically the cron schedule and duration.",
    "`kubectl get configmap freeze-window-history-notes -n loyalty -o yaml` for why this window exists and how often it actually fires.",
  ],
  options: [
    {
      id: "annual-compliance-freeze-manualsync-false",
      label:
        "A standing annual deny sync window for a September 15 finance-close compliance freeze is currently active, and unlike a more permissive freeze it has `manualSync: false` - blocking every sync attempt, automated or manual, for its full 72-hour duration - and because it only fires once a year via a cron schedule, it's easy for a rotating on-call team to have simply never encountered it before.",
      explanation:
        "The condition explicitly names a deny window with manual sync also disallowed - a stricter block than a typical deny window. The AppProject's `syncWindows` entry has `manualSync: false` and a cron schedule (`0 0 15 9 *`) matching September 15 with a 72-hour duration. `freeze-window-history-notes` confirms this is a standing annual compliance freeze around rewards-balance reconciliation, not an ad-hoc, recently-announced restriction - exactly why nobody on the current rotation recognized it.",
    },
    {
      id: "rbac-actually-the-cause",
      label: "This is actually an RBAC permissions issue that just happens to look like a sync window problem.",
      explanation:
        "The condition is explicitly typed `SyncWindowInfo` and names a deny window directly, not an RBAC-style permission denial - and the scenario notes RBAC was already checked and ruled out. The AppProject's own `syncWindows` configuration is the confirmed, direct cause.",
    },
    {
      id: "appproject-destinations-changed-freeze",
      label: "The AppProject's destinations list was recently narrowed, blocking this sync.",
      explanation:
        "`spec.destinations` correctly allows the `loyalty` namespace this Application targets - that's not the source of the rejection. The condition and the AppProject's syncWindows entry both point specifically at an active deny window, unrelated to destination restrictions.",
    },
    {
      id: "critical-fix-bypasses-normal-review",
      label: "The fix itself failed a required review gate that's blocking sync.",
      explanation:
        "ArgoCD sync operations aren't gated by an external code-review status at the point of syncing - the manifests are already merged. The rejection is explicitly a SyncWindowInfo condition from the AppProject's own configured deny window, not a review-gate mechanism.",
    },
  ],
  correctOptionId: "annual-compliance-freeze-manualsync-false",
  resolution: `The condition is explicit: a deny window is active and, notably,
\`manualSync\` isn't allowed either - a stricter block than the more common
"deny automated but allow manual" pattern. The AppProject's
\`spec.syncWindows\` entry has a cron schedule (\`0 0 15 9 *\`, matching
September 15) with a 72-hour duration and \`manualSync: false\`.
\`freeze-window-history-notes\` explains why: it's a standing, two-year-old
annual compliance freeze tied to finance close and rewards-balance
reconciliation - a real, deliberate policy, not a mistake, and one that
only fires once a year via cron, which is exactly why a rotating on-call
team had never personally run into it before.

Since the freeze exists for a real compliance reason, the right move
isn't to punch a hole in it unilaterally - it's to follow whatever
exception process exists for genuinely critical fixes during a freeze
(usually a break-glass approval from whoever owns the compliance
requirement), and only widen the window itself if the underlying
constraint no longer applies. If an exception is approved, temporarily
narrowing the window's applications list rather than disabling it
entirely limits the blast radius:

\`\`\`yaml
spec:
  syncWindows:
    - kind: deny
      schedule: "0 0 15 9 *"
      duration: 72h
      applications:
        - "*"
      manualSync: false
    - kind: allow
      schedule: "0 0 15 9 *"
      duration: 72h
      applications:
        - "the-freeze-window-nobody-remembered"
      manualSync: true
\`\`\`

(a narrower \`allow\` window for just this one Application, layered on top
of the broader deny). Longer term, this incident is worth surfacing to
the whole org, not just fixing quietly - a freeze nobody currently
on-call remembers exists is a documentation gap as much as anything else.`,
};
