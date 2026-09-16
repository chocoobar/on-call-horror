import type { Scenario } from "../types";

export const theRebalanceStorm: Scenario = {
  id: "the-rebalance-storm",
  title: "The Rebalance Storm",
  subtitle: "inventory-sync-consumer processes the same batch of records three or four times over, whenever load ticks up",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "kafka", "spring-boot"],
  briefing: `"inventory-sync-consumer" keeps a warehouse system's stock counts in sync
by consuming a Kafka topic. During moderately busy periods, warehouse
staff start seeing stock adjustments applied multiple times - the same
inventory delta processed two, three, sometimes four times in a row. It
never happens during quiet periods, only when message volume (and
therefore per-batch processing time) picks up.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "inventory-sync-consumer", namespace: "warehouse", labels: { app: "inventory-sync-consumer" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "inventory-sync-consumer", image: "registry.internal/inventory-sync-consumer:2.5.0" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "20d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "inventory-sync-consumer-7s8t9u0v1-w2x3y", namespace: "warehouse", labels: { app: "inventory-sync-consumer" } },
        status: { phase: "Running", containerStatuses: [{ name: "inventory-sync-consumer", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "inventory-sync-consumer": [
            "2026-09-15T10:00:00.110Z INFO  o.a.k.c.c.i.ConsumerCoordinator - (Re-)joining group inventory-sync-group",
            "2026-09-15T10:00:00.220Z INFO  c.e.warehouse.StockSyncListener - processing batch of 500 records (started at 10:00:00.220)",
            "2026-09-15T10:00:12.884Z WARN  o.a.k.c.c.i.ConsumerCoordinator - Member consumer-inventory-sync-3 sending LeaveGroup because consumer poll timeout has expired",
            "2026-09-15T10:00:13.010Z INFO  o.a.k.c.c.i.ConsumerCoordinator - (Re-)joining group inventory-sync-group",
            "2026-09-15T10:00:13.884Z INFO  c.e.warehouse.StockSyncListener - processing batch of 500 records (started at 10:00:13.884) [reprocessing offsets from before last commit]",
          ],
        },
        age: "20d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "inventory-sync-consumer-notes", namespace: "warehouse" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "spring:\n  kafka:\n    consumer:\n      max-poll-records: 500\n      properties:\n        max.poll.interval.ms: 10000\n        session.timeout.ms: 8000\n",
            "notes.md":
              "`StockSyncListener` processes each batch of up to 500 records\nsynchronously in the same thread that calls `poll()`, applying stock\nadjustments one at a time to the warehouse system's own API (which takes\nroughly 20-30ms per call under normal load, longer under contention).\n`max.poll.interval.ms` bounds how long the consumer is allowed to take\nbetween successive `poll()` calls before the broker assumes it's dead and\nkicks it out of the group; offsets for records already applied before a\ntimeout aren't necessarily committed yet at that point.",
          },
        },
        age: "20d",
      },
    ],
  },
  hints: [
    "`kubectl logs inventory-sync-consumer-7s8t9u0v1-w2x3y -n warehouse` - `sending LeaveGroup because consumer poll timeout has expired`, followed by rejoining and reprocessing offsets from before the last commit. What's actually causing the timeout?",
    "`kubectl get configmap inventory-sync-consumer-notes -n warehouse -o yaml` - how long does `max.poll.interval.ms` allow between polls, and how long can processing 500 records synchronously actually take once each warehouse API call gets a bit slower under load?",
    "A consumer that takes too long between `poll()` calls gets treated as dead and kicked from the group, triggering a rebalance - but if it hadn't actually committed offsets for everything it had already processed, whoever picks up those partitions next starts from the last committed offset, reprocessing records that were already (successfully) applied.",
  ],
  options: [
    {
      id: "max-poll-interval-too-short-for-synchronous-batch-processing",
      label:
        "`StockSyncListener` processes each batch of up to 500 records synchronously, one warehouse API call at a time, inside the same thread that calls `poll()`; `max.poll.interval.ms` is set to only 10 seconds, and under moderately busy load each API call gets slightly slower, pushing total batch processing time past that limit - the broker assumes the consumer is dead, kicks it from the group, and whichever consumer picks up those partitions next resumes from the last *committed* offset, reprocessing every record from that batch that was already successfully applied before the timeout fired.",
      explanation:
        "The log shows exactly this: `sending LeaveGroup because consumer poll timeout has expired`, followed immediately by rejoining and a batch explicitly marked `[reprocessing offsets from before last commit]`. `inventory-sync-consumer-notes` explains why the timeout fires under load: 500 records processed synchronously, one warehouse API call at a time (20-30ms each under normal conditions, more under contention), can easily exceed a `max.poll.interval.ms` of only 10 seconds once per-call latency creeps up even slightly - and any records already applied but not yet committed at that point get reprocessed once a new consumer takes over the partition.",
    },
    {
      id: "warehouse-api-itself-nonidempotent",
      label: "The warehouse system's own stock-adjustment API is simply non-idempotent and the real fix belongs there.",
      explanation:
        "Making the downstream API idempotent would be a reasonable defense-in-depth measure, but it doesn't address why the same batch is being delivered and processed multiple times in the first place - the logs point squarely at a rebalance being triggered by a poll-interval timeout during exactly the batches large enough to take too long.",
    },
    {
      id: "three-consumers-fighting-over-partitions",
      label: "Three consumer replicas are simply too many for the topic's partition count, causing contention.",
      explanation:
        "The log shows a specific, named trigger for the group membership churn - a poll-interval timeout on one member, not partition-count-driven contention - and the notes confirm the actual bottleneck is synchronous per-record processing time relative to the configured timeout, unrelated to how many consumers exist relative to partitions.",
    },
    {
      id: "kafka-broker-duplicating-messages",
      label: "The Kafka broker itself is duplicating message delivery under load.",
      explanation:
        "Kafka's at-least-once delivery model can produce duplicates after a rebalance, but the specific mechanism here is visible directly in this consumer's own logs - a self-inflicted `LeaveGroup` from exceeding its own poll interval - not a broker-side delivery bug producing duplicates independent of consumer behavior.",
    },
  ],
  correctOptionId: "max-poll-interval-too-short-for-synchronous-batch-processing",
  resolution: `The log shows the mechanism directly: \`sending LeaveGroup because
consumer poll timeout has expired\`, followed by rejoining the group and a
batch explicitly logged as \`[reprocessing offsets from before last
commit]\`. The consumer wasn't crashing or losing its connection - it was
voluntarily leaving the group because it took too long between calls to
\`poll()\`.

\`inventory-sync-consumer-notes\` explains why that happens specifically
under moderate load: \`StockSyncListener\` processes each batch of up to
500 records entirely synchronously, in the same thread that calls
\`poll()\`, applying one stock adjustment via a warehouse API call at a
time. Under normal conditions each call takes 20-30ms, keeping a full
batch comfortably under \`max.poll.interval.ms\`'s configured 10 seconds -
but under even modest additional load, per-call latency creeping up
slightly is enough to push total batch time past that limit. Once it
does, the broker assumes the consumer is dead, evicts it, and triggers a
rebalance - and because offsets for records already applied during that
batch weren't necessarily committed yet, whichever consumer picks up
those partitions next resumes from the last *committed* offset,
reprocessing records the previous consumer had already successfully
applied moments before being kicked out.

Two changes address this together: give processing more headroom before
the broker gives up on it, and commit progress more often so less work
has to be redone if a rebalance does happen:

\`\`\`yaml
spring:
  kafka:
    consumer:
      max-poll-records: 100
      properties:
        max.poll.interval.ms: 60000
        session.timeout.ms: 15000
    listener:
      ack-mode: COUNT
      ack-count: 20
\`\`\`

Smaller batches, a longer poll-interval budget, and more frequent offset
commits together reduce both how likely a slow batch is to trigger an
eviction, and how much gets reprocessed on the rare occasion one still
does.`,
};
