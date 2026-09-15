import type { Scenario } from "./types";

export const theAlertThatPagedTheWrongTeam: Scenario = {
  id: "the-alert-that-paged-the-wrong-team",
  title: "The Alert That Paged the Wrong Team",
  subtitle: "database alerts keep waking up the frontend on-call instead of the database team",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["alertmanager", "routing", "prometheus"],
  briefing: `For the last two weeks, every alert with the label \`team: database\` has
been paging the frontend on-call rotation instead of the database team.
The alerts themselves are firing correctly and are genuinely real
problems - they're just reaching the wrong humans every time.`,
  constraints: [
    "The alerts' own labels are confirmed correct at the source (Prometheus) - `team: database` is set correctly on every one of them before Alertmanager ever sees them.",
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
              "route:\n  receiver: default-catchall\n  routes:\n    - match:\n        severity: page\n      receiver: frontend-oncall\n      continue: false\n    - match:\n        team: database\n      receiver: database-oncall\n      continue: false\nreceivers:\n  - name: default-catchall\n  - name: frontend-oncall\n  - name: database-oncall\n",
          },
        },
        age: "2w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "alertmanager-routing-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "A new top-level route matching `severity: page` was added two weeks\nago to make sure every page-severity alert, regardless of team, at\nleast reaches *someone* - it was meant as a temporary catch-all while\nteam-specific routing was still being rolled out, pointed at\nfrontend-oncall as 'whoever's already awake and available.' It was\nsupposed to be removed once every team had its own specific route\nconfigured, which happened for the database team about a week ago - but\nthe catch-all route was never removed.\n\nAlertmanager evaluates `route.routes` in the order they're listed and\nuses the *first* match by default (unless a route sets `continue: true`).\nAll database alerts are labeled both `severity: page` and\n`team: database`.\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap alertmanager-config -n monitoring -o yaml` - read the two routes in the order they're listed. Which one comes first, and does it have `continue: true` or `continue: false`?",
    "Database alerts carry both `severity: page` and `team: database`. Which of the two routes matches first, given the order they're written in?",
    "`kubectl get configmap alertmanager-routing-notes -n monitoring -o yaml` - was the first, broader route always meant to be permanent?",
  ],
  options: [
    {
      id: "catchall-route-matches-first-blocks-specific-route",
      label:
        "A temporary catch-all route matching `severity: page` (routing to frontend-oncall) was added two weeks ago and listed *before* the database team's specific route, with `continue: false` (the default) - since database alerts carry both labels, the broader catch-all matches first and stops evaluation right there, so the more specific `team: database` route underneath it never gets a chance to match at all.",
      explanation:
        "`alertmanager-routing-notes` confirms the catch-all route was meant to be temporary and was supposed to be removed once team-specific routing existed - which it now does for the database team, but the catch-all was never cleaned up. Alertmanager evaluates routes in listed order and stops at the first match unless that route explicitly sets `continue: true` to keep evaluating; the catch-all here uses the default `continue: false`. Every database alert legitimately carries both `severity: page` and `team: database`, so it matches the first, broader route and never gets evaluated against the second, more specific one underneath it - not because the specific route is broken, but because it never gets a chance to run.",
    },
    {
      id: "database-oncall-receiver-misconfigured",
      label: "The `database-oncall` receiver itself has the wrong contact information configured.",
      explanation:
        "The alerts aren't reaching `database-oncall` at all, correctly or incorrectly configured - they're being routed entirely to `frontend-oncall` instead, before `database-oncall`'s route is ever matched against. The receiver's own contact config is never even consulted here.",
    },
    {
      id: "prometheus-not-setting-team-label",
      label: "Prometheus isn't actually setting the `team: database` label on these alerts.",
      explanation:
        "The `team: database` label is confirmed correctly set on every alert at the source, before Alertmanager processes it at all - the labels arriving at Alertmanager are correct; what's wrong is which route those correct labels end up matching.",
    },
    {
      id: "alertmanager-not-reloaded",
      label: "Alertmanager hasn't reloaded its configuration since the database team's route was added.",
      explanation:
        "The database-specific route is confirmed present in the current, active configuration - this isn't about a route being missing or not yet loaded, it's about a different route earlier in the list matching first and preventing the present, correctly-loaded database route from ever being reached.",
    },
  ],
  correctOptionId: "catchall-route-matches-first-blocks-specific-route",
  resolution: `Alertmanager's routing tree is evaluated top to bottom, and by default
stops at the *first* matching route (\`continue: false\`) - a route only
keeps falling through to the next one if it explicitly sets
\`continue: true\`. \`alertmanager-routing-notes\` explains how this
configuration ended up broken: a broad, intentionally-temporary catch-all
matching any \`severity: page\` alert was added two weeks ago specifically
to make sure paging alerts reached *someone* while team-specific routing
was still being built out. It was meant to be removed once every team had
its own route - which happened for the database team about a week ago -
but nobody removed the catch-all afterward.

Every database alert legitimately carries both \`severity: page\` (making
it match the catch-all) and \`team: database\` (making it match the
specific route below). Since the catch-all is listed first and doesn't
set \`continue: true\`, it wins every time, and the more specific
\`team: database\` route underneath it never gets evaluated at all - not
because it's misconfigured, but because routing never reaches it.

The fix is either reordering so specific routes are evaluated before the
catch-all, or removing the now-obsolete catch-all entirely now that every
team has real routing:

\`\`\`yaml
route:
  receiver: default-catchall
  routes:
    - match: { team: database }
      receiver: database-oncall
      continue: false
    - match: { severity: page }     # now genuinely a last-resort catch-all
      receiver: frontend-oncall
      continue: false
\`\`\`

Any "temporary" broad route added ahead of more specific ones needs a
tracked removal step once the specific routes it was standing in for
actually exist - otherwise, by design, it keeps winning forever, silently
and correctly, exactly as routing-tree evaluation order says it should.`,
};
