import type { Scenario } from "../types";

export const theValuesFileThatLost: Scenario = {
  id: "the-values-file-that-lost",
  title: "The Values File That Lost",
  subtitle: "notification-worker's memory limit change never took effect, and nobody can figure out why",
  difficulty: "medium",
  type: "fix",
  topic: "argocd",
  timeMinutes: 20,
  tags: ["argocd", "helm", "values-precedence"],
  briefing: `An engineer raised "notification-worker"'s memory limit in
"values-prod.yaml" last week after a string of OOMKills. The pods are
still getting OOMKilled at the old, lower limit - the file change is
definitely committed and merged, but whatever's actually running doesn't
reflect it.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-values-file-that-lost", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/notification-worker.git",
            targetRevision: "main",
            path: "chart",
            helm: {
              valueFiles: ["values-prod.yaml", "values-region-us.yaml"],
              parameters: [{ name: "resources.limits.memory", value: "256Mi" }],
            },
          },
          destination: { server: "https://kubernetes.default.svc", namespace: "notifications" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "b2c3d4e" }, health: { status: "Healthy" } },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notification-worker-9f8g7h6-k2l3m", namespace: "notifications" },
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "worker", ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } } },
          ],
        },
        previousLogs: { worker: ["OOMKilled - container exceeded memory limit"] },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "helm-precedence-notes", namespace: "notifications" },
        spec: {
          data: {
            "notes.md":
              "The engineer's fix raised `resources.limits.memory` to 1Gi inside\nvalues-prod.yaml, and it's genuinely committed there. But Helm's value\nprecedence order (lowest to highest) is: chart defaults, then each\n`valueFiles` entry in the order listed (later files override earlier\nones), then `--set`/`parameters` last, which always wins over any\nvalues file regardless of order. This Application's\n`spec.source.helm.parameters` includes an explicit\n`resources.limits.memory: 256Mi` override, added months ago for an\nunrelated reason and forgotten about - it silently wins over both values\nfiles' settings every single time, no matter what either of them says.",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl get application the-values-file-that-lost -n argocd -o yaml` - check the full `spec.source.helm` block, not just `valueFiles`.",
    "Helm's precedence order matters: chart defaults, then valueFiles in listed order, then explicit `--set`/`parameters` overrides last - and `parameters` always beats every values file, regardless of file order.",
    "`kubectl get configmap helm-precedence-notes -n notifications -o yaml` for the exact precedence chain and what's actually overriding what.",
  ],
  options: [
    {
      id: "helm-parameters-override-beats-values-file",
      label:
        "An old `spec.source.helm.parameters` override on the Application sets `resources.limits.memory` to 256Mi directly, and Helm parameter overrides always take precedence over every values file regardless of order - so the engineer's fix in values-prod.yaml is completely correct but silently loses to a forgotten override nobody remembered was there.",
      explanation:
        "`helm-precedence-notes` lays out Helm's precedence chain explicitly: chart defaults < valueFiles (in listed order) < parameters, with parameters always winning last. The Application's `spec.source.helm.parameters` includes an explicit `resources.limits.memory: 256Mi` entry, unrelated to and forgotten since before the recent fix - it overrides both values files regardless of their own settings, which is exactly why the committed, merged change in values-prod.yaml never actually takes effect.",
    },
    {
      id: "wrong-values-file-order",
      label: "values-region-us.yaml is listed after values-prod.yaml and is overriding the memory setting back down.",
      explanation:
        "File order among `valueFiles` does matter for values-file-to-values-file precedence, but per the notes, the actual override beating the fix is a `parameters` entry - which always wins over every values file regardless of their internal order. Even reordering the two value files wouldn't fix this, since parameters sit above both in precedence.",
    },
    {
      id: "chart-default-not-overridable",
      label: "The chart's default resources.limits.memory is hardcoded and can't be overridden by values files at all.",
      explanation:
        "Values files are specifically the standard mechanism for overriding a chart's own default values - there's nothing here suggesting the chart hardcodes this value outside the normal Helm values system. The actual override beating the fix is the Application's own `parameters` entry, a different and higher-precedence mechanism.",
    },
    {
      id: "selfheal-reverting-memory-limit",
      label: "selfHeal is reverting the memory limit back to the old value after each sync.",
      explanation:
        "There's no live/git drift here - the fully-rendered manifest (chart defaults, both values files, and the parameters override all combined) genuinely and correctly resolves to 256Mi given everything currently declared across the Application's spec and values files; selfHeal has nothing to revert, because nothing is drifting from what's actually declared.",
    },
  ],
  correctOptionId: "helm-parameters-override-beats-values-file",
  resolution: `\`helm-precedence-notes\` lays out Helm's precedence chain for this
Application: chart defaults, then \`valueFiles\` in listed order, then
\`parameters\` (equivalent to \`--set\`) last - and \`parameters\` always wins
over every values file, no matter what either file says or what order
they're listed in. The engineer's fix, raising \`resources.limits.memory\`
to 1Gi in values-prod.yaml, is genuinely committed and correct - it just
loses every time to a \`spec.source.helm.parameters\` entry on the
Application itself, set to \`256Mi\` months ago for an unrelated reason and
long forgotten. Nothing about this is a sync/drift problem; the rendered
manifest is exactly, correctly what all the inputs (including the
forgotten override) combine to produce.

Fix by removing the stale parameter override, letting the values files
actually take effect:

\`\`\`yaml
spec:
  source:
    helm:
      valueFiles:
        - values-prod.yaml
        - values-region-us.yaml
      # parameters entry for resources.limits.memory removed
\`\`\`

If a per-environment override is still genuinely needed for something,
it belongs in the more discoverable values files (which get reviewed in
PRs) rather than a parameter buried in the Application spec - a
\`parameters\` override like this one is easy to add for a good reason and
just as easy to forget exists later, exactly as happened here.`,
};
