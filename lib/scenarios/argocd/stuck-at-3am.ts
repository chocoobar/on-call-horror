import type { Scenario } from "../types";

export const stuckAt3am: Scenario = {
  id: "stuck-at-3am",
  title: "Stuck at 3AM",
  subtitle: "ArgoCD Application won't sync",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 15,
  tags: ["argocd", "sync", "gitops"],
  briefing: `PagerDuty just paged you. The on-call handoff notes say the "stuck-at-3am"
Application was working fine yesterday, but someone made a "small" edit to
its ArgoCD Application manifest before going to bed, and now it's stuck.

The team's checkout-api source lives in a git repo whose default branch is
"main", under a top-level "manifests/" directory. Whatever changed, ArgoCD
can no longer find what it's supposed to sync - nothing has even been
deployed to the "shop" namespace yet.`,
  constraints: [
    "Nothing about the app's own manifests is wrong - the Application definition is what's broken.",
  ],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "stuck-at-3am", namespace: "argocd" },
        spec: {
          project: "default",
          source: {
            repoURL: "https://github.com/example/checkout-api.git",
            targetRevision: "master",
            path: "manifest",
          },
          destination: {
            server: "https://kubernetes.default.svc",
            namespace: "shop",
          },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Unknown" },
          health: { status: "Missing" },
          conditions: [
            {
              type: "ComparisonError",
              message:
                "Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = git ls-remote --symref origin master failed: exit status 128: fatal: couldn't find remote ref master",
            },
          ],
        },
        events: [
          {
            type: "Warning",
            reason: "ComparisonError",
            age: "58m",
            message: "git ls-remote --symref origin master failed: fatal: couldn't find remote ref master",
          },
        ],
        age: "1h",
      },
    ],
  },
  hints: [
    "Start with `kubectl describe application stuck-at-3am -n argocd` and read the condition message closely - it names exactly which git ref ArgoCD tried and failed to find.",
    "The briefing told you the repo's real default branch and real manifests directory. Compare those against `spec.source.targetRevision` and `spec.source.path` on the Application.",
    "Two things are wrong at once: the branch name (master vs main) and the path (manifest vs manifests). Both need to change for this to ever sync.",
  ],
  options: [
    {
      id: "wrong-image",
      label: "The nginx image tag referenced by the Deployment doesn't exist in the registry.",
      explanation:
        "There's no image pull problem here - no Deployment has ever been created, because ArgoCD failed before it could even read the manifests. The error is in the Application's source config, not the workload.",
    },
    {
      id: "repo-perm",
      label: "The Application's AppProject doesn't allow this source repo.",
      explanation:
        "The condition message is a git ref resolution error (\"couldn't find remote ref master\"), not a permission/AppProject error - that would show as an InvalidSpecError about permitted repos, which isn't what's here.",
    },
    {
      id: "wrong-ref-path",
      label: "The Application's targetRevision and path point to a branch and directory that don't exist (master/manifest instead of main/manifests).",
      explanation:
        "The condition message spells it out: ArgoCD tried to resolve the branch \"master\", which doesn't exist - the repo's default branch is \"main\". Even fixing the branch alone wouldn't be enough, since the path \"manifest\" (singular) also doesn't match the real \"manifests\" directory. Both spec.source.targetRevision and spec.source.path need correcting.",
    },
    {
      id: "repo-server-down",
      label: "ArgoCD's repo-server is crashing and can't reach any git repository at all.",
      explanation:
        "If the repo-server itself were down, you'd expect connection-level errors across many apps, and a generic gRPC transport error rather than a specific \"couldn't find remote ref\" message naming the exact branch that's missing.",
    },
  ],
  correctOptionId: "wrong-ref-path",
  resolution: `The Application's \`spec.source.targetRevision\` was \`master\` and \`spec.source.path\` was
\`manifest\` (singular). The repo's actual default branch is \`main\`, and manifests
live under \`manifests/\` (plural). ArgoCD couldn't resolve the branch at all, so
it never even got to check the path.

In a real cluster, the fix is a one-line patch to the Application:

\`\`\`
kubectl -n argocd patch application stuck-at-3am --type merge \\
  -p '{"spec":{"source":{"targetRevision":"main","path":"manifests"}}}'
\`\`\`

Because \`syncPolicy.automated\` was already set, ArgoCD picks up the fix and
syncs on its own from there.`,
};
