import type { Scenario } from "../types";

export const theAdaptiveSamplerBlindSpot: Scenario = {
  id: "the-adaptive-sampler-blind-spot",
  title: "The Adaptive Sampler Blind Spot",
  subtitle: "the one endpoint on booking-api that actually breaks is the one endpoint tracing seems to have given up on",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["tracing", "adaptive-sampling", "jaeger"],
  briefing: `A rare failure mode on booking-api's \`/confirm\` endpoint - roughly 1 in
20,000 requests - has been reported by customers three separate times
this quarter. Every other endpoint on booking-api has plenty of traces
available whenever needed, sampled generously. Searching for a trace of
\`/confirm\` specifically, at any time, for any outcome, turns up almost
nothing - even successful \`/confirm\` traces are strangely rare compared
to how often the endpoint is actually called.`,
  constraints: [
    "booking-api's own request-count metric confirms `/confirm` is called roughly as often as several other endpoints that do have plenty of available traces.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "booking-api", namespace: "bookings", labels: { app: "booking-api" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "jaeger-adaptive-sampling-config", namespace: "observability" },
        spec: {
          data: {
            "sampling-strategies.json":
              '{\n  "default_strategy": { "type": "probabilistic", "param": 1.0 },\n  "per_operation_strategies": {\n    "target_samples_per_second": 1\n  }\n}',
          },
        },
        age: "10mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "adaptive-sampling-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "Jaeger's adaptive sampling continuously adjusts each operation's\nper-operation sampling probability, aiming to keep sampled throughput\nfor that operation near `target_samples_per_second` (here, 1/s) rather\nthan sampling a fixed percentage. `/confirm` is called relatively\ninfrequently compared to booking-api's high-volume read endpoints (like\n`/availability`, called constantly) but roughly as often as several\nmid-volume endpoints that DO have plentiful traces available. The\nadaptive sampler's throughput target is calculated and periodically\nre-balanced *per Jaeger collector instance*, independently, without\ncoordination across the collector fleet - and `/confirm`'s traffic\nhappens to be spread relatively evenly across all booking-api replicas\nand, in turn, across all collector instances, meaning each individual\ncollector sees a low enough per-operation rate for `/confirm`\nspecifically that its computed sampling probability for that one\noperation converges toward being very low, even though the *aggregate*\nrate across all collectors combined is comparable to other, well-traced\noperations.\n",
          },
        },
        age: "10mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap jaeger-adaptive-sampling-config -n observability -o yaml` - what does this sampling strategy actually try to keep constant per operation?",
    "`kubectl get configmap adaptive-sampling-notes -n observability -o yaml` - is the adaptive sampling target calculated globally, or independently per collector instance? How does `/confirm`'s traffic get distributed across collectors compared to other endpoints?",
    "If each collector independently tries to hit a fixed samples-per-second target for an operation, but that operation's real traffic is thinly spread across many collectors rather than concentrated, each collector individually sees a low rate and calculates a very low sampling probability - even if the operation's true aggregate call volume is completely normal.",
  ],
  options: [
    {
      id: "per-collector-adaptive-sampling-under-thin-distributed-traffic",
      label:
        "Jaeger's adaptive sampling calculates each operation's sampling probability independently per collector instance, targeting a fixed samples-per-second rate - since `/confirm`'s traffic is spread relatively evenly across all booking-api replicas and, correspondingly, across all collector instances, each individual collector sees a low per-operation rate for it and converges to a very low sampling probability, even though `/confirm`'s true aggregate call volume across the whole fleet is comparable to other endpoints that do have plenty of traces because their traffic happens to concentrate more per collector.",
      explanation:
        "`jaeger-adaptive-sampling-config` confirms a `target_samples_per_second` adaptive strategy. `adaptive-sampling-notes` explains this target is computed independently per collector instance with no cross-collector coordination, and that `/confirm`'s traffic being thinly and evenly spread across collectors causes each one to individually see a low rate and sample it down aggressively - fully explaining why `/confirm` traces are scarce (both for the rare failures and for ordinary successful requests) despite booking-api's own request-count metric confirming its real aggregate call volume is comparable to other, well-traced endpoints.",
    },
    {
      id: "confirm-endpoint-not-instrumented",
      label: "The `/confirm` endpoint's handler code is missing tracing instrumentation entirely.",
      explanation:
        "If `/confirm` had no tracing instrumentation at all, it would produce zero traces consistently, rather than a small but nonzero number - and the adaptive sampling configuration is confirmed to apply uniformly across all of booking-api's operations, with no indication `/confirm` is specially excluded from instrumentation.",
    },
    {
      id: "jaeger-storage-backend-dropping-confirm-traces",
      label: "Jaeger's storage backend is specifically dropping or failing to persist traces for `/confirm`.",
      explanation:
        "There's no evidence of operation-specific storage failures - the sampling configuration itself, evaluated per collector instance, provides a complete and directly evidenced explanation for why few `/confirm` traces are ever generated in the first place, without needing to assume a separate storage-layer issue for traces that were successfully sampled.",
    },
    {
      id: "confirm-endpoint-traffic-genuinely-low",
      label: "`/confirm` is genuinely called far less often than the other endpoints that have plenty of traces.",
      explanation:
        "booking-api's own request-count metric, an independent signal, directly confirms `/confirm` is called roughly as often as several endpoints that do have plentiful traces available - the real call volume isn't unusually low; what's unusually low is how thinly that volume happens to be distributed across individual collector instances.",
    },
  ],
  correctOptionId: "per-collector-adaptive-sampling-under-thin-distributed-traffic",
  resolution: `\`jaeger-adaptive-sampling-config\` confirms booking-api uses adaptive
sampling with a fixed \`target_samples_per_second\` per operation, rather
than a flat probabilistic rate. \`adaptive-sampling-notes\` explains a
subtlety in how that target actually gets computed: independently, per
Jaeger collector instance, with no coordination across the collector
fleet. \`/confirm\`'s real traffic - confirmed by booking-api's own
request-count metric to be comparable in aggregate to several other,
well-traced endpoints - happens to be spread relatively evenly across all
of booking-api's replicas and, correspondingly, across all collector
instances that receive their spans. Each individual collector, seeing
only its own share of \`/confirm\`'s traffic, calculates a fairly low
per-operation rate and converges its sampling probability for that
operation down accordingly - even though summing across every collector,
the operation's true aggregate volume is nothing unusual. Other
endpoints with plenty of traces simply happen to have traffic patterns
that concentrate more per collector, keeping each individual collector's
computed rate - and therefore its sampling probability - higher.

This is a genuinely subtle interaction: adaptive sampling's per-operation
target is a reasonable idea, but computing and adjusting it independently
per collector, without a shared view of an operation's true aggregate
rate, can systematically under-sample any operation whose traffic happens
to be evenly distributed rather than concentrated - completely
independent of how operationally important that endpoint actually is.

The fix is either enabling Jaeger's cross-collector aggregation for
adaptive sampling calculations (so the target is computed against true
aggregate rate, not each collector's fragment of it) or, more simply,
carving out an explicit minimum sampling floor for business-critical
operations regardless of adaptive sampling's computed rate:

\`\`\`json
{
  "per_operation_strategies": {
    "target_samples_per_second": 1,
    "per_operation_overrides": [
      { "operation": "/confirm", "type": "probabilistic", "param": 0.1 }
    ]
  }
}
\`\`\`

Any operation whose rare-failure debugging value is disproportionate to
its raw call volume - a booking confirmation being the clear example
here - is worth a manually guaranteed sampling floor, rather than trusting
purely adaptive, per-collector sampling to reliably keep it visible.`,
};
