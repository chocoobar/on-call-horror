import type { Scenario } from "../types";

export const theRegexThatCaughtTooMuch: Scenario = {
  id: "the-regex-that-caught-too-much",
  title: "The Regex That Caught Too Much",
  subtitle: "the staging environment dropdown quietly bled real production numbers into the quarterly review deck",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["grafana", "template-variables", "regex"],
  briefing: `Someone building slides for a quarterly review filters the shared traffic
dashboard to "staging" only, expecting the small, predictable numbers
staging traffic normally produces. Instead the numbers look suspiciously
close to what production usually shows. Nobody remembers staging ever
getting anywhere near that much traffic.`,
  constraints: [
    "Production and staging both run in the same Kubernetes cluster, distinguished only by namespace and an `env` label - not physically separate infrastructure.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout-staging", labels: { app: "checkout-api", env: "staging" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-api", namespace: "checkout", labels: { app: "checkout-api", env: "production" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "traffic-dashboard-template-var", namespace: "monitoring" },
        spec: {
          data: {
            "dashboard.json":
              '{\n  "templating": {\n    "list": [\n      {\n        "name": "environment",\n        "type": "custom",\n        "options": [\n          { "text": "production", "value": "production" },\n          { "text": "staging", "value": "sta.*" }\n        ]\n      }\n    ]\n  },\n  "panels": [\n    {\n      "title": "Requests",\n      "targets": [{ "expr": "sum(rate(http_requests_total{env=~\\"$environment\\"}[5m]))" }]\n    }\n  ]\n}',
          },
        },
        age: "10mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "env-label-values-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "Real `env` label values present in this Prometheus: `production` and\n`staging`. The \"staging\" dropdown option's underlying `value` was typed\nas `sta.*` - meant as a memorable shorthand for \"starts with sta\" but\nnever actually intended as a real regex, just typed carelessly into a\nfield that Grafana happens to treat as a regex whenever used with `=~`.\nAs an actual regex, `sta.*` also happens to match the literal string\n\"production\"? No - but it's used with `=~\\\"$environment\\\"` where\n`$environment` substitutes directly as the raw string; the *dropdown\nlabel* says \"staging\" but the underlying value substituted into the\nquery is literally `sta.*`, and there is no `env` value that starts\nwith \"sta\" besides \"staging\" itself... EXCEPT this cluster also has a\nthird, rarely-used `env` value on a handful of legacy series:\n`stage-prod-mirror`, a rarely-active mirrored replay environment that\nreplays a sample of real production traffic for load-testing purposes -\nwhich also matches `sta.*`, and is the actual source of the\nunexpectedly large numbers.\n",
          },
        },
        age: "10mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap traffic-dashboard-template-var -n monitoring -o yaml` - what's the actual underlying `value` behind the \"staging\" dropdown option, and how is it used in the query?",
    "`kubectl get configmap env-label-values-notes -n monitoring -o yaml` - are there more distinct `env` label values in this Prometheus than just \"production\" and \"staging\"?",
    "A regex like `sta.*` matches any string starting with \"sta\" - if there's a third, less obvious `env` value that also happens to start with those letters, selecting \"staging\" from the dropdown pulls that one in too, silently.",
  ],
  options: [
    {
      id: "staging-dropdown-regex-also-matches-mirror-env",
      label:
        "The \"staging\" dropdown option's underlying value is the regex `sta.*`, used with `=~` in the panel query - it correctly matches the real `staging` env value, but it also matches a third, easy-to-overlook `env` value, `stage-prod-mirror`, used by a rarely-active environment that replays a sample of real production traffic for load-testing, so selecting \"staging\" silently pulls in that mirrored production traffic alongside genuine staging traffic, producing numbers that look suspiciously close to real production.",
      explanation:
        "`traffic-dashboard-template-var` confirms the \"staging\" option's underlying `value` is `sta.*`, used as a regex via `=~\"$environment\"`. `env-label-values-notes` confirms a third `env` value, `stage-prod-mirror`, exists and also matches `sta.*` since it starts with \"sta\" - and that it carries a sample of real production traffic, fully explaining why selecting \"staging\" produced numbers far larger than staging's own genuinely small, predictable traffic, without needing to assume production itself was somehow being queried directly.",
    },
    {
      id: "staging-actually-receiving-production-load",
      label: "Staging is genuinely receiving production-level real user traffic due to a load balancer misconfiguration.",
      explanation:
        "There's no evidence of real user traffic being misrouted to staging - the far more direct and evidenced explanation is a dashboard query regex that inadvertently also matches a separate, legitimate `env` value used specifically for replaying production traffic samples for load testing, which is a monitoring/dashboard-level mixing, not a real routing misconfiguration.",
    },
    {
      id: "grafana-datasource-mixing-clusters",
      label: "Grafana's datasource is somehow querying both a staging and a production Prometheus cluster together.",
      explanation:
        "Production and staging run in the same cluster and are queried through the same single Prometheus/datasource, distinguished only by labels - there's no separate datasource-mixing issue here; the mixing happens entirely within one query's regex label matcher.",
    },
    {
      id: "checkout-api-staging-replica-count-wrong",
      label: "checkout-api's staging Deployment has an unexpectedly high replica count generating real extra load.",
      explanation:
        "checkout-api's staging Deployment is confirmed to run a single replica, consistent with normal staging scale - there's no indication of a scaling misconfiguration inflating real staging traffic; the inflated dashboard numbers come from a query matching an additional, unrelated `env` value, not from staging itself generating more real traffic.",
    },
  ],
  correctOptionId: "staging-dropdown-regex-also-matches-mirror-env",
  resolution: `\`traffic-dashboard-template-var\` shows the "staging" dropdown option's
underlying \`value\` is \`sta.*\`, typed as a quick, memorable shorthand
rather than a deliberately constructed regex - but it's substituted
directly into the panel's query via \`env=~"$environment"\`, where Grafana
treats it as a real regular expression. \`env-label-values-notes\` reveals
the actual environment values present in this Prometheus: not just
\`production\` and \`staging\`, but also a third, easy-to-overlook value,
\`stage-prod-mirror\` - a rarely-active environment that replays a sample of
real production traffic for load-testing purposes. \`sta.*\`, as a regex,
matches any string starting with "sta" - which includes both the
genuinely intended \`staging\` and the unintended \`stage-prod-mirror\`.
Selecting "staging" from the dropdown silently pulls in that mirrored
production traffic sample alongside real staging traffic, which is
exactly why the numbers looked suspiciously close to production's real
scale: because a meaningful share of what was being summed actually *was*
sampled production traffic, just replayed under a different environment
label.

This is an easy trap with regex-based template variable values -
something typed as a shorthand, without realizing it will be evaluated as
a real pattern, can quietly expand to match more than intended the moment
any other label value happens to share a prefix or substring.

The fix is anchoring the regex precisely (or better, not using a regex at
all for an option meant to match exactly one value):

\`\`\`json
{ "text": "staging", "value": "staging" }
\`\`\`

or, if a regex is genuinely needed elsewhere, anchoring it fully:
\`^staging$\`. Any dropdown option value used with \`=~\` is worth treating
as a real regex and checking it against the *complete* current list of
label values, not just the ones it was written with in mind - an
unanchored shorthand can quietly start matching something new the moment
another value happens to share a prefix.`,
};
