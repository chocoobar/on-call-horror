import type { Scenario } from "../types";

export const theReconcileLoopStorm: Scenario = {
  id: "the-reconcile-loop-storm",
  title: "The Reconcile Loop Storm",
  subtitle: "the API server is struggling, and one small custom controller seems to be at the center of it",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "controllers", "api-server"],
  briefing: `Cluster-wide API latency has been climbing for the last hour - \`kubectl\`
commands that used to be instant now take several seconds, and several
unrelated controllers are logging timeout warnings. Nothing about
capacity looks unusual. Attention is landing on "cert-tracker", a small
in-house controller that watches Certificate custom resources and
updates their status - normally a quiet, low-traffic component nobody
thinks about.`,
  constraints: [
    "No new Certificate objects have been created recently, and there's no unusual certificate-related activity that would explain a legitimate spike in work for cert-tracker.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "cert-tracker", namespace: "cert-system", labels: { app: "cert-tracker" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "cert-tracker-8a9b0c1d2-e3f4g", namespace: "cert-system", labels: { app: "cert-tracker" } },
        status: { phase: "Running", containerStatuses: [{ name: "cert-tracker", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "cert-tracker": [
            "2026-09-15T09:10:00.100Z INFO  controller.Reconcile - reconciling Certificate default/api-gateway-tls",
            "2026-09-15T09:10:00.150Z INFO  controller.Reconcile - status update conflict (resourceVersion mismatch), retrying immediately",
            "2026-09-15T09:10:00.200Z INFO  controller.Reconcile - reconciling Certificate default/api-gateway-tls",
            "2026-09-15T09:10:00.240Z INFO  controller.Reconcile - status update conflict (resourceVersion mismatch), retrying immediately",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cert-tracker-bug-notes", namespace: "cert-system" },
        spec: {
          data: {
            "notes.md":
              "cert-tracker's reconcile loop updates a Certificate object's `.status`\nfield on every reconcile - including reconciles triggered by its own\nprevious status update (a Certificate status change re-triggers the\nwatch that caused it to reconcile in the first place). A recent\ndependency bump to its client-go version changed default client-side\nretry/backoff behavior for a resourceVersion conflict from an\nexponential backoff to an immediate retry with no delay at all - a\nsubtle behavior change buried in a changelog nobody read closely. The\nresult: cert-tracker is now reconciling and re-triggering itself on the\nsame Certificate object continuously, as fast as the API server can\nrespond, hundreds of times per second, for over an hour - one small\ncontroller generating enough sustained write load to measurably degrade\nAPI server latency for everything else in the cluster.\n",
          },
        },
        age: "50m",
      },
    ],
  },
  hints: [
    "`kubectl logs cert-tracker-8a9b0c1d2-e3f4g -n cert-system` - look at the timestamps between consecutive reconcile attempts. How far apart are they, really?",
    "A controller updating a resource's own status can re-trigger its own watch, creating a loop - what normally prevents that from spinning out of control?",
    "`kubectl get configmap cert-tracker-bug-notes -n cert-system -o yaml` - did anything about how this controller retries failed writes change recently?",
  ],
  options: [
    {
      id: "self-triggering-reconcile-loop-no-backoff",
      label:
        "A recent client-go dependency bump changed cert-tracker's default retry behavior for status-update conflicts from exponential backoff to an immediate, no-delay retry - combined with the fact that updating a Certificate's status re-triggers cert-tracker's own watch on that object, the controller is now reconciling and re-triggering itself on the same object continuously, hundreds of times per second for over an hour, generating enough sustained API server write load on its own to measurably degrade latency cluster-wide.",
      explanation:
        "cert-tracker's own logs show reconcile attempts on the identical object roughly 50ms apart, in a tight, unbroken loop - not the occasional, naturally-spaced reconciles a quiet controller should produce. `cert-tracker-bug-notes` explains the mechanism precisely: a status update re-triggering the same controller's own watch is a well-known self-loop risk normally contained by backoff between retries, and a dependency bump silently removed exactly that backoff, turning an occasional harmless conflict-and-retry into an unthrottled, continuous reconcile storm large enough to affect the whole API server.",
    },
    {
      id: "unrelated-etcd-performance-degradation",
      label: "etcd itself is independently degraded, and cert-tracker's retries are just a symptom, not the cause.",
      explanation:
        "cert-tracker's own logs show it reconciling the same single object hundreds of times over the course of an hour with no delay between attempts - a self-inflicted, unthrottled loop that would generate meaningful load on its own regardless of etcd's baseline health, and there's no independent evidence pointing at etcd as a root cause rather than a victim of this specific controller's behavior.",
    },
    {
      id: "too-many-certificate-objects",
      label: "There's simply a very large number of Certificate objects for cert-tracker to reconcile through.",
      explanation:
        "The scenario explicitly confirms no unusual certificate-related activity or object growth, and cert-tracker's own logs show it repeatedly reconciling the *same single object* (`default/api-gateway-tls`) over and over, not cycling through many different ones - which points at a self-referential loop on one object, not simply a large workload volume.",
    },
    {
      id: "cert-tracker-resource-limits-too-low",
      label: "cert-tracker's own CPU/memory limits are too low, causing it to thrash and retry excessively.",
      explanation:
        "There's no indication cert-tracker itself is resource-starved (it's confirmed `Running`, `Ready`, with no restarts) - the retry storm is a logical/behavioral issue in how conflicts are handled after a dependency bump, not a resource-constraint symptom on the controller's own pod.",
    },
  ],
  correctOptionId: "self-triggering-reconcile-loop-no-backoff",
  resolution: `cert-tracker's own logs show the smoking gun: reconcile attempts on the
identical Certificate object roughly 50 milliseconds apart, an
unbroken, continuous loop rather than the occasional, naturally-paced
reconciliation a quiet status-tracking controller should produce.
\`cert-tracker-bug-notes\` explains exactly how this started: updating a
Certificate's \`.status\` field re-triggers the very watch that caused
cert-tracker to reconcile it in the first place - a well-known
self-triggering pattern that's normally harmless because a
resourceVersion conflict retry backs off exponentially, giving the loop
room to naturally settle. A recent client-go dependency bump silently
changed that default from exponential backoff to an immediate,
no-delay retry - a subtle behavior change easy to miss in a routine
dependency update - and the result is a single small controller hammering
the API server with hundreds of writes per second on one object,
continuously, for over an hour: more than enough sustained load to
measurably degrade latency for every other controller and every
\`kubectl\` command in the cluster.

There's no live fix from this read-only console, but the actual remediation
is twofold. Immediately, scaling cert-tracker to 0 replicas stops the
storm and should restore API server latency to normal within moments -
worth verifying isn't itself something requiring a webhook or gate that's
also degraded before assuming it'll be quick. The durable fix is
restoring real backoff on conflict retries, either by pinning back the
prior client-go version until the behavior change is understood, or
explicitly configuring retry backoff rather than relying on the
library's default:

\`\`\`go
retry.OnError(retry.DefaultBackoff, errors.IsConflict, func() error {
    return updateCertificateStatus(cert)
})
\`\`\`

This is a strong argument for treating client library version bumps -
even routine, seemingly unrelated ones - as changes worth reading the
changelog for closely when they touch anything related to retry,
backoff, or watch behavior, since their effects can be invisible right
up until they quietly become a cluster-wide incident.`,
};
