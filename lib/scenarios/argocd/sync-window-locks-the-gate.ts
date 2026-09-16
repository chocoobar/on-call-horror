import type { Scenario } from "../types";

export const syncWindowLocksTheGate: Scenario = {
  id: "sync-window-locks-the-gate",
  title: "Sync Window Locks the Gate",
  subtitle: "checkout-api's hotfix merged an hour ago and still hasn't rolled out",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "sync-windows", "automation"],
  briefing: `A hotfix for "checkout-api" merged to main an hour ago. ArgoCD normally
picks up main within a couple minutes, but the Application still shows
the old revision and nobody manually kicked off a sync. Support is asking
why the fix "isn't live yet" even though the PR is long since merged.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "sync-window-locks-the-gate", namespace: "argocd" },
        spec: {
          project: "checkout-project",
          source: { repoURL: "https://github.com/example/checkout-api.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "checkout" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync", revision: "7c1d9e2" },
          health: { status: "Healthy" },
          conditions: [
            { type: "SyncWindowInfo", message: "Sync is not permitted at this time: manual sync required (deny window active)" },
          ],
        },
        age: "1h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AppProject",
        metadata: { name: "checkout-project", namespace: "argocd" },
        spec: {
          description: "Checkout team project",
          sourceRepos: ["*"],
          destinations: [{ namespace: "checkout", server: "https://kubernetes.default.svc" }],
          syncWindows: [
            {
              kind: "deny",
              schedule: "0 0 * * 1-5",
              duration: "24h",
              applications: ["*"],
              manualSync: true,
            },
          ],
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl describe application sync-window-locks-the-gate -n argocd` - the condition mentions a sync window, not a sync error.",
    "`kubectl get appproject checkout-project -n argocd -o yaml` and look at `spec.syncWindows`.",
    "The deny window's schedule and duration span the entire business week - check whether `manualSync` is allowed inside it.",
  ],
  options: [
    {
      id: "deny-window-allows-manual",
      label:
        "A weekday deny sync window on the AppProject is blocking the automated sync, but it explicitly allows manual syncs - so a manual `argocd app sync` gets the hotfix out immediately.",
      explanation:
        "The condition explicitly says a deny window is active and names manual sync as the way around it. The AppProject's `syncWindows` entry is a `deny` window spanning 24h starting at midnight on weekdays with `manualSync: true` - automated sync is blocked, but a manual sync is still permitted through the window.",
    },
    {
      id: "rbac-blocks-sync",
      label: "ArgoCD's RBAC policy is blocking sync operations for this Application.",
      explanation:
        "There's no RBAC-related condition here - the condition is specifically a SyncWindowInfo message about a deny window, which is an AppProject-level schedule restriction, not a permissions problem.",
    },
    {
      id: "repo-unreachable-easy",
      label: "ArgoCD can't reach the git repository to pick up the new commit.",
      explanation:
        "The Application already shows the new revision as OutOfSync (it knows about the commit) - if the repo were unreachable it couldn't have detected the drift between the new revision and live state at all.",
    },
    {
      id: "selfheal-disabled-easy",
      label: "selfHeal is disabled on this Application, so it never auto-syncs.",
      explanation:
        "selfHeal being off would only stop ArgoCD from correcting live drift away from git - it wouldn't stop a normal sync-from-git. Here automated sync itself is being actively blocked by the sync window, per the condition message.",
    },
  ],
  correctOptionId: "deny-window-allows-manual",
  resolution: `The Application's condition says it plainly: "Sync is not permitted at
this time: manual sync required (deny window active)". The AppProject's
\`spec.syncWindows\` has a \`deny\` window running every weekday, 24 hours
long starting at midnight - effectively blocking all automated syncs
during business hours. Critically, the window has \`manualSync: true\`,
which is exactly why an on-call engineer can still push a hotfix through
without waiting for the window to close.

The immediate fix is a manual sync:

\`\`\`
argocd app sync sync-window-locks-the-gate
\`\`\`

Long term, it's worth asking why a checkout-critical Application sits
behind an all-week deny window at all - a narrower window (e.g. only
during a specific maintenance period) or an explicit allow-window for
hotfixes would avoid this exact "why isn't my merged fix live" page in
the future.`,
};
