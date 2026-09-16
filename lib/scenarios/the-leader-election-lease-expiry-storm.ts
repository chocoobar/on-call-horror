import type { Scenario } from "./types";

export const theLeaderElectionLeaseExpiryStorm: Scenario = {
  id: "the-leader-election-lease-expiry-storm",
  title: "The Leader Election Lease Expiry Storm",
  subtitle: "job-scheduler has changed leaders eleven times in the last twenty minutes",
  difficulty: "hard",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 25,
  tags: ["kubernetes", "leader-election", "lease"],
  briefing: `"job-scheduler" runs 3 replicas with leader-election via a Lease, and
normally holds leadership stably for days at a time. In the last twenty
minutes it's flipped leaders eleven times, each new leader holding on for
under two minutes before losing it again. Nothing about the pods
themselves looks unhealthy - no crashes, no restarts.`,
  constraints: [
    "All 3 replicas of job-scheduler are confirmed healthy and running the entire time - none of them crash or restart during this period.",
  ],
  world: {
    resources: [
      {
        apiVersion: "coordination.k8s.io/v1",
        kind: "Lease",
        metadata: { name: "job-scheduler-leader", namespace: "scheduling" },
        spec: { holderIdentity: "job-scheduler-8b9c0d1e2-f3g4h", leaseDurationSeconds: 15, renewTime: "2026-09-15T10:19:58.000000Z" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "job-scheduler-8b9c0d1e2-f3g4h", namespace: "scheduling", labels: { app: "job-scheduler" } },
        status: { phase: "Running", containerStatuses: [{ name: "job-scheduler", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "job-scheduler": [
            "2026-09-15T10:19:43.100Z INFO  leader.Election - acquired leadership",
            "2026-09-15T10:19:58.900Z WARN  leader.Election - renewal call took 14.8s (limit 15s), barely succeeded",
            "2026-09-15T10:20:14.200Z ERROR leader.Election - renewal call took 15.3s, exceeded lease duration, lost leadership",
          ],
        },
        age: "40m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "leader-election-apiserver-notes", namespace: "scheduling" },
        spec: {
          data: {
            "notes.md":
              "The cluster's API server has been under elevated write latency for the\nlast ~25 minutes due to an unrelated large batch job hammering it with\nCustomResourceDefinition updates. Typical Lease renewal calls that\nnormally complete in 50-150ms are now taking anywhere from 8 to 16+\nseconds - right at or past job-scheduler's `leaseDurationSeconds: 15`.\nEach leader is racing its own renewal against a 15-second lease\nduration that was sized for a healthy API server, not a degraded one -\nwhichever replica happens to be leader when a renewal call is slow\nloses leadership, a new election happens near-instantly (also somewhat\nslowed by the same API latency), and the new leader immediately starts\nfacing the same race. The pods themselves are all completely healthy;\nit's the surrounding API server latency making the leadership renewal\ncontract itself impossible to reliably meet.\n",
          },
        },
        age: "25m",
      },
    ],
  },
  hints: [
    "`kubectl logs job-scheduler-8b9c0d1e2-f3g4h -n scheduling` - check how long each renewal call is actually taking versus the Lease's own `leaseDurationSeconds`.",
    "`kubectl get lease job-scheduler-leader -n scheduling -o yaml` - a Lease renewal is itself just an API write - how would general API server slowness affect it specifically?",
    "`kubectl get configmap leader-election-apiserver-notes -n scheduling -o yaml` - is there something else happening to the API server right now, unrelated to job-scheduler itself?",
  ],
  options: [
    {
      id: "apiserver-latency-exceeds-lease-duration",
      label:
        "An unrelated batch job has been hammering the API server with CRD updates for the last 25 minutes, pushing write latency for ordinary operations - including Lease renewals - up to 8-16+ seconds, right at or past job-scheduler's `leaseDurationSeconds: 15` - so whichever replica happens to be leader when its renewal call is slow loses leadership purely due to external API latency, a brand-new leader is elected almost immediately (itself also somewhat slowed by the same congestion), and the new leader faces the identical race on its very next renewal, producing rapid, repeated leadership churn with all 3 pods staying completely healthy throughout.",
      explanation:
        "job-scheduler's own logs show the exact mechanism developing in real time: a renewal that \"barely succeeded\" at 14.8 seconds, followed by one that took 15.3 seconds and lost leadership. `leader-election-apiserver-notes` explains the external cause - unrelated CRD-update load degrading API server write latency generally, pushing what's normally a 50-150ms call into the same range as the lease duration itself. This fully explains rapid, repeated churn with zero pod crashes or restarts, since the pods themselves are never unhealthy - only the timing contract between them and a degraded API server is broken.",
    },
    {
      id: "network-issue-between-replicas",
      label: "A network issue between the three job-scheduler replicas is disrupting leader coordination.",
      explanation:
        "Kubernetes Lease-based leader election doesn't involve direct pod-to-pod networking at all - each replica only talks to the API server to attempt renewal or acquisition, never to its peers directly. The logs show renewal calls (API server writes) taking too long, not any pod-to-pod connectivity issue.",
    },
    {
      id: "job-scheduler-bug-releasing-leadership-early",
      label: "There's a bug in job-scheduler's leader-election client code that releases leadership prematurely.",
      explanation:
        "The logs show the leader correctly attempting renewal and only losing leadership when the renewal call itself genuinely exceeds the lease duration - this is the leader-election library behaving exactly as designed under a slow API server, not releasing leadership early or incorrectly on its own initiative.",
    },
    {
      id: "etcd-corruption",
      label: "The underlying etcd cluster has data corruption affecting Lease objects specifically.",
      explanation:
        "There's no indication of data corruption - `leader-election-apiserver-notes` attributes the slowdown specifically to elevated write latency from a load spike (an unrelated batch job's CRD updates), a capacity/contention issue, not any corruption, and Lease renewals are ordinary API writes subject to the same general latency as everything else during this period.",
    },
  ],
  correctOptionId: "apiserver-latency-exceeds-lease-duration",
  resolution: `job-scheduler's own logs capture the failure developing in real time: a
renewal that "barely succeeded" at 14.8 seconds, immediately followed by
one at 15.3 seconds that exceeded the lease duration and lost
leadership. \`leader-election-apiserver-notes\` explains why: an unrelated
batch job has been hammering the API server with CustomResourceDefinition
updates for the last 25 minutes, degrading general write latency -
including ordinary Lease renewal calls - from a typical 50-150ms up to
8-16+ seconds. job-scheduler's \`leaseDurationSeconds: 15\` was sized for a
healthy API server, not a degraded one, so whichever replica happens to
hold leadership when its renewal call is unlucky enough to be slow loses
it, a new election happens (itself somewhat slowed by the same
congestion), and the new leader immediately faces the identical race on
its very next renewal - explaining the rapid churn with all three pods
staying completely healthy the entire time, since nothing about the pods
themselves is actually failing.

There's no live fix from this read-only console for the API server
congestion itself, but two things help independently. If the unrelated
batch job's CRD-update load can be throttled or rescheduled to a less
sensitive time, that removes the root cause directly. Separately,
job-scheduler's own lease duration and renewal deadline have very little
margin for any API server slowness at all - widening that margin makes
leadership meaningfully more resilient to exactly this kind of transient
degradation, at the cost of slightly slower failover during a genuine
leader failure:

\`\`\`go
leaderelection.LeaderElectionConfig{
    LeaseDuration: 30 * time.Second,   // was: 15s
    RenewDeadline: 20 * time.Second,   // was: implicit, tighter
    RetryPeriod:   5 * time.Second,
}
\`\`\`

More broadly, this is a good argument for monitoring API server write
latency directly and alerting on it, since it's a shared dependency for
every leader-election-based controller in the cluster - any of them with
similarly tight lease durations would be equally vulnerable to the same
kind of external load spike, and this incident is a much cheaper way to
learn that than losing leadership stability on something genuinely
critical during a real incident.`,
};
