import type { Scenario } from "../types";

export const theSamplerThatHatedErrors: Scenario = {
  id: "the-sampler-that-hated-errors",
  title: "The Sampler That Hated Errors",
  subtitle: "customers report failed checkouts, but every trace in Tempo for checkout-flow looks perfectly successful",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["opentelemetry", "tail-sampling", "tracing"],
  briefing: `A handful of customers report failed checkouts over the past two days -
confirmed real by support and by a small but nonzero error-rate metric on
"checkout-flow." Every time someone tries to actually find one of these
failed requests as a trace, they come up empty. Searching Tempo for
error-tagged traces on checkout-flow returns nothing at all for the
entire window.`,
  constraints: [
    "checkout-flow's own error-rate metric (a separate signal from tracing) confirms real, if infrequent, failures throughout the window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "otel-collector-gateway", namespace: "observability", labels: { app: "otel-collector-gateway" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "otel-collector-gateway-config", namespace: "observability" },
        spec: {
          data: {
            "config.yaml":
              "processors:\n  tail_sampling:\n    decision_wait: 10s\n    num_traces: 100000\n    policies:\n      - name: sample-checkout-flow\n        type: probabilistic\n        probabilistic: { sampling_percentage: 2 }\n      - name: sample-everything-else\n        type: always_sample\n",
          },
        },
        age: "5mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tail-sampling-notes", namespace: "observability" },
        spec: {
          data: {
            "notes.md":
              "checkout-flow gets its own dedicated tail-sampling policy - a flat 2%\nprobabilistic policy, applied uniformly regardless of whether a trace\ncontains an error. This was configured to control tracing storage costs\nfor checkout-flow's high volume, and was written before an\n`error-condition` / status-code-aware sampling policy type became\navailable in this Collector version. checkout-flow's real error rate is\naround 0.3% of requests - well under the 2% that get sampled purely by\nchance, meaning the odds of a given error trace happening to be one of\nthe randomly retained 2% are low, and getting several correlated error\nreports without ever catching one in the sample is well within normal\nprobability over a two-day window.\n",
          },
        },
        age: "5mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap otel-collector-gateway-config -n observability -o yaml` - what kind of sampling policy is applied specifically to checkout-flow, and does it treat error traces any differently from successful ones?",
    "`kubectl get configmap tail-sampling-notes -n observability -o yaml` - what's checkout-flow's actual error rate, and what are the odds a specific error request happens to land in a flat 2% random sample?",
    "A purely probabilistic sampling policy doesn't know or care whether a trace it's about to discard contains an error - it discards 98% of everything, successes and failures alike, with no bias toward keeping the interesting ones.",
  ],
  options: [
    {
      id: "probabilistic-policy-has-no-error-bias",
      label:
        "checkout-flow's tail-sampling policy is a flat 2% probabilistic sample with no error-aware exception - since real errors are only about 0.3% of its traffic, the odds of any specific error trace surviving the random 2% sample are low, so over a couple of days it's entirely plausible for every real failure to have been randomly discarded along with the 98% of successful traces, even though the sampler is working exactly as configured.",
      explanation:
        "`otel-collector-gateway-config` shows checkout-flow's dedicated policy is `type: probabilistic` at 2%, with no error-conditional policy applied to it (unlike a hypothetical error-aware policy type). `tail-sampling-notes` confirms this was a cost-driven choice made before an error-aware policy type was available, and that checkout-flow's real error rate (~0.3%) is well under the flat 2% sampling rate - meaning the sampler has no bias toward retaining error traces specifically, and losing every real error to random chance over two days is statistically unsurprising, not evidence errors aren't happening.",
    },
    {
      id: "collector-crashing-on-error-spans",
      label: "The OpenTelemetry Collector crashes or drops spans specifically when it encounters an error status.",
      explanation:
        "The Collector's Deployment is confirmed healthy with no restarts, and there's nothing in its config suggesting special handling that would crash on error spans - the sampling policy applies uniformly to all spans regardless of status, successful or not.",
    },
    {
      id: "checkout-flow-not-instrumented-for-errors",
      label: "checkout-flow's code doesn't actually mark failed spans with an error status at all.",
      explanation:
        "There's no evidence instrumentation is missing error status codes - the issue demonstrated here is about which traces get *retained* at all after tail sampling, not about whether the traces that do get retained are correctly marked as errors or not.",
    },
    {
      id: "tempo-search-index-broken",
      label: "Tempo's search/query index for error-tagged traces is broken.",
      explanation:
        "If error traces were being successfully retained but just failing to be found via search, that would point at Tempo's indexing - but the far more direct explanation, evidenced in the sampling config and error-rate math, is that the error traces are essentially never being retained by the Collector in the first place.",
    },
  ],
  correctOptionId: "probabilistic-policy-has-no-error-bias",
  resolution: `\`otel-collector-gateway-config\` shows checkout-flow has its own dedicated
tail-sampling policy, but it's a flat \`probabilistic\` policy at 2%, with
no condition that treats error traces any differently from successful
ones. \`tail-sampling-notes\` explains how it got that way - it was set up
purely to control tracing storage costs for a high-volume service, before
an error-aware sampling policy type existed in this Collector version -
and does the math on why nobody's caught an error trace: checkout-flow's
real error rate is around 0.3%, well under the 2% random retention rate.
A purely probabilistic sampler has no way to know a trace is "interesting"
because it contains an error; it just keeps roughly 1 in 50 traces,
success or failure alike, entirely by chance.

Over a two-day window with a relatively small number of real failures,
the odds any specific error trace happens to land in that random 2% are
low - and it's entirely consistent with normal probability that not a
single one did, even though the errors themselves (confirmed by the
separate error-rate metric) are genuinely happening. The tracing system
isn't lying or broken; it was configured to intentionally discard almost
everything, without regard for which 2% would turn out to matter most.

The fix is layering an error-aware policy ahead of (or alongside) the
probabilistic one, so error traces are always retained regardless of the
random sample:

\`\`\`yaml
processors:
  tail_sampling:
    policies:
      - name: always-keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: sample-checkout-flow-successes
        type: probabilistic
        probabilistic: { sampling_percentage: 2 }
\`\`\`

Tail-sampling policies built purely to control cost need an explicit
"always keep the interesting ones" rule - error status, unusually high
latency, or specific flagged operations - layered in front of the random
sampling, otherwise a cost-driven sampling rate quietly becomes a policy
of almost never keeping the traces anyone will actually go looking for.`,
};
