import type { Scenario } from "./types";

export const theAnalysisTemplateBadQuery: Scenario = {
  id: "the-analysis-template-bad-query",
  title: "The AnalysisTemplate With a Bad Query",
  subtitle: "every canary rollout for checkout-service aborts at 20%, no matter how clean the release is",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 22,
  tags: ["argocd", "argo-rollouts", "analysistemplate"],
  briefing: `"checkout-service" uses Argo Rollouts for canary deploys, gated by an
AnalysisTemplate that checks error-rate metrics from Prometheus before
promoting past 20% traffic. The last four releases, all confirmed
genuinely healthy by every other signal (logs, manual testing, dashboard
review), have aborted automatically at the 20% canary step with a failed
analysis run.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-analysis-template-bad-query", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/checkout-service.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "checkout" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "a9b8c7d" }, health: { status: "Degraded" } },
        age: "3h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Rollout",
        metadata: { name: "checkout-service", namespace: "checkout" },
        status: {
          phase: "Degraded",
          canary: { currentStepIndex: 1 },
        },
        events: [
          { type: "Warning", reason: "AnalysisRunFailed", age: "5m", message: "analysis run checkout-service-canary-analysis-x7k2 failed: metric 'error-rate' assessed Failed (value 0.008 breached failureCondition)" },
        ],
        age: "3h",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "AnalysisTemplate",
        metadata: { name: "checkout-error-rate", namespace: "checkout" },
        spec: {
          metrics: [
            {
              name: "error-rate",
              interval: "1m",
              successCondition: "result[0] <= 0.05",
              failureCondition: "result[0] > 0.005",
              provider: { prometheus: { query: "sum(rate(http_requests_total{status=~'5..', service='checkout-service'}[1m])) / sum(rate(http_requests_total{service='checkout-service'}[1m]))" } },
            },
          ],
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl get analysistemplate checkout-error-rate -n checkout -o yaml` - compare `successCondition` and `failureCondition` carefully. Do they leave any gap between them?",
    "The failed run's own message reports the actual measured value: 0.008 (0.8% error rate). Is that a genuinely bad error rate for a checkout service, or does it just happen to fall in an odd zone between the two conditions?",
    "successCondition says <= 0.05 (5%) is fine; failureCondition says > 0.005 (0.5%) is a failure - what happens to a real value that's higher than 0.5% but well under 5%?",
  ],
  options: [
    {
      id: "success-and-failure-conditions-gap-mismatch",
      label:
        "successCondition allows anything up to 5% error rate, but failureCondition fails anything above 0.5% - two conditions off by a full order of magnitude from each other, so any genuinely reasonable error rate between 0.5% and 5% (like the observed 0.8%) satisfies neither condition cleanly and gets assessed as Failed, aborting an otherwise healthy canary every time.",
      explanation:
        "The AnalysisTemplate's `successCondition` (`result[0] <= 0.05`, i.e. up to 5%) and `failureCondition` (`result[0] > 0.005`, i.e. above 0.5%) were clearly meant to use the same threshold but don't - one is a full order of magnitude off from the other. The observed 0.008 (0.8%) sits squarely in that mismatched gap: well under the intended 5% success bar, but still above the accidentally strict 0.5% failure bar, so it gets flagged Failed regardless of being a genuinely healthy, normal error rate for the service.",
    },
    {
      id: "prometheus-query-wrong-service-label",
      label: "The Prometheus query is matching the wrong service's metrics due to a label mismatch.",
      explanation:
        "The query's `service='checkout-service'` label matcher is correctly scoped, and the analysis run reports a specific, plausible-looking value (0.008) rather than an empty result or an obviously wrong number from an unrelated service - there's no sign of a label-matching problem here, the issue is in how that correctly-measured value is being judged.",
    },
    {
      id: "canary-step-weight-too-low",
      label: "The 20% canary traffic weight is too low to generate a statistically meaningful sample for analysis.",
      explanation:
        "A too-low sample size could reasonably cause noisy or flaky results, but the actual failure here is completely consistent (deterministic across four separate releases at the same measured range) and traces directly to a specific numeric mismatch between the two conditions - not to noise or insufficient traffic volume.",
    },
    {
      id: "analysisrun-interval-too-short",
      label: "The 1-minute analysis interval is too short to capture a representative error rate.",
      explanation:
        "The interval affects how often the metric is sampled, not the threshold it's judged against - even with a longer interval, the same measured value would still fall into the gap between the mismatched successCondition and failureCondition and be assessed as Failed. The interval isn't what's producing this behavior.",
    },
  ],
  correctOptionId: "success-and-failure-conditions-gap-mismatch",
  resolution: `The AnalysisTemplate's two conditions don't agree with each other:
\`successCondition: result[0] <= 0.05\` (up to 5% error rate is fine) and
\`failureCondition: result[0] > 0.005\` (above 0.5% is a failure) - a full
order of magnitude apart, almost certainly a typo dropping a zero on one
of the two thresholds when the template was written six months ago. Any
real, genuinely acceptable error rate between 0.5% and 5% - like the
observed 0.8% across all four recent releases - fails to cleanly satisfy
either condition and gets assessed as Failed by Argo Rollouts' analysis
evaluation, aborting an otherwise completely healthy canary every single
time.

Fix by aligning both conditions to the same intended threshold:

\`\`\`yaml
spec:
  metrics:
    - name: error-rate
      interval: 1m
      successCondition: "result[0] <= 0.05"
      failureCondition: "result[0] > 0.05"
      provider:
        prometheus:
          query: "sum(rate(http_requests_total{status=~'5..', service='checkout-service'}[1m])) / sum(rate(http_requests_total{service='checkout-service'}[1m]))"
\`\`\`

With both conditions consistently drawing the line at 5%, the next canary
rollout for checkout-service correctly promotes past the 20% step on a
genuinely healthy release, and only aborts on an error rate that
actually crosses the intended threshold. Worth a quick audit of every
other AnalysisTemplate in the org for the same success/failure threshold
mismatch - it's an easy typo to make and, as here, easy for it to go
unnoticed for months if every release since happens to fall in the gap.`,
};
