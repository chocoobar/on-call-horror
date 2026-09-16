import type { Scenario } from "../types";

export const theSelfhealThatRevertedTheFix: Scenario = {
  id: "the-selfheal-that-reverted-the-fix",
  title: "The selfHeal That Reverted the Fix",
  subtitle: "an emergency scale-up during an outage kept undoing itself, live, during the outage",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "selfheal", "incident-response"],
  briefing: `During last night's traffic spike incident, an on-call engineer manually
scaled "checkout-worker" from 5 to 20 replicas to keep up with load. Every
time they did, replicas dropped back to 5 within about 90 seconds -
actively working against the mitigation, mid-incident, for nearly twenty
minutes before anyone realized what was fighting them.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-selfheal-that-reverted-the-fix", namespace: "argocd" },
        spec: {
          project: "default",
          source: { repoURL: "https://github.com/example/checkout-worker.git", targetRevision: "main", path: "manifests" },
          destination: { server: "https://kubernetes.default.svc", namespace: "checkout" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced", revision: "a1b2c3d" }, health: { status: "Healthy" } },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-worker", namespace: "checkout", labels: { app: "checkout-worker" } },
        spec: { replicas: 5 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 5 },
        events: [
          { type: "Normal", reason: "ScalingReplicaSet", age: "18m", message: "Scaled up replica set checkout-worker-9f8e to 20 from 5" },
          { type: "Normal", reason: "ScalingReplicaSet", age: "16m", message: "Scaled down replica set checkout-worker-9f8e to 5 from 20" },
          { type: "Normal", reason: "ScalingReplicaSet", age: "13m", message: "Scaled up replica set checkout-worker-9f8e to 20 from 5" },
          { type: "Normal", reason: "ScalingReplicaSet", age: "11m", message: "Scaled down replica set checkout-worker-9f8e to 5 from 20" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "incident-timeline-notes", namespace: "checkout" },
        spec: {
          data: {
            "notes.md":
              "No HPA is configured for checkout-worker at all - this is a plain,\nfixed-replica Deployment, and the manifest in git declares\n`replicas: 5`, unchanged for months. This Application has\n`selfHeal: true`. The on-call engineer's manual `kubectl scale ...\n--replicas=20` created live drift from git's declared value every time\nthey ran it; ArgoCD's automated reconciliation loop (running roughly\nevery 3 minutes independent of any git change, to catch exactly this\nkind of live drift) noticed the mismatch and, correctly per its own\nconfiguration, reverted it back to what git declares - completely\nunaware that this specific drift was an active, intentional incident\nmitigation rather than an accidental change to revert.",
          },
        },
        age: "18m",
      },
    ],
  },
  hints: [
    "There's no HPA involved here at all - check `kubectl get hpa -n checkout` to confirm. What else, besides an HPA, would cause a manually-scaled Deployment's replicas to keep reverting?",
    "`kubectl describe deployment checkout-worker -n checkout` - the Events show scale-up and scale-down alternating roughly every couple minutes, matching ArgoCD's normal reconciliation cadence, not an HPA's typical behavior.",
    "selfHeal has no way to distinguish 'this live change is an accidental mistake' from 'this live change is a deliberate, urgent incident mitigation' - both look identical to it as drift from git.",
  ],
  options: [
    {
      id: "selfheal-reverting-manual-incident-scaling-no-hpa",
      label:
        "With no HPA involved at all, this Application's selfHeal is doing exactly what it's configured to do: treating the engineer's manual incident-response scale-up as plain drift from git's declared replicas: 5, and reverting it on every reconciliation pass - selfHeal has no way to know this particular piece of drift was a deliberate, urgent mitigation rather than an accident to correct.",
      explanation:
        "`incident-timeline-notes` confirms there's no HPA managing this Deployment at all - it's a plain fixed-replica Deployment with `replicas: 5` declared in git, unchanged for months. The Deployment's own Events show scale-up-then-scale-down pairs roughly every few minutes, matching ArgoCD's normal reconciliation cadence exactly, not HPA behavior. selfHeal is functioning exactly as designed: correcting live drift back toward what git declares - it simply has no concept of 'this drift is an active incident mitigation, leave it alone for now,' which is exactly why it kept undoing the engineer's manual scale-up throughout the incident.",
    },
    {
      id: "hpa-fighting-manual-scale-selfheal",
      label: "An HPA is fighting the manual scale-up and repeatedly overriding it back down to 5.",
      explanation:
        "`kubectl get hpa -n checkout` confirms there's no HorizontalPodAutoscaler for this Deployment at all - the scale-down events are attributed directly to plain ScalingReplicaSet events with no accompanying HPA rescale event, consistent with ArgoCD's own selfHeal reconciliation, not autoscaler behavior.",
    },
    {
      id: "deployment-controller-bug-scaling",
      label: "A bug in the Deployment controller is randomly resetting replica count.",
      explanation:
        "The scale-down timing correlates precisely with ArgoCD's normal reconciliation interval, not with anything random or controller-bug-like - and the target it reverts to (exactly 5, git's declared value, every single time) is far too consistent and deliberate-looking to be a random controller malfunction.",
    },
    {
      id: "resourcequota-blocking-scale-up",
      label: "A ResourceQuota in the checkout namespace is blocking the scale-up from sticking.",
      explanation:
        "The Events show the scale-up to 20 replicas *succeeding* each time (a real ScalingReplicaSet event to 20, not a blocked/rejected scale attempt) before being scaled back down minutes later - a ResourceQuota blocking the scale-up would prevent it from succeeding at all, not allow it to succeed temporarily before something else reverts it.",
    },
  ],
  correctOptionId: "selfheal-reverting-manual-incident-scaling-no-hpa",
  resolution: `\`incident-timeline-notes\` confirms there's no HPA involved at all - this
is a plain, fixed-replica Deployment with \`replicas: 5\` declared in git,
unchanged for months. The Deployment's own Events show scale-up-to-20,
scale-down-to-5 pairs repeating roughly every couple of minutes, matching
ArgoCD's normal reconciliation interval precisely. This Application has
\`selfHeal: true\`, and selfHeal did exactly what it's designed to do:
noticed live state (20 replicas) didn't match git's declared value (5),
and corrected it - completely unaware that this particular instance of
"drift" was a deliberate, urgent incident mitigation rather than an
accidental change worth reverting. selfHeal has no concept of intent; it
only knows "live doesn't match git."

For the immediate incident, the correct move (once recognized) is either
committing the temporary scale-up to git so it becomes the declared
state selfHeal reconciles toward, or briefly disabling automated sync
until the incident resolves:

\`\`\`
argocd app set the-selfheal-that-reverted-the-fix --sync-policy none
kubectl scale deployment checkout-worker -n checkout --replicas=20
# ... incident mitigated, remember to re-enable automated sync afterward
argocd app set the-selfheal-that-reverted-the-fix --sync-policy automated --auto-prune --self-heal
\`\`\`

or, faster and safer to remember, commit the temporary replica bump to
git directly so ArgoCD reconciles *toward* the mitigation instead of away
from it, then revert the commit once the incident passes. Longer term,
this is a strong argument for adding an HPA to checkout-worker (so
capacity scales automatically under load without needing either a manual
scale or a sync-policy toggle mid-incident) with the replicas field
excluded from git/comparison the same way any HPA-managed Deployment
should be - removing the underlying tension between "fixed declared
replica count" and "needs to flex during real traffic spikes" entirely,
rather than relying on an on-call engineer to remember the selfHeal
interaction under incident pressure.`,
};
