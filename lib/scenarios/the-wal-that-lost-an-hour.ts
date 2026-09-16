import type { Scenario } from "./types";

export const theWalThatLostAnHour: Scenario = {
  id: "the-wal-that-lost-an-hour",
  title: "The WAL That Lost An Hour",
  subtitle: "an hour of metrics history for the whole cluster is just gone, right after Prometheus's pod got rescheduled",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["prometheus", "wal", "tsdb"],
  briefing: `A node drained for maintenance last night, and Prometheus's pod got
rescheduled onto a new node as expected. This morning, every dashboard
has a clean, hour-long gap in history immediately before the
rescheduling event - not just a brief blip during the move, but a full
hour of data that appears to have simply never made it to disk.`,
  constraints: [
    "Prometheus's persistent volume was correctly reattached to the new pod - this isn't a lost-volume or wrong-volume situation.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "prometheus-k8s", namespace: "monitoring", labels: { app: "prometheus" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "prometheus-k8s-0", namespace: "monitoring", labels: { app: "prometheus" } },
        events: [
          { type: "Normal", reason: "Killing", age: "10h", message: "Stopping container prometheus" },
          { type: "Warning", reason: "Preempted", age: "10h", message: "Pod was force-terminated: grace period 0s (node drain exceeded eviction timeout)" },
        ],
        logs: {
          prometheus: [
            "ts=2026-09-15T02:14:02.881Z level=info msg=\"Starting Prometheus Server\"",
            "ts=2026-09-15T02:14:03.410Z level=warn msg=\"Encountered WAL read error, attempting repair\" err=\"corruption in segment 000412 at offset 88213: unexpected EOF\"",
            "ts=2026-09-15T02:14:04.955Z level=info msg=\"WAL repair successful, truncating corrupted segment\" segment=000412",
          ],
        },
        age: "10h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "wal-corruption-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "Prometheus's write-ahead log (WAL) buffers recently-ingested samples\nbefore they're compacted into permanent on-disk blocks - it's how\nPrometheus avoids losing very recent data on a clean restart. The node\ndrain that moved this pod exceeded its graceful-termination grace\nperiod and was force-terminated (`grace period 0s`), which does not\ngive Prometheus a chance to cleanly flush and close its WAL segments\nbefore the process is killed. On the next startup, Prometheus detected\ncorruption in the most recent (in-progress) WAL segment - consistent\nwith a segment that was actively being written to at the moment of the\nhard kill - and automatically repaired it by truncating the corrupted\nportion, discarding whatever samples were in that unflushed segment at\nthe time of the forced termination.\n",
          },
        },
        age: "10h",
      },
    ],
  },
  hints: [
    "`kubectl get pod prometheus-k8s-0 -n monitoring -o yaml` and check its recent events - was this pod's termination graceful, or forced?",
    "`kubectl logs prometheus-k8s-0 -n monitoring` - what does Prometheus report about its own WAL immediately after starting back up on the new node?",
    "`kubectl get configmap wal-corruption-notes -n monitoring -o yaml` - what does a forced termination (no grace period) do to whatever WAL segment was actively being written at that moment, and what does Prometheus do with a corrupted segment it finds on startup?",
  ],
  options: [
    {
      id: "forced-termination-corrupted-unflushed-wal-segment",
      label:
        "The node drain exceeded its graceful-termination grace period and force-killed Prometheus's pod with no chance to cleanly flush its write-ahead log - the WAL segment actively being written at that exact moment was left corrupted, and on restart Prometheus automatically detected and repaired it by truncating the corrupted portion, discarding whatever recent samples hadn't yet been durably written, which is exactly the hour-long gap seen right before the reschedule.",
      explanation:
        "The pod's own events show a `Preempted` force-termination with `grace period 0s`. Its startup logs directly confirm WAL corruption in the most recent segment and a successful repair via truncation. `wal-corruption-notes` explains the mechanism precisely: a forced kill gives Prometheus no chance to cleanly close its WAL, corrupting whatever was actively being written, and the automatic repair-by-truncation process discards that unflushed data rather than risking serving corrupted samples - explaining the clean, hour-scale gap immediately preceding the reschedule, with the persistent volume itself correctly reattached and otherwise intact.",
    },
    {
      id: "wrong-persistent-volume-reattached",
      label: "The wrong (or a stale, out-of-date) persistent volume got reattached to Prometheus's pod on the new node.",
      explanation:
        "The scenario confirms the correct persistent volume was properly reattached - this isn't a volume-mismatch situation. The startup logs directly show a WAL corruption-and-repair event using the correct, expected volume, which is a distinct and separately evidenced mechanism from a wrong-volume scenario.",
    },
    {
      id: "remote-write-backlog-during-drain",
      label: "A remote_write backlog during the drain caused samples from that hour to be dropped before ever being written locally.",
      explanation:
        "This gap is in Prometheus's own local storage, confirmed directly by its own startup logs describing local WAL corruption and repair - a remote_write issue would affect only a separate, remote copy of the data, not create a gap in Prometheus's own local TSDB the way described here.",
    },
    {
      id: "node-drain-evicted-before-scrape-completed",
      label: "The node drain evicted the pod mid-scrape-cycle, simply skipping one scheduled scrape.",
      explanation:
        "A single skipped scrape cycle would produce a gap of at most one scrape interval (seconds to tens of seconds), not a full hour - the much larger gap, combined with the explicit WAL corruption and repair messages in Prometheus's own logs, points at a broader loss of already-ingested-but-unflushed data rather than one missed scrape.",
    },
  ],
  correctOptionId: "forced-termination-corrupted-unflushed-wal-segment",
  resolution: `\`prometheus-k8s-0\`'s own events show a \`Preempted\` force-termination with
\`grace period 0s\` - the node drain exceeded its graceful-termination
timeout and killed the pod outright, with no opportunity for Prometheus
to cleanly flush and close its write-ahead log first. Its startup logs on
the new node confirm the consequence directly: \`"Encountered WAL read
error, attempting repair" err="corruption in segment 000412 ...
unexpected EOF"\`, followed by a successful automatic repair via
truncating the corrupted segment. \`wal-corruption-notes\` explains why:
the WAL segment actively being written to at the exact moment of a hard
kill is the one left in an inconsistent state, since nothing had a chance
to finish writing it or mark it complete - and Prometheus's repair
process, rather than risk serving corrupted or partial data, discards
that segment's unflushed samples entirely rather than trying to partially
recover them. That's the hour of data that vanished: real samples that
had been ingested and buffered in the WAL but never yet compacted into a
durable on-disk block, wiped out along with the corrupted segment that
held them.

This is the WAL's design tradeoff in action - it protects against losing
data on a *clean* restart (where it can safely flush before shutting
down), but a genuinely forced, no-grace-period kill mid-write is exactly
the scenario it can't fully protect against.

There's no way to recover the lost hour after the fact, but the durable
fix is giving Prometheus enough grace period to shut down cleanly during
planned node drains, so a forced kill only happens for genuinely
unplanned failures:

\`\`\`yaml
spec:
  terminationGracePeriodSeconds: 300
\`\`\`

\`\`\`
kubectl drain <node> --grace-period=300 --timeout=600s
\`\`\`

Giving stateful, WAL-based systems like Prometheus a generous termination
grace period - and making sure node-drain tooling actually respects it -
is the difference between a clean handoff and an hour of silently
corrupted, discarded history.`,
};
