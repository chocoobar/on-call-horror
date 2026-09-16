import type { Scenario } from "./types";

export const theOwnershipMigrationThatBroke: Scenario = {
  id: "the-ownership-migration-that-broke",
  title: "The Ownership Migration That Broke",
  subtitle: "half of returns-processor's resources got pruned mid-migration, the other half didn't",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "resource-tracking", "annotation-tracking"],
  briefing: `The platform is mid-migration from label-based to annotation-based
resource tracking, rolling it out Application by Application rather than
all at once. "returns-processor" was switched over this morning as part
of the rollout - immediately afterward, a routine automated sync pruned
its Service and ConfigMap (both still very much declared in git and
needed), while leaving its Deployment completely untouched.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "the-ownership-migration-that-broke",
          namespace: "argocd",
          annotations: { "argocd.argoproj.io/tracking-id": "" },
        },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/returns-processor.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "returns" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "Synced" },
          health: { status: "Degraded" },
          operationState: { phase: "Succeeded", syncResult: { resources: [{ kind: "Service", name: "returns-processor", status: "Pruned" }, { kind: "ConfigMap", name: "returns-processor-config", status: "Pruned" }] } },
        },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "tracking-migration-per-app-notes", namespace: "returns" },
        spec: {
          data: {
            "notes.md":
              "This morning's per-Application migration to annotation-based tracking\nincluded a one-time script that force-applied every currently-live\nresource once, specifically to stamp each one with the new\n`argocd.argoproj.io/tracking-id` annotation immediately (rather than\nwaiting for each resource's next natural change to pick it up\norganically, the slower approach used elsewhere). The script iterated\nover resources using `kubectl get all` as its resource discovery\nmechanism to decide what to re-stamp - `kubectl get all` is well known\nto NOT include ConfigMaps or Secrets in its output by design (it only\ncovers a fixed set of common workload-related kinds: pods, deployments,\nservices, replicasets, and a few others). The Deployment and Service\nwere both covered by `kubectl get all` and got correctly re-stamped by\nthe script. The ConfigMap was not - it was silently skipped by the\ndiscovery mechanism, left with only its old label-based tracking info,\nand on the very next automated sync (annotation-based tracking now\nactive cluster-wide for this Application), ArgoCD couldn't recognize it\nas owned and pruned it as untracked... but the notes above say Service\nwas ALSO pruned, and Service IS covered by `kubectl get all` - checking\nfurther: the script's `kubectl get all -n returns` was run with a\ntypo'd/stale kubeconfig context pointing at a STAGING cluster namespace\nof the same name that coincidentally also had a `returns` namespace,\nmeaning it never actually touched THIS (production) cluster's resources\nfor re-stamping at all - both the Service and ConfigMap in production\nwere left with only old label-based tracking, and only the Deployment\nhappened to already have both label AND annotation tracking already\npresent from an earlier, unrelated partial rollout test weeks before.",
          },
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl get deployment,service,configmap -n returns -o yaml | grep -E 'tracking-id|instance:'` - compare tracking metadata across all three resource types that should all be equally affected by today's migration.",
    "The one-time re-stamping script was supposed to touch every live resource in production - did it actually run against the right cluster and namespace?",
    "`kubectl get configmap tracking-migration-per-app-notes -n returns -o yaml` for the full, slightly convoluted chain of what the script covered, what it missed, and why.",
  ],
  options: [
    {
      id: "restamping-script-ran-against-wrong-cluster-entirely",
      label:
        "The one-time re-stamping script that was supposed to apply the new annotation-based tracking to every live resource actually ran against a stale kubeconfig context pointing at a same-named staging namespace, never touching production at all - so the Service and ConfigMap were left with only old label-based tracking and got pruned as unrecognized once annotation tracking went live, while the Deployment happened to already carry both forms of tracking from an earlier, unrelated test weeks prior, and survived by coincidence rather than by the script actually working.",
      explanation:
        "`tracking-migration-per-app-notes` traces this precisely: the migration script's `kubectl get all` context was pointed at a stale, wrong (staging) cluster reference, so it never actually re-stamped anything in production at all. The Deployment surviving isn't evidence the script worked for workload kinds - it's explained separately, by an earlier, unrelated partial test having already given it both tracking forms weeks before. Every resource that depended on today's script for its annotation tracking (which, correctly understood, is everything in production, including the Deployment which just got lucky) was actually left with only old label-based tracking - and once annotation-based tracking became the active policy, both the Service and ConfigMap were pruned as unrecognized, while the Deployment's earlier lucky stamp saved it.",
    },
    {
      id: "kubectl-get-all-configmap-gap-only",
      label: "kubectl get all's well-known gap around ConfigMaps and Secrets is the sole explanation for what was pruned.",
      explanation:
        "That gap genuinely exists and would explain the ConfigMap being missed on its own - but it doesn't explain the Service also being pruned, since Service *is* covered by `kubectl get all`'s output. The notes trace a deeper, separate root cause (the script running against the wrong cluster entirely) that explains both prunes together, not just the ConfigMap.",
    },
    {
      id: "selfheal-caused-the-prune",
      label: "selfHeal is what caused the prune, and should have been disabled during the migration.",
      explanation:
        "selfHeal governs reverting live drift against declared git state - the actual prune happened because of the automated sync's normal prune behavior combined with the resources genuinely lacking recognizable tracking metadata under the newly-active tracking method, not because of selfHeal specifically reverting anything. Disabling selfHeal wouldn't have prevented a prune driven by `syncPolicy.automated.prune`.",
    },
    {
      id: "appproject-tracking-method-override",
      label: "The AppProject has its own conflicting resourceTrackingMethod override causing inconsistent behavior.",
      explanation:
        "resourceTrackingMethod is a cluster-wide setting in argocd-cm, not something AppProjects individually override - there's no such per-project override mechanism in ArgoCD, and the actual explanation traces cleanly to the migration script's own execution against the wrong cluster context, not to any project-level configuration conflict.",
    },
  ],
  correctOptionId: "restamping-script-ran-against-wrong-cluster-entirely",
  resolution: `\`tracking-migration-per-app-notes\` untangles the full chain: the one-time
script meant to re-stamp every live production resource with the new
\`argocd.argoproj.io/tracking-id\` annotation was actually run against a
stale kubeconfig context pointing at a staging cluster's same-named
\`returns\` namespace - it never touched production at all. The Deployment
surviving wasn't evidence the script worked; it happened to already carry
both label- and annotation-based tracking from an earlier, unrelated
partial rollout test weeks before, unrelated to today's script. Every
other production resource - Service and ConfigMap included - was left
with only the old label-based tracking. The moment annotation-based
tracking became the active policy for this Application, ArgoCD's
ownership check for those resources found nothing under the annotation
it now expects, and the routine automated sync's normal pruning behavior
removed them as unrecognized.

Immediate fix: recreate the pruned resources (they're still correctly
declared in git, so a fresh sync recreates them cleanly), then force a
proper re-stamp against the actual production cluster this time:

\`\`\`
kubectl config use-context production-returns-cluster   # verify explicitly, don't trust the old script's context
argocd app sync the-ownership-migration-that-broke --force
\`\`\`

A \`--force\` sync re-applies every resource declared in git, correctly
restamping each one under the now-active annotation tracking method
regardless of whether an earlier script's discovery mechanism would have
covered it. Longer term, worth two changes to the migration rollout
process itself: verify the kubeconfig context explicitly (not just
assume it) before any cluster-wide re-stamping script runs, and prefer
\`argocd app sync --force\` per-Application over a custom \`kubectl
get all\`-based script for this kind of migration - it re-applies
everything an Application actually declares, without depending on a
discovery mechanism that has known, documented gaps around ConfigMaps and
Secrets in the first place.`,
};
