import type { Scenario } from "./types";

export const theInhibitionRuleThatWentTooFar: Scenario = {
  id: "the-inhibition-rule-that-went-too-far",
  title: "The Inhibition Rule That Went Too Far",
  subtitle: "a genuinely independent database outage never paged, because an unrelated warning happened to be active",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["alertmanager", "inhibition", "paging"],
  briefing: `"analytics-db" went completely unreachable for twenty-five minutes this
morning - confirmed by every dependent service's own connection-error
logs - and the corresponding critical "DatabaseUnreachable" alert is
confirmed to have fired correctly in Alertmanager for the entire window.
Nobody was paged. A separate, low-severity "DiskSpaceWarning" alert for
an entirely unrelated disk happened to already be active on the same
host at the time.`,
  constraints: [
    "DiskSpaceWarning and DatabaseUnreachable are about genuinely unrelated conditions - low disk space on a logging volume, versus the database process itself being unreachable.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alertmanager-config", namespace: "monitoring" },
        spec: {
          data: {
            "alertmanager.yml":
              "inhibit_rules:\n  - source_match:\n      alertname: DiskSpaceWarning\n    target_match_re:\n      alertname: '.*'\n    equal: ['instance']\n    # NOTE: added 8 months ago specifically to stop DiskSpaceWarning from\n    # ALSO triggering a related DiskSpaceCritical alert on the same\n    # instance once it crossed a second threshold - the target_match_re\n    # was written as a broad '.*' wildcard \"to be safe\" rather than\n    # scoped to just DiskSpaceCritical, which nobody caught in review.\n",
          },
        },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inhibition-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "An Alertmanager inhibit_rule suppresses any *target* alert that matches\n`target_match_re` and shares the `equal` labels with an active *source*\nalert - completely regardless of whether the target alert is actually\nrelated to the source alert's underlying cause. This rule's\n`target_match_re: '.*'` matches every alertname, not just\n`DiskSpaceCritical` as originally intended, so any alert at all sharing\nthe same `instance` label as an active `DiskSpaceWarning` gets\nsuppressed - including `DatabaseUnreachable`, entirely unrelated to disk\nspace, simply because it happened to fire on the same host.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap alertmanager-config -n monitoring -o yaml` - look closely at the inhibit rule's `target_match_re`. What was it meant to suppress, and what does it actually match as written?",
    "`kubectl get configmap inhibition-notes -n monitoring -o yaml` - does Alertmanager's inhibition mechanism check whether two alerts are actually related before suppressing one in favor of the other?",
    "An inhibit rule with `target_match_re: '.*'` matches every alertname there is - if it also shares the `equal` labels with the active source alert, it suppresses that alert too, regardless of whether the two conditions have anything to do with each other.",
  ],
  options: [
    {
      id: "overbroad-inhibit-rule-suppresses-unrelated-alert",
      label:
        "An inhibit rule added eight months ago to stop `DiskSpaceWarning` from also triggering a related `DiskSpaceCritical` alert was written with `target_match_re: '.*'` - a wildcard matching every alertname rather than being scoped to just `DiskSpaceCritical` - so any alert sharing the same `instance` label as an active `DiskSpaceWarning` gets suppressed, including the completely unrelated `DatabaseUnreachable` alert that happened to fire on the same host, explaining why a genuine, independently-confirmed database outage never paged anyone despite firing correctly.",
      explanation:
        "`alertmanager-config`'s own comment confirms the rule was meant to suppress only `DiskSpaceCritical` but was written with an unscoped `'.*'` wildcard. `inhibition-notes` explains inhibition doesn't check whether two alerts are actually related - only whether the target matches the pattern and shares the specified labels with the active source. Since `DatabaseUnreachable` shares the `instance` label with the active `DiskSpaceWarning` and matches the `'.*'` pattern, it gets suppressed exactly as any other alertname would, regardless of having nothing to do with disk space - fully explaining why the real, confirmed outage never paged.",
    },
    {
      id: "alertmanager-routing-tree-misconfigured",
      label: "DatabaseUnreachable's routing tree entry is misconfigured, sending it to the wrong receiver.",
      explanation:
        "Inhibited alerts never reach the routing/notification stage at all - they're suppressed earlier in Alertmanager's pipeline. There's no indication the routing tree itself is misconfigured; the alert simply never gets that far because it's being inhibited first.",
    },
    {
      id: "database-unreachable-alert-rule-broken",
      label: "The `DatabaseUnreachable` alert rule itself failed to fire correctly.",
      explanation:
        "The scenario explicitly confirms `DatabaseUnreachable` fired correctly in Alertmanager for the entire outage window - the alert rule and its evaluation both worked as intended; what happened afterward, inside Alertmanager's inhibition logic, is what stopped it from ever becoming a page.",
    },
    {
      id: "silence-covering-both-alerts",
      label: "A silence covering both DiskSpaceWarning and DatabaseUnreachable was active on that host.",
      explanation:
        "There's no silence evidenced here - the suppression mechanism directly confirmed active is an inhibit rule, not a silence. Silences and inhibition are different Alertmanager mechanisms, and the configuration shown is specifically an overly broad inhibit rule triggered by the coincidentally-active DiskSpaceWarning.",
    },
  ],
  correctOptionId: "overbroad-inhibit-rule-suppresses-unrelated-alert",
  resolution: `\`alertmanager-config\`'s own comment explains the inhibit rule's original
intent: stop \`DiskSpaceWarning\` from *also* triggering a related, more
severe \`DiskSpaceCritical\` alert on the same host once a second threshold
was crossed - a reasonable, common inhibition pattern. But it was written
with \`target_match_re: '.*'\`, a wildcard matching literally every
alertname, "to be safe," instead of being scoped specifically to
\`DiskSpaceCritical\`. \`inhibition-notes\` explains Alertmanager's inhibition
mechanism doesn't reason about whether two alerts are actually related -
it purely checks whether a *target* alert matches the configured pattern
and shares the specified \`equal\` labels with an active *source* alert.
\`DatabaseUnreachable\` happened to fire on the same host (sharing the
\`instance\` label) while \`DiskSpaceWarning\` was already active there for
an entirely unrelated disk - and because \`DatabaseUnreachable\` matches
the unscoped \`'.*'\` pattern just like every other alertname would, it got
suppressed right alongside the \`DiskSpaceCritical\` alert the rule was
actually meant to inhibit. The database outage was completely real,
completely correctly detected, and completely silenced by an inhibition
rule that had nothing to do with databases at all.

The fix is scoping the rule to only the target alert it was actually
meant to suppress:

\`\`\`yaml
inhibit_rules:
  - source_match:
      alertname: DiskSpaceWarning
    target_match:
      alertname: DiskSpaceCritical
    equal: ['instance']
\`\`\`

Any inhibit rule using a broad regex like \`'.*'\` for \`target_match_re\` is
worth auditing specifically - it's an easy way to suppress "to be safe"
and end up silencing something completely unrelated that just happens to
share a label with whatever's already active.`,
};
