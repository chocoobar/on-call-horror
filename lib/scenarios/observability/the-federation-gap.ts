import type { Scenario } from "../types";

export const theFederationGap: Scenario = {
  id: "the-federation-gap",
  title: "The Federation Gap",
  subtitle: "the global capacity dashboard has never once shown data from the eu-central cluster's edge-router fleet",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "federation", "multi-cluster"],
  briefing: `The global capacity-planning dashboard, built by federating metrics from
every regional Prometheus into one central instance, has always shown
data for "edge-router" fleets in every region except "eu-central." The
eu-central Prometheus itself, queried directly, has complete data for its
own edge-router fleet - it's the global view that's missing it, and has
been since federation was set up.`,
  constraints: [
    "eu-central's own local Prometheus instance is confirmed healthy and has always had complete metrics for its edge-router fleet.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "global-prometheus-federation-config", namespace: "monitoring-global" },
        spec: {
          data: {
            "federation.yaml":
              "scrape_configs:\n  - job_name: federate-us-east\n    honor_labels: true\n    metrics_path: /federate\n    params:\n      'match[]': ['{job=~\"edge-router|origin-lb\"}']\n    static_configs: [{ targets: ['prometheus.us-east.internal:9090'] }]\n  - job_name: federate-ap-south\n    honor_labels: true\n    metrics_path: /federate\n    params:\n      'match[]': ['{job=~\"edge-router|origin-lb\"}']\n    static_configs: [{ targets: ['prometheus.ap-south.internal:9090'] }]\n  - job_name: federate-eu-central\n    honor_labels: true\n    metrics_path: /federate\n    params:\n      'match[]': ['{job=~\"edge-router|origin-lb\"}']\n    static_configs: [{ targets: ['prometheus.eu-central.internal:9090'] }]\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "eu-central-job-naming-notes", namespace: "monitoring-eu-central" },
        spec: {
          data: {
            "notes.md":
              "eu-central's edge-router fleet was migrated to a new metrics library 5\nmonths ago as part of a regional infrastructure refresh, and its\nProperties job label changed from `job=\"edge-router\"` to\n`job=\"edgerouter\"` (no underscore, matching a new internal naming\nstandard adopted only in this region so far). The federation `match[]`\nselector everywhere else still targets the original `edge-router` job\nname, which no longer exists in eu-central's local Prometheus at all -\nso the federate scrape for eu-central returns zero series for that job,\nsilently, with no error, while the other two regions (not yet migrated\nto the new naming standard) continue to match and federate correctly.\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap global-prometheus-federation-config -n monitoring-global -o yaml` - what `job` label does the federation `match[]` selector actually look for from each region?",
    "`kubectl get configmap eu-central-job-naming-notes -n monitoring-eu-central -o yaml` - does eu-central's edge-router fleet still use that exact job label locally?",
    "A federate scrape with a `match[]` selector that doesn't match anything in the source Prometheus doesn't error - it just returns zero series for that query, silently, exactly like asking for a metric that was never emitted.",
  ],
  options: [
    {
      id: "job-label-renamed-in-eu-central-only",
      label:
        "eu-central's edge-router fleet was migrated to a new metrics library 5 months ago, renaming its `job` label from `edge-router` to `edgerouter` - a change only made in this region so far - while the global federation config's `match[]` selector everywhere still targets the original `edge-router` name, which no longer exists in eu-central's local Prometheus at all, so the federate scrape for this region silently returns zero matching series while the other two, not-yet-migrated regions continue to match and federate correctly.",
      explanation:
        "`global-prometheus-federation-config` shows every region's federation scrape uses the identical `match[]` selector targeting `job=~\"edge-router|origin-lb\"`. `eu-central-job-naming-notes` confirms eu-central's local job label changed to `edgerouter` (no underscore) five months ago, region-specific and not reflected in the shared federation config - meaning the selector genuinely matches nothing for this job in eu-central's local Prometheus, while it still correctly matches the unrenamed job name in the other two regions, explaining exactly why only eu-central's edge-router data has always been missing from the global view despite being fully present locally.",
    },
    {
      id: "network-connectivity-eu-central-to-global",
      label: "There's a network connectivity issue between the global Prometheus and eu-central's Prometheus specifically.",
      explanation:
        "If connectivity to eu-central's Prometheus were broken, the entire federate scrape for that region - including `origin-lb`, which is confirmed to federate correctly - would fail, not just the `edge-router` portion. Only one specific job's data is missing, which points at a `match[]` selector mismatch rather than a connectivity problem affecting the whole target.",
    },
    {
      id: "eu-central-prometheus-retention-too-short",
      label: "eu-central's local Prometheus retention period is too short to have data available when the global instance federates.",
      explanation:
        "eu-central's own local Prometheus is confirmed to have complete, currently-available edge-router metrics whenever queried directly - retention isn't the issue, since the data genuinely exists locally the whole time; it's specifically never being successfully queried out by the federation scrape's job-name filter.",
    },
    {
      id: "global-prometheus-storage-limit",
      label: "The global Prometheus instance has hit a storage or series limit and is dropping eu-central's data specifically.",
      explanation:
        "There's no indication of a storage or series-limit issue - `origin-lb` data from eu-central federates and stores successfully according to the shared config, which would also be affected by a genuine storage limit on the global instance. Only the specific job whose name changed locally is missing.",
    },
  ],
  correctOptionId: "job-label-renamed-in-eu-central-only",
  resolution: `\`global-prometheus-federation-config\` shows every region uses the identical
federation \`match[]\` selector, \`{job=~"edge-router|origin-lb"}\`, scraped
from each region's local Prometheus via its \`/federate\` endpoint.
\`eu-central-job-naming-notes\` explains the gap: eu-central's edge-router
fleet migrated to a new metrics library five months ago as part of a
regional refresh, and its \`job\` label changed from \`edge-router\` to
\`edgerouter\` - a naming standard adopted only in this region so far. The
shared federation config was never updated to account for it. A
\`match[]\` selector that doesn't match anything in the source Prometheus
doesn't error or warn - the federate scrape for eu-central simply returns
zero series for the \`edge-router\` portion of the match, silently, exactly
as if the metric had never existed there at all. Meanwhile \`origin-lb\`
(unaffected by the rename) and both other regions' still-correctly-named
\`edge-router\` jobs continue to federate normally, which is why the gap
has been isolated to specifically this one job, in specifically this one
region, the entire time.

Federation gaps like this are easy to miss because they fail silently at
every layer - the source Prometheus has the data, the federate scrape
"succeeds" (it just matches nothing), and the global dashboard simply
shows an empty series rather than an error anyone would notice without
comparing region-by-region.

The fix is updating the federation selector to account for both job
names (during a transition) or fully migrating it once every region
completes the naming migration:

\`\`\`yaml
params:
  'match[]': ['{job=~"edge-router|edgerouter|origin-lb"}']
\`\`\`

Any job or metric rename needs a corresponding audit of every recording
rule, alert, dashboard, and - easy to forget - federation config that
references the old name, in every environment that config gets applied
to, not just the one where the rename happened.`,
};
