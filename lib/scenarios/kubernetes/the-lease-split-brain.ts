import type { Scenario } from "../types";

export const theLeaseSplitBrain: Scenario = {
  id: "the-lease-split-brain",
  title: "The Lease Split-Brain",
  subtitle: "two replicas of price-updater both believe they're the leader, at the same time",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "leader-election", "lease"],
  briefing: `"price-updater" runs 3 replicas but is designed so only the elected
leader actually writes price changes, coordinated via a Lease object.
Support just found duplicate, conflicting price updates in the audit log
- which should be structurally impossible if leader election is working.
Both writes came from different pods, seconds apart.`,
  constraints: [
    "All three replicas are confirmed Running and healthy the entire time - none of them crashed or restarted around the incident.",
  ],
  world: {
    resources: [
      {
        apiVersion: "coordination.k8s.io/v1",
        kind: "Lease",
        metadata: { name: "price-updater-leader", namespace: "pricing" },
        spec: { holderIdentity: "price-updater-2f3g4h5i6-j7k8l", leaseDurationSeconds: 15, renewTime: "2026-09-15T10:04:58.000000Z" },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "price-updater-2f3g4h5i6-j7k8l", namespace: "pricing", labels: { app: "price-updater" } },
        status: { phase: "Running", containerStatuses: [{ name: "price-updater", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "price-updater": [
            "2026-09-15T10:04:58.010Z INFO  leader.Election - renewed leadership lease",
            "2026-09-15T10:05:12.500Z INFO  pricing.Writer - wrote price update for SKU-88213: $24.99 -> $22.49",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "price-updater-9m0n1o2p3-q4r5s", namespace: "pricing", labels: { app: "price-updater" } },
        status: { phase: "Running", containerStatuses: [{ name: "price-updater", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "price-updater": [
            "2026-09-15T10:04:44.900Z WARN  leader.Election - lease renewal request timed out after 5s, assuming leadership lost, but continuing prior write in progress",
            "2026-09-15T10:05:09.220Z INFO  pricing.Writer - wrote price update for SKU-88213: $24.99 -> $19.99",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "price-updater-election-code-notes", namespace: "pricing" },
        spec: {
          data: {
            "notes.md":
              "price-updater's leader-election client library detects a lease renewal\ntimeout and correctly stops considering itself the leader for *future*\ndecisions - but the application code has a gap: a write already in\nprogress when a renewal times out is allowed to finish and commit\nregardless, rather than being aborted or fenced. The Kubernetes API\nserver itself briefly slowed down around 10:04:44 (unrelated maintenance\non a different workload spiking etcd latency), long enough for pod\n9m0n1o2p3-q4r5s's lease renewal call to time out - just as it was mid-way\nthrough a price-write operation it had already started while still\nbelieving itself to be the leader. It lost the lease to pod\n2f3g4h5i6-j7k8l shortly after, but its own in-flight write completed\nanyway a few seconds later.\n",
          },
        },
        age: "5m",
      },
    ],
  },
  hints: [
    "`kubectl get lease price-updater-leader -n pricing -o yaml` - who does the Lease say holds leadership, and when was it last renewed?",
    "Check *both* pods' logs around the same timeframe - does the pod that lost the lease actually stop doing leader-only work immediately, or does something already in flight complete anyway?",
    "Leader election tells a process when it's *no longer* the leader - but does the application code actually stop or abort work that was already underway before that notification arrived?",
  ],
  options: [
    {
      id: "in-flight-write-not-fenced-on-lease-loss",
      label:
        "A brief API server slowdown caused pod 9m0n1o2p3-q4r5s's lease renewal to time out while it was already mid-way through a price-write operation it had started while still believing itself the leader - price-updater's leader-election code correctly stops it from starting *new* leader-only work once the lease is lost, but has no mechanism to abort or fence a write that was already in progress, so that write completed and committed seconds after leadership had actually already passed to the other pod, producing two conflicting writes for the same SKU from two different pods.",
      explanation:
        "The Lease object shows `price-updater-2f3g4h5i6-j7k8l` as the current holder, renewed at 10:04:58 - the legitimate leader. But pod `9m0n1o2p3-q4r5s`'s own log shows it started a write while still believing itself leader, hit a renewal timeout at 10:04:44, and then explicitly logs \"continuing prior write in progress\" before committing that write at 10:05:09 - five seconds before the new leader's own conflicting write at 10:05:12. `price-updater-election-code-notes` names the exact gap: leader election correctly prevents *starting* new work after losing the lease, but nothing in this codebase aborts or fences work already underway, which is precisely how two pods produced conflicting writes despite Kubernetes' own Lease mechanism functioning completely correctly throughout.",
    },
    {
      id: "lease-object-itself-corrupted",
      label: "The Lease object itself became corrupted or was held by two identities simultaneously.",
      explanation:
        "The Lease shows a single, clean `holderIdentity` with a valid, recent `renewTime` - there's no indication of corruption or dual-holding at the Kubernetes API level. The double-write happened because of application-level behavior after losing the lease, not because the Lease mechanism itself malfunctioned.",
    },
    {
      id: "both-pods-never-actually-elected",
      label: "Leader election never actually ran, and both pods have always operated independently.",
      explanation:
        "Both pods' own logs explicitly reference leader-election behavior (\"renewed leadership lease\" / \"lease renewal request timed out... assuming leadership lost\") - leader election is clearly running and being respected for the *decision* to write, it's specifically the handling of work already in progress at the moment leadership changes that has the gap.",
    },
    {
      id: "third-pod-also-wrote",
      label: "The third replica also attempted a write around the same time, compounding the conflict.",
      explanation:
        "Only two pods' logs show write activity for SKU-88213 in this window - there's no evidence the third replica participated in this incident at all. The conflict is fully explained by the two pods shown: the outgoing leader's unfenced in-flight write and the incoming leader's new one.",
    },
  ],
  correctOptionId: "in-flight-write-not-fenced-on-lease-loss",
  resolution: `The Lease object itself worked exactly as intended - it shows a single,
clean holder (\`price-updater-2f3g4h5i6-j7k8l\`) with a fresh renewal at
10:04:58. The bug is in the application, not Kubernetes: pod
\`9m0n1o2p3-q4r5s\`'s own log shows it hit a renewal timeout at 10:04:44
(caused by a brief, unrelated API server slowdown) and explicitly logged
"continuing prior write in progress" rather than aborting - it then
committed that write at 10:05:09, five seconds before the legitimate new
leader's own conflicting write at 10:05:12. \`price-updater-election-code-notes\`
names the exact gap: the leader-election library correctly stops the
losing pod from starting *new* leader-only work, but nothing fences or
cancels work that was already underway when the lease was lost -
Kubernetes' Lease mechanism did its job perfectly; the application simply
never checked back in before committing.

The fix belongs in the application code, adding a fencing check
immediately before any leader-only side effect actually commits, not
just before it starts:

\`\`\`python
def write_price(sku, new_price):
    if not lease.is_still_leader():   # re-check right before commit, not just at start
        raise LeadershipLostError("aborting write, lease held by another pod")
    db.write(sku, new_price)
\`\`\`

This pattern - re-verifying leadership immediately before any
irreversible action, not only once at the start of the operation - is
the standard fix for exactly this class of bug, sometimes called
"fencing." Leader election alone only guarantees one pod is told it's
the leader at a time; it doesn't guarantee in-flight work stops the
instant that status changes, unless the application explicitly checks.`,
};
