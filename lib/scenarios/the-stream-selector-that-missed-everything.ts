import type { Scenario } from "./types";

export const theStreamSelectorThatMissedEverything: Scenario = {
  id: "the-stream-selector-that-missed-everything",
  title: "The Stream Selector That Missed Everything",
  subtitle: "a Loki query for shipment-tracker's logs from the past week returns nothing, even though the service is clearly running",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["loki", "logql", "logging"],
  briefing: `An engineer trying to debug an intermittent issue on "shipment-tracker"
runs a LogQL query in Grafana Explore for its logs over the past week and
gets nothing back - not a partial result, not an error, a completely
empty result set. `kubectl logs` on any of its pods shows plenty of
recent, normal activity.`,
  constraints: [
    "The Loki cluster itself is confirmed healthy, actively ingesting and serving queries correctly for every other service checked.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipment-tracker", namespace: "logistics", labels: { app: "shipment-tracker" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipment-tracker-5h6i7j8k9-l0m1n", namespace: "logistics", labels: { app: "shipment-tracker" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipment-tracker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipment-tracker": [
            "2026-09-15T12:00:04.221Z INFO c.e.logistics.TrackingSync - synced 214 shipment updates",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "promtail-scrape-config", namespace: "logging" },
        spec: {
          data: {
            "promtail.yaml":
              "scrape_configs:\n  - job_name: kubernetes-pods\n    pipeline_stages:\n      - docker: {}\n    relabel_configs:\n      - source_labels: [__meta_kubernetes_pod_label_app]\n        target_label: app\n      - source_labels: [__meta_kubernetes_namespace]\n        target_label: namespace\n      - source_labels: [__meta_kubernetes_pod_label_app]\n        target_label: service_name\n        regex: 'shipment-tracker'\n        replacement: 'shipment_tracker'\n        action: replace\n        # NOTE: replacement rule added 3 weeks ago, specifically for this\n        # one service, to normalize its label to snake_case for a naming\n        # consistency initiative that only ever got applied to this\n        # single relabel rule before the initiative was shelved.\n",
          },
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "loki-query-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "The engineer's LogQL query was `{app=\"shipment-tracker\", namespace=\"logistics\"}`.\nBecause of the relabel rule, log lines from shipment-tracker's pods are\nactually stored in Loki with BOTH `app=\"shipment-tracker\"` (from the\nfirst, unaffected relabel rule) AND `service_name=\"shipment_tracker\"`\n(underscore) as an *additional* label - the `service_name` relabel\ndoesn't overwrite `app`. This alone wouldn't break the query above... but\na separate, cluster-wide Loki limits change made at the same time caps\nthe number of label *values* Loki will index per label name, and\n`service_name`'s sudden appearance as a new, high-cardinality-adjacent\nlabel (added identically for this one service only, inconsistent with\nevery other service's labeling) pushed the total unique label-set\ncombinations for the `logistics` namespace's stream selector index past\na threshold, causing Loki to silently deprioritize and evict older\nindex entries for streams matching the odd-one-out `app=\"shipment-tracker\"`\ncombination in favor of more consistently-labeled streams, for retention\nof indexed chunks within its query-serving window.\n",
          },
        },
        age: "3w",
      },
    ],
  },
  hints: [
    "`kubectl logs shipment-tracker-5h6i7j8k9-l0m1n -n logistics` - the service is definitely logging. So what does Loki actually have indexed for it?",
    "`kubectl get configmap promtail-scrape-config -n logging -o yaml` - is there anything unusual or inconsistent about how this one service's logs get labeled compared to how every other service is labeled?",
    "`kubectl get configmap loki-query-notes -n logging -o yaml` - what did the label inconsistency, combined with a separate indexing limit, actually do to how Loki keeps this specific stream's data queryable?",
  ],
  options: [
    {
      id: "inconsistent-extra-label-pushed-past-index-limit",
      label:
        "A relabel rule added three weeks ago, unique to shipment-tracker, attaches an additional `service_name` label alongside its normal `app` label - inconsistent with every other service's labeling - and combined with a separate cluster-wide index-limit change, this odd-one-out label combination got deprioritized and evicted from Loki's queryable index in favor of more consistently-labeled streams, even though shipment-tracker's actual log content continues to be ingested and stored, just no longer reliably queryable via the stream selector an engineer would naturally use.",
      explanation:
        "`promtail-scrape-config`'s own comment confirms the `service_name` relabel rule was added uniquely for shipment-tracker three weeks ago and never applied elsewhere. `loki-query-notes` explains the mechanism directly: the resulting inconsistent, additional label combination, combined with a separate indexing-limit change made around the same time, caused Loki to deprioritize this stream's index entries - explaining why `kubectl logs` shows the service is clearly logging normally while a Loki query for the same logs comes back completely empty, despite the Loki cluster itself being confirmed healthy for every other, consistently-labeled service.",
    },
    {
      id: "loki-retention-expired-for-this-namespace",
      label: "Loki's retention policy for the `logistics` namespace has expired and deleted this week's logs.",
      explanation:
        "The Loki cluster is confirmed healthy and correctly serving queries for every other service, including presumably others in the same `logistics` namespace context - a namespace-wide retention expiry would be expected to affect all services there uniformly, not selectively just shipment-tracker's specific label combination.",
    },
    {
      id: "shipment-tracker-writing-to-stdout-incorrectly",
      label: "shipment-tracker's logging library is writing to a location Promtail doesn't actually scrape.",
      explanation:
        "`kubectl logs`, which reads directly from the container's standard log stream that Promtail is configured to tail, shows shipment-tracker's log output clearly and normally - the logs are being written to the correct, scraped location; the issue is what happens to them after Promtail labels and ships them to Loki.",
    },
    {
      id: "grafana-explore-query-syntax-error",
      label: "The engineer's LogQL query has a syntax error, causing it to silently return nothing.",
      explanation:
        "The query shown, `{app=\"shipment-tracker\", namespace=\"logistics\"}`, is valid, standard LogQL stream-selector syntax that would normally work correctly - the evidenced cause is specifically about what got indexed for that label combination, not a malformed query.",
    },
  ],
  correctOptionId: "inconsistent-extra-label-pushed-past-index-limit",
  resolution: `\`promtail-scrape-config\`'s own comment confirms a relabel rule was added
three weeks ago that attaches an additional \`service_name=\"shipment_tracker\"\`
label specifically and only to shipment-tracker's log streams, alongside
its normal \`app=\"shipment-tracker\"\` label - inconsistent with how every
other service in the cluster is labeled. \`loki-query-notes\` explains what
that inconsistency did in combination with a separate, cluster-wide
indexing-limit change made around the same time: the odd-one-out label
combination pushed the \`logistics\` namespace's stream index past a
threshold, and Loki responded by deprioritizing and evicting older index
entries for the inconsistently-labeled stream in favor of more
uniformly-labeled ones competing for the same limited index space.
shipment-tracker's actual log content, confirmed directly via
\`kubectl logs\`, continues to be written and (per the notes) ingested
completely normally - it's specifically no longer reliably indexed in a
way that makes it findable via a normal stream-selector query, which is
why the query returns a clean empty result rather than an error: as far
as Loki's index is concerned, there's genuinely nothing matching that
selector to find right now.

The fix is removing the inconsistent, service-specific relabel rule so
shipment-tracker's streams get labeled the same, predictable way as every
other service - resolving the index pressure this specific inconsistency
was contributing to:

\`\`\`yaml
relabel_configs:
  - source_labels: [__meta_kubernetes_pod_label_app]
    target_label: app
  - source_labels: [__meta_kubernetes_namespace]
    target_label: namespace
  # service_name relabel rule removed - never applied cluster-wide, and
  # its inconsistency was actively harmful to this stream's indexing
\`\`\`

A one-off labeling change made for a single service, never applied
consistently elsewhere, is worth treating with suspicion - it's exactly
the kind of quiet inconsistency that can interact badly with unrelated
system-wide limits in ways that are hard to predict and easy to miss
until a query for "obviously present" logs comes back empty.`,
};
