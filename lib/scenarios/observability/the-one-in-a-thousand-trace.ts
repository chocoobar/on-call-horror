import type { Scenario } from "../types";

export const theOneInAThousandTrace: Scenario = {
  id: "the-one-in-a-thousand-trace",
  title: "The One-In-A-Thousand Trace",
  subtitle: "a rare payment-verification failure has been reported four times this month and traced zero times",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["opentelemetry", "sampling", "tracing"],
  briefing: `A rare, hard-to-reproduce bug in "payment-verification" causes roughly
one in every few thousand requests to silently return a stale
verification result. Four customer reports have come in this month
matching the pattern exactly, each with an approximate timestamp - but
searching Tempo for a trace anywhere near any of those four timestamps
comes up empty every time.`,
  constraints: [
    "payment-verification handles roughly 500,000 requests per day, and the bug is confirmed (via a targeted, temporary debug log added after the fact) to occur at a rate of about 1 in 4,000 requests.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "payment-verification", namespace: "payments", labels: { app: "payment-verification" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 6, availableReplicas: 6 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "otel-sdk-config", namespace: "payments" },
        spec: {
          data: {
            "otel-config.yaml":
              "OTEL_TRACES_SAMPLER: parentbased_traceidratio\nOTEL_TRACES_SAMPLER_ARG: \"0.01\"\n# 1% head-based sampling, applied at request start, before anything\n# about the outcome of the request is known.\n",
          },
        },
        age: "10mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sampling-math-notes", namespace: "payments" },
        spec: {
          data: {
            "notes.md":
              "At 1% head-based sampling, a request has a 1-in-100 chance of being\ntraced at all - decided before the request even starts processing, with\nno knowledge of whether it will hit the rare bug. The bug itself occurs\nat roughly 1-in-4,000 requests. The odds a given buggy request is *also*\none of the sampled 1%: roughly 1-in-400,000 combined. Over a month\n(~15,000,000 requests, ~3,750 occurrences of the bug), the expected\nnumber of *sampled* occurrences of the bug is well under 1 - it's\nunsurprising, not suspicious, that zero have been caught.\n",
          },
        },
        age: "10mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap otel-sdk-config -n payments -o yaml` - what sampling strategy and rate is configured, and is that decision made based on anything about how the request turns out?",
    "`kubectl get configmap sampling-math-notes -n payments -o yaml` - combine the sampling rate with the bug's own occurrence rate. What are the actual odds of catching one on trace?",
    "Head-based sampling decides whether to trace a request before anything about its outcome is known - it has no way to preferentially keep the rare, interesting ones. A low sampling rate multiplied by a low bug-occurrence rate can make 'catching it on trace' astronomically unlikely, without tracing being broken at all.",
  ],
  options: [
    {
      id: "head-sampling-rate-too-low-for-rare-bug",
      label:
        "payment-verification uses 1% head-based (parent-based, trace-ID-ratio) sampling, decided before a request's outcome is known - combined with the bug's own roughly 1-in-4,000 occurrence rate, the odds of any specific buggy request happening to also be one of the randomly sampled 1% are roughly 1 in 400,000, making it statistically unsurprising that zero of the month's few thousand real occurrences were ever caught on trace, even though tracing itself is working correctly.",
      explanation:
        "`otel-sdk-config` confirms 1% head-based sampling with `parentbased_traceidratio`, a decision made at request start with no knowledge of outcome. `sampling-math-notes` does the combined-probability math directly: roughly 1-in-400,000 odds per request of a buggy occurrence also being sampled, and an expected sampled-bug count of well under 1 across the whole month's traffic. This isn't a broken tracing pipeline - it's the expected, if frustrating, consequence of low-probability sampling intersecting with a low-probability bug.",
    },
    {
      id: "tempo-retention-expired",
      label: "Tempo's trace retention period is too short, so traces from a month ago have already expired.",
      explanation:
        "Even for the most recent of the four reports, well within any reasonable retention window, no trace was found - retention expiry would only explain missing traces for the oldest report, not a consistent zero across all four, including recent ones.",
    },
    {
      id: "payment-verification-not-instrumented-for-this-path",
      label: "The specific code path where the bug occurs isn't instrumented with tracing spans at all.",
      explanation:
        "There's no evidence the buggy code path lacks instrumentation specifically - the sampling configuration applies uniformly at the request level before any code path is even reached, which is a sufficient and directly evidenced explanation without needing to assume a separate instrumentation gap.",
    },
    {
      id: "customer-reports-not-actually-correlated",
      label: "The four customer reports don't actually correspond to real occurrences of this specific bug.",
      explanation:
        "The bug's occurrence is independently confirmed via a targeted, temporary debug log added specifically to verify it, at a rate consistent with the customer reports - there's no reason here to doubt the reports are real instances of the confirmed bug.",
    },
  ],
  correctOptionId: "head-sampling-rate-too-low-for-rare-bug",
  resolution: `\`otel-sdk-config\` shows payment-verification samples traces using
\`parentbased_traceidratio\` at \`0.01\` - a flat 1% head-based sampling rate,
decided at the very start of a request, with no way to know yet whether
that request will hit the rare bug. \`sampling-math-notes\` lays out why
that makes catching this specific bug on trace so unlikely: the bug
itself occurs at roughly 1-in-4,000 requests (confirmed via a targeted
debug log added after the fact), and independently, only 1-in-100
requests get traced at all. The combined odds of a given buggy request
also happening to be one of the sampled 1% land around 1-in-400,000 - and
across the month's real traffic and the bug's real occurrence rate, the
expected number of sampled buggy traces is comfortably under one. Zero is
exactly what the math predicts, not evidence something's broken.

Purely random head-based sampling has no way to bias toward "the
interesting ones" - it can't know a request is about to hit a rare bug
before that bug happens. Catching a genuinely rare failure mode on trace
needs either a much higher sampling rate (expensive at this volume) or a
sampling strategy that can react to outcome.

The fix that actually catches this going forward is layering in
tail-based sampling (decided *after* a request completes, when the
outcome - including whether the bug's telltale marker occurred - is
known) at the collector, so error or anomaly-flagged requests are always
kept regardless of the random head-sampling decision:

\`\`\`yaml
processors:
  tail_sampling:
    policies:
      - name: always-keep-stale-verification
        type: string_attribute
        string_attribute:
          key: verification.result_source
          values: ["stale_cache"]
\`\`\`

With a tail-sampling policy tagging and always retaining the specific
condition that marks this bug, the next occurrence gets a trace instead
of joining a queue of reports nobody can ever look into.`,
};
