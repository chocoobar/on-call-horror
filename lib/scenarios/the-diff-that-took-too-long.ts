import type { Scenario } from "./types";

export const theDiffThatTookTooLong: Scenario = {
  id: "the-diff-that-took-too-long",
  title: "The Diff That Took Too Long",
  subtitle: "fleet-telemetry has never once synced successfully, and no error names the real reason",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "server-side-apply", "field-manager"],
  briefing: `"fleet-telemetry" was onboarded onto ArgoCD last week by importing an
existing, already-running Deployment that had previously been managed
by a homegrown deploy script for two years. Every sync since has failed
with a vague apply conflict error, and nobody can pin down what's
actually contested - the manifests themselves look completely
unremarkable.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-diff-that-took-too-long", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/fleet-telemetry.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "telemetry" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          operationState: {
            phase: "Failed",
            message:
              'one or more objects failed to apply, reason: Apply failed with 1 conflict: conflict with "homegrown-deploy-script" using apps/v1: .spec.template.spec.containers[name="telemetry-agent"].image',
          },
        },
        age: "1w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "onboarding-notes", namespace: "telemetry" },
        spec: {
          data: {
            "notes.md":
              "fleet-telemetry's Deployment was created and, for two years, exclusively\nupdated by a homegrown internal deploy script that used plain\n`kubectl apply` (client-side, not server-side apply) with its own\nfield manager name, `homegrown-deploy-script`. When the team onboarded\nthis service onto ArgoCD last week, they correctly stopped RUNNING the\nold script going forward - but never actually removed its lingering\nfield-manager ownership claim on the live object, which persists in\n`metadata.managedFields` independent of whether anything is still\nactively using that field manager. ArgoCD applies via server-side apply\nunder its own field manager, `argocd-controller`, and server-side apply\nconflicts occur when two different field managers both claim ownership\nof the exact same field with different intended values - here, both\nthe (dormant but still present) `homegrown-deploy-script` manager and\nArgoCD's own manager claim ownership of the same image field, and their\nvalues genuinely differ (the script's last-applied value is stale by\nseveral versions).",
          },
        },
        age: "1w",
      },
    ],
  },
  hints: [
    "The error explicitly names a conflicting field manager - `kubectl get deployment telemetry-agent -n telemetry -o yaml` and check `metadata.managedFields` for every field manager still claiming ownership of anything.",
    "Stopping a script from running doesn't retroactively release its prior field-manager ownership claims on a resource - those persist in the object's managedFields metadata until something explicitly resolves the conflict.",
    "`kubectl get configmap onboarding-notes -n telemetry -o yaml` for exactly how this Deployment was managed before ArgoCD, and what actually changed (and didn't) during onboarding.",
  ],
  options: [
    {
      id: "stale-field-manager-conflict-from-legacy-script",
      label:
        "The Deployment was managed for two years by a homegrown script using its own field-manager name, and while the team stopped running that script when onboarding to ArgoCD, its ownership claim on the image field in metadata.managedFields was never actually released - so ArgoCD's server-side apply hits a genuine ownership conflict against a dormant but still-present field manager claiming a different, stale value for the same field.",
      explanation:
        "The error names the conflicting field manager directly: `homegrown-deploy-script`, contesting ownership of the exact same image field ArgoCD is trying to apply. `onboarding-notes` confirms that script was the Deployment's sole manager for two years via plain client-side `kubectl apply`, and while the team stopped running it, they never released its lingering ownership claim - which persists independently of whether the script is still active. Server-side apply conflicts are specifically about contested field ownership between managers, exactly matching this situation.",
    },
    {
      id: "manifest-has-invalid-image-field",
      label: "The Deployment manifest in git has an invalid or malformed image field value.",
      explanation:
        "The error is explicitly an apply *conflict* naming a specific competing field manager, not a validation error about the field's value being malformed - Kubernetes would reject an invalid image value with a distinct schema validation error, not a server-side-apply ownership conflict.",
    },
    {
      id: "rbac-missing-deployment-update",
      label: "ArgoCD's ServiceAccount lacks RBAC permission to update this specific Deployment.",
      explanation:
        "An RBAC denial produces a Forbidden-style error naming the denied verb and resource, not an 'Apply failed with 1 conflict' message naming a specific competing field manager and field path - this is unambiguously a server-side-apply ownership conflict, not a permissions problem.",
    },
    {
      id: "two-applications-managing-same-deployment",
      label: "A second ArgoCD Application is also trying to manage this same Deployment.",
      explanation:
        "The conflicting field manager named in the error is `homegrown-deploy-script`, not another ArgoCD Application's own controller field manager (which would show as `argocd-controller` from a different Application, not a differently-named manager entirely) - this points at the legacy pre-ArgoCD deploy tooling, not a second Application.",
    },
  ],
  correctOptionId: "stale-field-manager-conflict-from-legacy-script",
  resolution: `The error names the conflict precisely: ArgoCD's apply is contested by
\`homegrown-deploy-script\`, a field manager claiming ownership of the same
image field ArgoCD is trying to set, with a different (stale) value.
\`onboarding-notes\` confirms this Deployment was managed exclusively by
that legacy script for two years via plain client-side \`kubectl apply\` -
and while the team correctly stopped running the script when they
onboarded to ArgoCD, they never actually released its lingering
ownership claim on the object's \`metadata.managedFields\`. That claim
persists independently of whether anything is still actively using that
field manager, and server-side apply refuses to silently override a
field another manager claims ownership of when the values disagree -
which is exactly the "vague apply conflict" nobody could pin down, since
the manifests themselves are genuinely unremarkable.

Fix by explicitly releasing the stale field manager's claim, which
kubectl supports directly:

\`\`\`
kubectl patch deployment telemetry-agent -n telemetry \\
  --type=json \\
  --subresource=status \\
  -p '[]'   # no-op patch isn't sufficient here; use the dedicated flow below

kubectl apply -f - --server-side --force-conflicts <<EOF
$(kubectl get deployment telemetry-agent -n telemetry -o yaml)
EOF
\`\`\`

or, more surgically, remove just the stale manager's entry from
\`managedFields\` before ArgoCD's next sync attempt. Either way, once
\`homegrown-deploy-script\`'s ownership claim is cleared, ArgoCD's
server-side apply proceeds without contest and the Deployment syncs
cleanly. Worth documenting this as a required onboarding step for the
next legacy service migrated onto ArgoCD: retiring the old deploy
mechanism needs to include explicitly releasing its field-manager claims,
not just stopping new runs of it - the two are easy to conflate but are
genuinely separate steps.`,
};
