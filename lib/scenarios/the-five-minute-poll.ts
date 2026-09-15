import type { Scenario } from "./types";

export const theFiveMinutePoll: Scenario = {
  id: "the-five-minute-poll",
  title: "The Five Minute Poll",
  subtitle: "marketing-site deploys eventually, just not when anyone expects",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 10,
  tags: ["argocd", "webhook", "polling"],
  briefing: `Content editors keep asking why their merged changes to "marketing-site"
take "forever" to show up - sometimes instantly, sometimes several minutes
later, with no obvious pattern. Nobody set up anything special for this
Application; it's using whatever ArgoCD does by default.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-five-minute-poll", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/marketing-site.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "marketing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "aa9bb8c" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "webhook-config-notes", namespace: "argocd" },
        spec: {
          data: {
            "notes.md":
              "No webhook has ever been configured on the marketing-site GitHub repo\nfor this ArgoCD instance - checked Settings > Webhooks, empty. This\nApplication has only ever relied on ArgoCD's default background\nreconciliation loop (polls every repo for changes on a fixed interval,\ndefault 3 minutes) to notice new commits.",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "Check whether the marketing-site GitHub repo actually has a webhook configured pointing at this ArgoCD instance.",
    "Without a webhook, ArgoCD falls back to polling every repo on a fixed interval - which explains delays that vary depending on exactly when in that interval a commit lands.",
    "This isn't a bug to fix in the Application's own spec - it's a missing integration between the git host and ArgoCD.",
  ],
  options: [
    {
      id: "no-webhook-relies-on-poll",
      label:
        "No GitHub webhook was ever configured for this repo, so ArgoCD only ever notices new commits through its default background polling loop - explaining delays that range from instant to a few minutes depending on exactly when a commit lands relative to the next poll.",
      explanation:
        "`webhook-config-notes` confirms no webhook exists for this repo. Without one, ArgoCD relies entirely on its default periodic reconciliation loop to discover new commits - a commit landing right before a poll is picked up almost immediately, while one landing right after waits nearly the full interval, exactly matching the 'sometimes instant, sometimes several minutes' pattern being reported.",
    },
    {
      id: "automated-sync-disabled-poll",
      label: "Automated sync is disabled on this Application, so changes only apply when someone manually syncs.",
      explanation:
        "`spec.syncPolicy.automated` is present and enabled - the Application genuinely does auto-sync on its own, on a delay. If automated sync were off, delivery timing wouldn't correlate with anything at all; it would simply never happen without manual intervention.",
    },
    {
      id: "repo-server-overloaded-poll",
      label: "argocd-repo-server is overloaded and can't keep up with comparisons.",
      explanation:
        "There's no indication of repo-server load issues here - no comparison timeouts or errors, just a normal polling-interval delay. An overloaded repo-server would show up as actual comparison failures or consistently long delays, not the instant-to-a-few-minutes range described.",
    },
    {
      id: "targetrevision-wrong-branch-poll",
      label: "targetRevision is pointed at the wrong branch.",
      explanation:
        "The Application is confirmed reaching Synced against the correct new content eventually (per the editors' own reports) - if it were tracking the wrong branch, changes on main would never show up at all, not just show up late.",
    },
  ],
  correctOptionId: "no-webhook-relies-on-poll",
  resolution: `\`webhook-config-notes\` confirms there's no GitHub webhook configured for
this repo pointing at ArgoCD - it's relying entirely on the default
background reconciliation loop, which polls every registered repo on a
fixed interval (3 minutes by default). A commit landing right before the
next scheduled poll gets picked up almost immediately; one landing right
after has to wait nearly the full interval - which is exactly the
"sometimes instant, sometimes minutes" pattern editors are seeing, with no
actual inconsistency in ArgoCD's own behavior.

The fix is adding a webhook so ArgoCD is notified the moment a commit
lands, instead of waiting to discover it on the next poll:

GitHub repo → Settings → Webhooks → Add webhook
  Payload URL: https://argocd.example.com/api/webhook
  Content type: application/json
  Events: just the push event

Once configured, pushes to main trigger an immediate refresh and sync,
and the "several minutes" tail disappears for good - the polling loop
still exists as a fallback, but stops being the primary way changes are
noticed.`,
};
