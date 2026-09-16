import type { Scenario } from "../types";

export const theCrdThatNeededValidateFalse: Scenario = {
  id: "the-crd-that-needed-validate-false",
  title: "The CRD That Needed Validate=False",
  subtitle: "feature-flags-operator's own CRD can't sync against itself",
  difficulty: "easy",
  type: "fix",
  topic: "argocd",
  timeMinutes: 15,
  tags: ["argocd", "crd", "sync-options"],
  briefing: `"feature-flags-operator" bundles both its CustomResourceDefinition and a
sample custom resource that uses it, applied in the same sync. Every
fresh install of this Application fails on the very first sync with a
schema validation error on the custom resource - even though the manifest
is valid according to the CRD that's supposed to define its schema.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-crd-that-needed-validate-false", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/feature-flags-operator.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "feature-flags" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Missing" },
          operationState: {
            phase: "Failed",
            message:
              'one or more objects failed to apply, reason: unable to recognize "FeatureFlagSet": no matches for kind "FeatureFlagSet" in version "flags.example.com/v1"',
          },
        },
        age: "5m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "crd-timing-notes", namespace: "feature-flags" },
        spec: {
          data: {
            "notes.md":
              "Both the CustomResourceDefinition for FeatureFlagSet and a sample\nFeatureFlagSet resource are applied within the same sync operation, in\nthe same (default, unspecified) sync wave. ArgoCD's default `kubectl\napply` style validation checks that a resource's kind is registered\nwith the API server *at the moment it submits that resource* - but a\nfreshly-applied CRD needs a few seconds for the API server to actually\nregister and serve its new type before anything of that kind can be\ncreated. On a fresh install, both objects get submitted in the same\npass, and the custom resource's submission can race ahead of the CRD\nfinishing registration.",
          },
        },
        age: "5m",
      },
    ],
  },
  hints: [
    "`kubectl describe application the-crd-that-needed-validate-false -n argocd` - the error says the CRD's own kind 'no matches' - meaning the API server didn't yet recognize the type when the custom resource was submitted.",
    "`kubectl get configmap crd-timing-notes -n feature-flags -o yaml` for the timing explanation.",
    "This is a classic CRD-plus-instance-in-one-sync race: the fix usually involves either sequencing them with sync waves, or telling ArgoCD to skip client-side kind validation for the instance so the server-side apply can retry once the CRD is actually ready.",
  ],
  options: [
    {
      id: "crd-and-instance-same-wave-race",
      label:
        "The CRD and a sample custom resource using it are both applied in the same sync wave, and on a fresh install the custom resource's apply can race ahead of the API server finishing registration of the freshly-applied CRD's new type - producing a 'no matches for kind' error that a retry (after the CRD settles) wouldn't hit.",
      explanation:
        "`crd-timing-notes` explains the mechanism directly: both objects are in the same sync operation and wave, and a newly-applied CRD needs a short window for the API server to register and start serving its new type before instances of that kind can be created. The error - 'no matches for kind FeatureFlagSet' - is precisely what happens when a resource is submitted before its CRD has finished being recognized, a classic bootstrap race on fresh installs specifically.",
    },
    {
      id: "crd-manifest-invalid",
      label: "The CustomResourceDefinition manifest itself has an invalid OpenAPI schema.",
      explanation:
        "The error is 'no matches for kind' - meaning the API server doesn't recognize the kind at all yet, not that it recognized the kind and rejected the resource against an invalid schema (which would be a distinct, differently-worded validation error). This points at a timing/registration gap, not a malformed CRD schema.",
    },
    {
      id: "wrong-apiversion-in-sample",
      label: "The sample FeatureFlagSet resource uses the wrong apiVersion for the CRD.",
      explanation:
        "If the apiVersion were simply wrong, the error would persist identically on every retry, including a manual re-sync after the CRD is fully established - the notes describe this as a timing race specific to fresh installs, which a same-manifest retry after the CRD settles resolves cleanly.",
    },
    {
      id: "rbac-missing-for-crd-instance",
      label: "ArgoCD's ServiceAccount lacks RBAC permission to create FeatureFlagSet resources.",
      explanation:
        "An RBAC denial produces a Forbidden-style error naming the ServiceAccount and the denied verb/resource - the error here is 'no matches for kind', which is a discovery/registration failure at the API server level, occurring before RBAC would even be evaluated for that specific resource.",
    },
  ],
  correctOptionId: "crd-and-instance-same-wave-race",
  resolution: `\`crd-timing-notes\` lays out the exact mechanism: both the CRD and a
sample custom resource using it are submitted in the same sync operation,
in the same default wave. A freshly-applied CRD takes the API server a
short moment to actually register and begin serving the new type - if the
custom resource instance is submitted in that same window, the API
server genuinely doesn't recognize the kind yet, producing "no matches
for kind FeatureFlagSet". This is a well-known bootstrap race specific to
fresh installs (an existing cluster where the CRD is already established
wouldn't hit it on a routine sync).

The cleanest fix is sequencing them with sync waves, so the CRD is fully
applied and given a moment to register before the instance is attempted:

\`\`\`yaml
# CustomResourceDefinition
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "-1"

# sample FeatureFlagSet resource
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "0"
\`\`\`

Because a CRD's own health check in ArgoCD waits for its
\`Established\` condition before considering wave -1 complete, this alone
resolves the race cleanly on every fresh install going forward, without
needing to disable manifest validation.`,
};
