import type { Scenario } from "./types";

export const theCanaryThatAnalyzedNothing: Scenario = {
  id: "the-canary-that-analyzed-nothing",
  title: "The Canary That Analyzed Nothing",
  subtitle: "every canary for auth-gateway auto-promotes to 100% in about ninety seconds",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "argo-rollouts", "canary"],
  briefing: `"auth-gateway" runs canary deploys via Argo Rollouts, gated by an
AnalysisTemplate checking latency and error-rate metrics before
promoting. A genuinely broken release - one that should have been caught
and rolled back automatically - went straight to 100% traffic in about
ninety seconds instead, well before any meaningful metrics window could
have been evaluated, and stayed there causing real customer impact for
twenty minutes before a human noticed and rolled it back manually.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-canary-that-analyzed-nothing", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/auth-gateway.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "auth" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "e5f6a7b" }, health: { status: "Degraded" } },
        age: "25m",
      },
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Rollout",
        metadata: { name: "auth-gateway", namespace: "auth" },
        spec: {
          strategy: {
            canary: {
              steps: [
                { setWeight: 20 },
                { pause: { duration: "5m" } },
                { analysis: { templates: [{ templateName: "auth-gateway-analysis" }] } },
                { setWeight: 100 },
              ],
            },
          },
        },
        status: { phase: "Degraded", canary: { currentStepIndex: 4 } },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "canary-step-order-notes", namespace: "auth" },
        spec: {
          data: {
            "notes.md":
              "This Rollout's canary steps, in order: setWeight 20%, pause 5 minutes,\nanalysis, setWeight 100%. That step order is exactly correct in\nprinciple - a genuine pause AND an analysis step both exist before full\npromotion. The actual bug: 8 days ago, someone reorganized this Rollout\nspec file for readability (grouping all `setWeight` steps together\nvisually at the top of the YAML with a comment explaining canary\npercentages, then the pause/analysis steps below) - and in doing so,\naccidentally reordered the actual `steps:` LIST ITEMS themselves (not\njust their visual grouping), so the list as committed to git now reads:\nsetWeight 20, setWeight 100, pause 5m, analysis. Argo Rollouts executes\nsteps strictly in the order they appear in the list - it promoted to\n100% as literally the SECOND step, immediately after the initial 20%,\nwith the pause and analysis steps now placed AFTER full promotion\nalready happened, where they still technically 'run' but affect nothing\nsince 100% traffic is already flowing by the time they're reached.",
          },
        },
        age: "8d",
      },
    ],
  },
  hints: [
    "`kubectl get rollout auth-gateway -n auth -o yaml` and read `spec.strategy.canary.steps` as a literal ordered list, top to bottom - not by what a comment or visual grouping nearby suggests it should do.",
    "Argo Rollouts executes canary steps strictly in list order - a pause or analysis step placed after a setWeight 100 step still runs, but by then it's evaluating (or waiting on) an already-fully-promoted rollout.",
    "`kubectl get configmap canary-step-order-notes -n auth -o yaml` for what actually happened during a recent readability-focused reorganization of this file.",
  ],
  options: [
    {
      id: "steps-list-reordered-full-promotion-before-analysis",
      label:
        "A readability-focused reorganization 8 days ago accidentally reordered the Rollout's actual steps list - not just its visual grouping - so setWeight 100 now comes immediately after the initial setWeight 20, with the pause and analysis steps placed after full promotion already happened; Argo Rollouts executes steps strictly in list order, so it promotes to 100% in roughly the time the first step takes, and the pause/analysis steps run too late to gate anything.",
      explanation:
        "`canary-step-order-notes` confirms the steps list as committed genuinely reads setWeight 20, setWeight 100, pause 5m, analysis - not the intended setWeight 20, pause, analysis, setWeight 100. Argo Rollouts has no independent understanding of 'analysis should gate promotion' beyond strict list order execution; it faithfully promoted to 100% as the literal second step, exactly matching the ~90-second full promotion and the pause/analysis steps having no gating effect since they now run after the fact.",
    },
    {
      id: "analysistemplate-thresholds-too-loose",
      label: "The AnalysisTemplate's success thresholds are too loose, letting a genuinely broken release pass.",
      explanation:
        "The analysis step ran, per the Rollout's own step index, well after full promotion had already occurred (currentStepIndex: 4, the final step) - a too-loose threshold would still require the analysis to actually run *before* full promotion to matter, which the step ordering shows it didn't. The gate itself was structurally bypassed by ordering, not evaluated leniently.",
    },
    {
      id: "pause-duration-too-short",
      label: "The 5-minute pause duration is too short to catch a real problem before promoting.",
      explanation:
        "The promotion happened in roughly 90 seconds, well before even a too-short 5-minute pause would have elapsed - the pause step, per its position in the (miscorded) list, runs after full promotion already happened, so its duration setting has no bearing on what actually occurred here.",
    },
    {
      id: "rollouts-controller-skipped-steps",
      label: "The Argo Rollouts controller has a bug causing it to skip steps in the canary process.",
      explanation:
        "No steps were skipped - all four ran, in the order they're actually listed in the committed spec (currentStepIndex reached 4, the final step, meaning every step executed). The controller behaved exactly as designed against the spec it was given; the spec itself has the steps in the wrong order.",
    },
  ],
  correctOptionId: "steps-list-reordered-full-promotion-before-analysis",
  resolution: `\`canary-step-order-notes\` confirms the actual committed \`steps:\` list, as
opposed to its intended visual grouping, reads: setWeight 20, setWeight
100, pause 5m, analysis - reordered by accident during a readability-
focused reorganization 8 days ago that moved list items around while
trying to group them visually by type. Argo Rollouts has no independent
notion of "analysis should gate full promotion" beyond executing the
steps list in the order given; it faithfully promoted straight to 100%
as the literal second step, in roughly the time the first step's
transition takes - explaining both the ~90-second full promotion and why
the pause and analysis steps, now positioned after full promotion, ran
too late to have any gating effect on the incident.

Fix by restoring the correct step order, with promotion genuinely gated
behind the pause and analysis:

\`\`\`yaml
spec:
  strategy:
    canary:
      steps:
        - setWeight: 20
        - pause:
            duration: 5m
        - analysis:
            templates:
              - templateName: auth-gateway-analysis
        - setWeight: 100
\`\`\`

Once the analysis step is back before \`setWeight: 100\`, a genuinely
broken release gets caught and auto-aborted the way it's supposed to.
Worth a broader process fix too: a Rollout's steps list is exactly the
kind of thing that's easy to visually reorganize by accident while trying
to make a file "more readable," and nothing structurally prevents it -
consider a lightweight CI check asserting a canary's final step is always
the full-weight promotion and that an analysis/pause step exists before
it, so a reordering mistake like this fails a PR check instead of
shipping straight to production.`,
};
