import type { Scenario } from "./types";

export const doubleCounted: Scenario = {
  id: "double-counted",
  title: "Double-Counted",
  subtitle: "the request-rate dashboard says traffic doubled overnight. Nothing else agrees.",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "high-availability", "metrics"],
  briefing: `The main traffic dashboard for "search-api" shows request rate roughly
doubling overnight, which would normally be alarming - except the load
balancer's own access logs, the CDN's own dashboard, and every downstream
dependency's load all say traffic is completely flat. Whatever doubled,
it isn't real traffic.`,
  constraints: [
    "search-api's own pods, CPU, and memory usage are all completely normal and flat overnight - nothing about the service itself changed.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "prometheus-a", namespace: "monitoring", labels: { app: "prometheus-a", ha: "true" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1d",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "prometheus-b", namespace: "monitoring", labels: { app: "prometheus-b", ha: "true" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-ha-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "A second Prometheus instance (`prometheus-b`) was added yesterday for\nhigh availability, scraping the exact same set of targets as the\nexisting `prometheus-a`, independently. Both remote-write their samples\nto the same long-term storage backend used by the dashboard. Neither\ninstance has an `external_labels` value configured to distinguish which\nreplica a given sample came from, and the dashboard's query is a plain\n`sum(rate(http_requests_total[5m]))` with no deduplication.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap prometheus-ha-notes -n monitoring -o yaml` - how many Prometheus instances are now scraping search-api, and what happened yesterday?",
    "When two independent Prometheus instances scrape the exact same target and both write to the same downstream storage with no distinguishing labels, what happens when a query sums across everything in that storage?",
    "`external_labels` exists specifically to tag which Prometheus replica a sample originated from - without it, deduplication has no way to tell 'the same measurement, reported twice' from 'two genuinely different measurements.'",
  ],
  options: [
    {
      id: "second-ha-prometheus-double-scraping",
      label:
        "A second Prometheus instance was added yesterday for HA, scraping the exact same targets as the original and remote-writing to the same storage with no `external_labels` to distinguish the two - the dashboard's plain `sum(rate(...))` query now adds together two independent, unlabeled copies of the same real measurements, making genuinely flat traffic look like it doubled.",
      explanation:
        "`prometheus-ha-notes` confirms both instances scrape identically and write to shared storage with no distinguishing `external_labels`, added exactly the day before the doubling appeared. A `sum()` query has no way to know two samples are duplicate measurements of the same real event rather than two different events - it just adds whatever matches. Every independent signal outside this one dashboard (load balancer logs, CDN dashboard, downstream load, search-api's own CPU/memory) confirms real traffic never changed, which is exactly what's expected if the doubling is an artifact of counting the same requests twice rather than a real change in demand.",
    },
    {
      id: "actual-traffic-spike-not-yet-visible-elsewhere",
      label: "There's a real traffic spike that just hasn't propagated to the other systems' dashboards yet.",
      explanation:
        "Load balancer access logs, CDN dashboards, and downstream dependency load are all independent, typically near-real-time sources that would reflect a genuine doubling of requests immediately, not with a meaningful delay - and search-api's own resource usage staying flat overnight is hard to reconcile with genuinely double the real request volume.",
    },
    {
      id: "cdn-caching-masking-spike",
      label: "The CDN is caching more aggressively, masking a real spike in origin requests from its own dashboard.",
      explanation:
        "This is about search-api's own request-rate metric doubling, which is measured at the application itself, not at the CDN edge - CDN caching behavior wouldn't create phantom requests inside search-api's own instrumented metrics.",
    },
    {
      id: "clock-skew-double-counting-time-windows",
      label: "Clock skew between nodes is causing `rate()` to double-count samples across overlapping time windows.",
      explanation:
        "`rate()`'s windowing is based on sample timestamps recorded by the scraping Prometheus instance itself, not wall-clock skew between arbitrary nodes - a modest clock skew wouldn't produce a clean, sustained doubling, and there's a much simpler, directly evidenced explanation already in front of the data: two independent copies of the same measurements being summed together.",
    },
  ],
  correctOptionId: "second-ha-prometheus-double-scraping",
  resolution: `Every independent signal outside this one Prometheus-fed dashboard - load
balancer access logs, the CDN's own numbers, downstream dependency load,
and search-api's own flat CPU/memory usage - agrees traffic never changed.
\`prometheus-ha-notes\` explains the one thing that did change: a second
Prometheus instance was added the day before, scraping the exact same
targets independently and remote-writing to the same long-term storage
the dashboard queries, with no \`external_labels\` configured on either
instance to mark which replica a given sample came from.

Once two Prometheus instances scrape the same target and land
indistinguishable copies of the same measurements in the same storage, a
plain \`sum(rate(http_requests_total[5m]))\` has no way to recognize
"this sample and that sample are two reports of the same real request" -
it just adds every matching series together, and two identical,
unlabeled copies of the same real traffic sum to what looks exactly like
double the real volume.

The fix is tagging each replica so queries and storage can tell them
apart, and deduplicating using that tag:

\`\`\`yaml
# prometheus-a config
global:
  external_labels:
    replica: a

# prometheus-b config
global:
  external_labels:
    replica: b
\`\`\`

with the long-term storage/query layer configured to deduplicate samples
by matching everything *except* the \`replica\` label (this is exactly what
Thanos/Cortex/Mimir's dedup mechanisms are built to do, given
\`external_labels\` to key off). Once dashboards query deduplicated data
instead of a raw sum across both replicas, the HA setup provides
redundancy the way it's supposed to - without silently doubling every
number that depends on it.`,
};
