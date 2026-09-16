import type { Scenario } from "./types";

export const theRelabelRegexThatMissedTheRename: Scenario = {
  id: "the-relabel-regex-that-missed-the-rename",
  title: "The Relabel Regex That Missed The Rename",
  subtitle: "invoice-generator vanished from every dashboard the same week it got renamed from invoice-svc",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["prometheus", "relabeling", "kubernetes-sd"],
  briefing: `A rename of "invoice-svc" to "invoice-generator" - just a label and
Deployment name update, no actual functional change - went out last
week, and every Grafana panel for it has shown "No data" ever since. The
new pods are confirmed Running and Ready, and the service's `/metrics`
endpoint responds normally when checked directly.`,
  constraints: [
    "Every other recently-renamed service in the cluster picked up correctly under its new name with no dashboard interruption.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-generator", namespace: "billing", labels: { app: "invoice-generator" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-scrape-config", namespace: "monitoring" },
        spec: {
          data: {
            "prometheus.yml":
              "scrape_configs:\n  - job_name: kubernetes-pods\n    kubernetes_sd_configs: [{ role: pod }]\n    relabel_configs:\n      - source_labels: [__meta_kubernetes_pod_label_app]\n        regex: '^(invoice-svc|payments-api|search-api)$'\n        action: keep\n        # NOTE: this scrape job uses an explicit allow-list regex of\n        # service names (rather than a generic \"scrape anything with a\n        # prometheus.io/scrape annotation\" pattern) - a legacy approach\n        # from before annotation-based discovery was standardized,\n        # carried forward for this one job because migrating it was\n        # deprioritized. \n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rename-tracking-notes", namespace: "billing" },
        spec: {
          data: {
            "notes.md":
              "invoice-svc was renamed to invoice-generator last week - Deployment\nname, `app` label, and Service name all updated together, functionally\nidentical otherwise. Every other recently-renamed service in the\ncluster is discovered via `kubernetes_sd_configs` with an\nannotation-based keep rule (`prometheus.io/scrape: \"true\"`), which\nautomatically continues working under any new name or label with no\nconfig change needed. This one scrape job is the sole remaining exception\nstill using an explicit allow-list of literal service names in its\n`keep` regex, which still says `invoice-svc` and was never updated to\n`invoice-generator`.\n",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap prometheus-scrape-config -n monitoring -o yaml` - does this scrape job discover targets by annotation, or by an explicit allow-list of service names?",
    "`kubectl get configmap rename-tracking-notes -n billing -o yaml` - is `invoice-generator` anywhere in that allow-list regex?",
    "An explicit allow-list `keep` regex matches literal names, not concepts - renaming a service doesn't automatically update a hardcoded list of the names it used to match.",
  ],
  options: [
    {
      id: "hardcoded-allowlist-regex-still-has-old-name",
      label:
        "This scrape job is the last one still using a hardcoded allow-list regex of literal service names (rather than the annotation-based discovery every other recently-renamed service uses) to decide what to keep, and that regex still says `invoice-svc` - it was never updated to `invoice-generator` after the rename, so pods now labeled `app: invoice-generator` no longer match the `keep` filter and stop being scraped entirely, even though they're healthy and their metrics endpoint works fine when checked directly.",
      explanation:
        "`prometheus-scrape-config`'s own comment confirms this job is a legacy exception still using an explicit name allow-list rather than annotation-based discovery. `rename-tracking-notes` confirms the regex still contains the old name `invoice-svc` and was never updated for the rename, while every other renamed service (using annotation-based discovery) continued working automatically - fully explaining why invoice-generator specifically, and only this specific scrape job's targets, stopped appearing, despite the pods and their metrics endpoint being confirmed healthy.",
    },
    {
      id: "prometheus-caching-old-service-discovery-state",
      label: "Prometheus is caching stale service discovery results from before the rename.",
      explanation:
        "Prometheus Operator/Prometheus itself re-evaluates service discovery continuously and doesn't persistently cache stale target lists across a rename - the far more direct, evidenced cause is a `keep` regex that structurally excludes the new name entirely, which would produce exactly this symptom regardless of any caching behavior.",
    },
    {
      id: "invoice-generator-metrics-port-changed",
      label: "The rename inadvertently changed which port invoice-generator exposes metrics on.",
      explanation:
        "The service's `/metrics` endpoint is confirmed to respond normally when checked directly, meaning the port and endpoint themselves are unaffected - the problem is that Prometheus never attempts to scrape it at all, due to the target being filtered out before scraping is even considered.",
    },
    {
      id: "dashboard-panel-queries-old-job-name",
      label: "The Grafana dashboard's panel queries still reference the old `invoice-svc` job name.",
      explanation:
        "Even if the dashboard's queries were updated to the new name, there would be no data to show either way, because Prometheus itself never scrapes and stores any series for invoice-generator under the current scrape config - the gap exists upstream of anything the dashboard's query could reference.",
    },
  ],
  correctOptionId: "hardcoded-allowlist-regex-still-has-old-name",
  resolution: `\`prometheus-scrape-config\`'s own comment identifies this job as the last
holdout still using an explicit, hardcoded allow-list regex of literal
service names to decide what to scrape, rather than the annotation-based
\`prometheus.io/scrape: "true"\` discovery every other recently-renamed
service relies on. \`rename-tracking-notes\` confirms the rename itself was
clean - Deployment, label, and Service name all updated together - but
this one scrape job's \`keep\` regex, \`^(invoice-svc|payments-api|search-api)$\`,
still contains the old literal name \`invoice-svc\` and was never updated.
Pods now correctly labeled \`app: invoice-generator\` simply don't match
that pattern anymore, so Prometheus's relabeling step drops them before
scraping is even attempted - not because anything about the pods or their
metrics endpoint is broken (both are confirmed healthy directly), but
because they no longer satisfy an allow-list built around a name that no
longer exists.

Every other service that's been renamed recently sailed through without
incident specifically because annotation-based discovery doesn't care
what a service is named - it just checks for the annotation. This one job
being the sole remaining exception, still using name-based filtering, is
exactly why it's the one casualty of an otherwise uneventful rename.

The fix is updating the allow-list to the new name (a short-term patch)
and, better, finally migrating this job to the same annotation-based
discovery pattern everything else uses, so future renames don't require
touching Prometheus config at all:

\`\`\`yaml
relabel_configs:
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    regex: 'true'
    action: keep
\`\`\`

Any scrape config still relying on a hardcoded list of service names is
worth flagging as technical debt - it silently breaks on every future
rename until someone remembers to update it by hand, which is exactly the
kind of thing that's easy to forget in the middle of an otherwise routine
change.`,
};
