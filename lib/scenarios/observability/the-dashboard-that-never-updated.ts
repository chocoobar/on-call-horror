import type { Scenario } from "../types";

export const theDashboardThatNeverUpdated: Scenario = {
  id: "the-dashboard-that-never-updated",
  title: "The Dashboard That Never Updated",
  subtitle: "three separate engineers have now \"fixed\" the same broken panel on cart-abandonment's dashboard",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["grafana", "gitops", "provisioning"],
  briefing: `A broken panel on "cart-abandonment"'s dashboard - querying a metric name
that was renamed months ago - has been edited and saved directly in the
Grafana UI and fixed at least three separate times by three different
engineers over the past two months. Every time, within a day or so, it's
back to showing the old, broken query again, as if nothing happened.`,
  constraints: [
    "Each engineer independently confirms they successfully saved their fix in the Grafana UI and saw it take effect immediately after saving.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grafana-dashboard-provisioning", namespace: "monitoring" },
        spec: {
          data: {
            "provisioning.yaml":
              "apiVersion: 1\nproviders:\n  - name: git-dashboards\n    type: file\n    disableDeletion: false\n    allowUiUpdates: false\n    updateIntervalSeconds: 30\n    options:\n      path: /var/lib/grafana/dashboards\n      # NOTE: allowUiUpdates: false - Grafana's file-based provisioning\n      # re-reads dashboard JSON from this path every 30 seconds and\n      # overwrites whatever's currently loaded, INCLUDING any changes made\n      # directly in the UI, since UI-originated edits aren't considered\n      # the source of truth when provisioning owns the dashboard.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dashboards-git-repo-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "The actual source-of-truth dashboard JSON lives in the\n\"observability-dashboards\" git repo, synced onto Grafana's pod filesystem\nby a separate sidecar (`git-sync`) that pulls on a schedule. The broken\npanel's query in that repo's checked-in JSON was never fixed - only the\nlive, in-UI version was edited each time, which persists until the next\nprovisioning re-read (within `updateIntervalSeconds`, 30s here, on pod\nrestart, or op the next `git-sync` pull, whichever triggers first),\nafter which the UI reverts to whatever's actually checked into git.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap grafana-dashboard-provisioning -n monitoring -o yaml` - is this dashboard provisioned from a file source, and if so, is `allowUiUpdates` enabled?",
    "`kubectl get configmap dashboards-git-repo-notes -n monitoring -o yaml` - where does the actual source-of-truth dashboard definition live, and was the broken query ever fixed there?",
    "A UI edit to a provisioned dashboard with `allowUiUpdates: false` isn't rejected outright - it appears to save successfully, but the next provisioning re-read silently overwrites it with whatever's still checked into the source file, with no warning that the change won't stick.",
  ],
  options: [
    {
      id: "ui-edits-overwritten-by-file-provisioning",
      label:
        "This dashboard is provisioned from a git-backed file source with `allowUiUpdates: false`, and Grafana re-reads and reapplies the source file every 30 seconds - each engineer's fix, made directly in the Grafana UI, genuinely saved and took effect immediately, but was silently overwritten the next time provisioning re-read the still-broken query from the checked-in JSON in the git repo, which nobody has actually edited, explaining why the same broken panel keeps reappearing no matter how many times it's fixed in the UI.",
      explanation:
        "`grafana-dashboard-provisioning` confirms this dashboard comes from `type: file` provisioning with `allowUiUpdates: false` and a 30-second re-read interval. `dashboards-git-repo-notes` confirms the actual source-of-truth JSON in the git repo still has the broken query, never fixed there - only the live, in-UI version was edited each time. Each engineer's fix genuinely worked and was visible immediately after saving, exactly as they each independently confirmed, but was silently reverted by the very next provisioning re-read, fully explaining the repeated 'un-fixing' with no error or warning to anyone.",
    },
    {
      id: "grafana-caching-old-panel-json",
      label: "Grafana's browser-side caching is showing engineers a stale cached version of the panel.",
      explanation:
        "Each engineer independently confirms their fix took effect immediately after saving, which rules out a simple stale browser cache - the panel genuinely reverts to the broken query over time, consistent with a server-side provisioning re-read overwriting the saved change, not a client-side caching artifact.",
    },
    {
      id: "metric-rename-reverted-multiple-times",
      label: "The underlying metric name keeps getting renamed back and forth by whatever team owns cart-abandonment's metrics.",
      explanation:
        "There's no evidence the underlying metric name itself is changing repeatedly - the renamed metric from months ago is presumably stable; what keeps reverting is specifically the dashboard panel's query text back to referencing the old name, which points at the dashboard's own source of truth rather than the metric's actual current name changing.",
    },
    {
      id: "multiple-people-editing-same-dashboard-race-condition",
      label: "Multiple engineers editing the same dashboard concurrently are overwriting each other's fixes in a race condition.",
      explanation:
        "The fixes happened at different times, roughly a month or more apart based on the described pattern, not concurrently - a genuine concurrent-edit race condition wouldn't explain a fix reliably reverting roughly a day later each time, which is much more consistent with a scheduled provisioning re-read from an unfixed source file.",
    },
  ],
  correctOptionId: "ui-edits-overwritten-by-file-provisioning",
  resolution: `\`grafana-dashboard-provisioning\` shows this dashboard is provisioned from
a file source with \`allowUiUpdates: false\`, re-read every 30 seconds.
\`dashboards-git-repo-notes\` explains where that file actually comes from:
a \`git-sync\` sidecar pulling from the "observability-dashboards" repo on
a schedule, which remains the true source of truth for this dashboard's
definition - and confirms the broken panel's query was never actually
fixed *there*. Each of the three engineers' fixes genuinely worked in the
moment: editing and saving directly in the Grafana UI is allowed to
*appear* to succeed even with \`allowUiUpdates: false\`, and the change is
visible immediately, exactly as each engineer independently confirmed.
But it was never written back to the git repo, which remains the only
thing Grafana's file-based provisioning actually treats as authoritative
- so the very next scheduled re-read (within 30 seconds, or on the next
\`git-sync\` pull, or on pod restart, whichever came first) silently
discarded the UI edit and reloaded the same still-broken query straight
from the unfixed source file. Nothing errors or warns when this happens -
the UI edit simply, quietly, stops being true.

This is a common trap with GitOps-provisioned dashboards: the UI doesn't
clearly signal that changes made there are ephemeral and doomed to be
overwritten, so a fix can look completely successful right up until the
next re-read reverts it, with no obvious link between the two events for
someone not specifically aware how this dashboard is provisioned.

The fix is making the change in the actual source of truth - the git
repo - rather than in the UI:

\`\`\`json
{
  "targets": [{ "expr": "sum(rate(cart_abandonment_events_total[5m]))" }]
}
\`\`\`

committed and pushed to \`observability-dashboards\`, so the next
provisioning re-read picks up the *correct* query instead of reverting to
the broken one. It's worth adding a comment or banner convention to any
UI-edit-disabled provisioned dashboard, or documenting the git repo
prominently, so the next well-meaning engineer doesn't spend an afternoon
re-fixing the same panel a fourth time.`,
};
