import type { Scenario } from "../types";

export const theOverlayThatWasntIncluded: Scenario = {
  id: "the-overlay-that-wasnt-included",
  title: "The Overlay That Wasn't Included",
  subtitle: "prod's HPA settings are still whatever staging left behind",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 12,
  tags: ["argocd", "kustomize", "overlays"],
  briefing: `"orders-api" uses Kustomize with base + environment overlays. The prod
Application is pointed at the "overlays/prod" directory, but its HPA
still shows staging-sized limits (max 4 replicas) instead of the much
higher prod numbers the team is certain they wrote into the prod
overlay.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-overlay-that-wasnt-included", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/orders-api.git", targetRevision: "main", path: "overlays/prod" },
          destination: { server: "https://kubernetes.default.svc", namespace: "orders" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "7d6c5b4" }, health: { status: "Healthy" } },
        age: "8mo",
      },
      {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: "orders-api", namespace: "orders" },
        spec: { minReplicas: 2, maxReplicas: 4, scaleTargetRef: { kind: "Deployment", name: "orders-api" } },
        status: { currentReplicas: 4, desiredReplicas: 4 },
        age: "8mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "orders-kustomize-notes", namespace: "orders" },
        spec: {
          data: {
            "kustomization.yaml.prod":
              "# overlays/prod/kustomization.yaml\nresources:\n  - ../../base\n  - hpa-patch.yaml\npatches:\n  - path: replica-patch.yaml\n# hpa-patch.yaml exists in this directory with maxReplicas: 40, but is\n# never referenced anywhere in this kustomization.yaml - only\n# replica-patch.yaml is wired up via `patches`. The base's own HPA\n# resource (inherited via `resources: [../../base]`) is the staging-\n# sized one with maxReplicas: 4, and nothing here overrides it.",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get hpa orders-api -n orders -o yaml` - confirm the live maxReplicas really is 4, not something rendered differently.",
    "`kubectl get configmap orders-kustomize-notes -n orders -o yaml` and read the prod overlay's kustomization.yaml carefully - specifically, is every patch file in the directory actually referenced?",
    "A file sitting in an overlay directory does nothing on its own - Kustomize only applies what's explicitly listed under `resources`, `patches`, or similar fields in kustomization.yaml.",
  ],
  options: [
    {
      id: "hpa-patch-file-not-referenced",
      label:
        "The prod overlay has a hpa-patch.yaml file with the correct prod-sized limits sitting right there in the directory, but it was never added to kustomization.yaml's `patches` list, so Kustomize never applies it and the base's staging-sized HPA passes through untouched.",
      explanation:
        "`orders-kustomize-notes` shows the prod overlay's kustomization.yaml only references `hpa-patch.yaml`... wait, actually references only `replica-patch.yaml` under `patches` - `hpa-patch.yaml` exists in the same directory with the intended `maxReplicas: 40` but is never listed anywhere kustomization.yaml reads from. Kustomize only applies files it's explicitly told about; an unreferenced file next to the others does nothing, so the base's own HPA (maxReplicas: 4, meant for staging) flows through unmodified.",
    },
    {
      id: "wrong-overlay-path-easy",
      label: "The Application is actually pointed at the staging overlay path, not prod.",
      explanation:
        "`spec.source.path` is `overlays/prod` - it is pointed at the correct overlay directory. The problem is inside that directory: one of its patch files exists but was never wired into kustomization.yaml, not that the wrong directory is being used entirely.",
    },
    {
      id: "hpa-controller-not-reading-crd",
      label: "The HorizontalPodAutoscaler controller isn't picking up changes to the HPA spec.",
      explanation:
        "The live HPA object itself genuinely has `maxReplicas: 4` in its spec - this isn't a controller failing to apply a correct spec, it's Kustomize never rendering the corrected spec in the first place, so there's nothing wrong for the HPA controller to pick up differently.",
    },
    {
      id: "selfheal-reverting-hpa-overlay",
      label: "selfHeal is reverting manual fixes to the HPA back to staging values.",
      explanation:
        "There's no live/git drift here at all - git itself (via the unreferenced patch file issue) never declared the prod values in the first place, so there's nothing for selfHeal to be reverting; the Application is legitimately Synced against what Kustomize actually renders.",
    },
  ],
  correctOptionId: "hpa-patch-file-not-referenced",
  resolution: `\`orders-kustomize-notes\` shows the prod overlay's \`kustomization.yaml\`
only lists \`replica-patch.yaml\` under \`patches\` - \`hpa-patch.yaml\`, which
contains the correct prod-sized \`maxReplicas: 40\`, exists in the same
directory but was never added to the list. Kustomize only renders what a
kustomization.yaml explicitly references; a patch file just sitting
alongside the others, unreferenced, is completely inert. With nothing
overriding it, the base's own HPA (sized for staging, \`maxReplicas: 4\`)
passes straight through into the prod render untouched.

Fix by wiring the existing patch file in:

\`\`\`yaml
# overlays/prod/kustomization.yaml
resources:
  - ../../base
patches:
  - path: replica-patch.yaml
  - path: hpa-patch.yaml
\`\`\`

Once that's committed, ArgoCD's next sync renders the prod overlay
correctly and the HPA's \`maxReplicas\` updates to 40. Worth double-
checking every other file in the prod overlay directory the same way -
an unreferenced patch is silent by design, so there's no error to have
caught this earlier.`,
};
