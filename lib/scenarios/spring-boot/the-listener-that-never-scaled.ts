import type { Scenario } from "../types";

export const theListenerThatNeverScaled: Scenario = {
  id: "the-listener-that-never-scaled",
  title: "The Listener That Never Scaled",
  subtitle: "clickstream-aggregator's consumer lag climbs steadily all day despite plenty of idle CPU",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "kafka", "spring-boot"],
  briefing: `"clickstream-aggregator" consumes a high-volume Kafka topic and has never
been able to keep its consumer lag near zero, even though the pod's CPU
and memory usage both sit comfortably low all day. Bumping replicas
hasn't helped as much as expected, and nobody can explain why a service
with so much idle headroom can't keep up with the topic's throughput.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "clickstream-aggregator", namespace: "analytics", labels: { app: "clickstream-aggregator" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "clickstream-aggregator", image: "registry.internal/clickstream-aggregator:2.0.1", resources: { requests: { cpu: "1000m" }, limits: { cpu: "2000m" } } },
              ],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "60d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "clickstream-aggregator-0l1m2n3o4-p5q6r", namespace: "analytics", labels: { app: "clickstream-aggregator" } },
        status: { phase: "Running", containerStatuses: [{ name: "clickstream-aggregator", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "clickstream-aggregator": [
            "2026-09-15T13:00:00.110Z INFO  o.a.k.c.c.i.ConsumerCoordinator - Assigned partitions [clickstream-events-0, clickstream-events-1, clickstream-events-2, clickstream-events-3, clickstream-events-4, clickstream-events-5, clickstream-events-6, clickstream-events-7, clickstream-events-8, clickstream-events-9, clickstream-events-10, clickstream-events-11] to consumer group clickstream-aggregator-group",
            "2026-09-15T13:00:00.220Z INFO  o.s.k.l.KafkaMessageListenerContainer - clickstream-events: partitions assigned: [clickstream-events-0 ... clickstream-events-11]",
            "2026-09-15T13:15:00.884Z WARN  c.e.analytics.LagMonitor - consumer group clickstream-aggregator-group lag now 4.2M records and climbing",
          ],
        },
        age: "60d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "clickstream-aggregator-notes", namespace: "analytics" },
        spec: {
          data: {
            "notes.md":
              "The `clickstream-events` topic has 12 partitions. Each\nclickstream-aggregator pod runs a `@KafkaListener` on the topic. Spring\nKafka's `@KafkaListener` defaults `concurrency` to 1 - a single listener\nthread per container instance, regardless of how many partitions that\ncontainer's consumer group assignment includes. One thread processes all\nassigned partitions strictly sequentially, one record at a time, even if\nthe pod has multiple CPU cores sitting completely idle.",
          },
        },
        age: "60d",
      },
    ],
  },
  hints: [
    "`kubectl logs clickstream-aggregator-0l1m2n3o4-p5q6r -n analytics` - a single pod got assigned 12 partitions (out of 12 total on the topic). How many threads are actually consuming from them?",
    "CPU usage staying low despite growing lag is the key tell - what would low CPU with high lag usually mean about how many things are actually running concurrently inside the process?",
    "`kubectl get configmap clickstream-aggregator-notes -n analytics -o yaml` - what does `@KafkaListener`'s `concurrency` setting default to, and what does that mean for a container assigned many partitions?",
  ],
  options: [
    {
      id: "kafka-listener-concurrency-defaults-to-one",
      label:
        "`@KafkaListener`'s `concurrency` was never explicitly set, so it defaults to 1 - a single listener thread per pod processing every one of its assigned partitions strictly sequentially, regardless of how many CPU cores are available; with 12 partitions on the topic and effectively one thread consuming them across the whole consumer group's pods, throughput is capped far below what the available CPU (which sits mostly idle) could actually support, explaining both the steadily climbing lag and the surprisingly low resource utilization.",
      explanation:
        "The consumer coordinator log shows a single pod assigned a large share of the topic's 12 partitions, and `LagMonitor` confirms lag climbing steadily despite CPU sitting low. `clickstream-aggregator-notes` names the default directly: `@KafkaListener`'s `concurrency` defaults to 1, meaning one thread per container processes every assigned partition one record at a time - CPU stays low precisely because there's no concurrent processing happening within the pod to actually use the available cores, capping total throughput regardless of how many replicas or how much CPU headroom exists.",
    },
    {
      id: "kafka-broker-undersized",
      label: "The Kafka broker cluster itself is undersized and can't serve records fast enough.",
      explanation:
        "A broker-side bottleneck would typically show up as elevated broker-side metrics or fetch latency, not as low CPU usage specifically inside the *consumer* pods - the evidence here points at processing capacity on the consumer side being the limiting factor, not the broker's ability to serve data.",
    },
    {
      id: "topic-partition-count-too-low",
      label: "The topic's 12 partitions is simply too few to support the required throughput at any configuration.",
      explanation:
        "12 partitions can support significant parallelism if actually exploited - the problem described is that this service isn't using more than one thread per pod to consume them in the first place, which is a consumer-side concurrency setting, not an inherent ceiling imposed by partition count itself.",
    },
    {
      id: "message-deserialization-too-slow",
      label: "Message deserialization logic is too slow and is the actual bottleneck.",
      explanation:
        "Slow per-message processing would show up as elevated CPU usage while lag grows, since the JVM would be busy doing that work - the described symptom is specifically low CPU with high lag, which points at insufficient concurrency (not enough work happening at once) rather than each unit of work being expensive.",
    },
  ],
  correctOptionId: "kafka-listener-concurrency-defaults-to-one",
  resolution: `The consumer coordinator log shows a single pod assigned a large chunk of
the topic's 12 partitions at once, and \`LagMonitor\` confirms lag climbing
steadily - \`4.2M records and climbing\` - while CPU usage across the
fleet stays low the whole time. Low CPU alongside growing lag is the
tell: if the bottleneck were genuine processing cost, CPU would be
climbing right along with the backlog.

\`clickstream-aggregator-notes\` names the actual limit: \`@KafkaListener\`'s
\`concurrency\` property was never explicitly configured, so it defaults to
\`1\` - a single listener thread per container instance, responsible for
*every* partition that pod's consumer group assignment includes,
processed strictly sequentially, one record at a time. However many CPU
cores the pod has available, only one of them is ever doing real work at
any given moment; the rest sit idle by construction, not by any actual
lack of demand.

The fix is raising \`concurrency\` so each pod runs multiple listener
threads, letting it actually use the CPU it's been allocated:

\`\`\`java
@KafkaListener(
    topics = "clickstream-events",
    groupId = "clickstream-aggregator-group",
    concurrency = "4"
)
public void onMessage(ClickstreamEvent event) { ... }
\`\`\`

\`\`\`yaml
resources:
  requests: { cpu: 1000m }
  limits: { cpu: 2000m }
\`\`\`

\`concurrency\` should be sized relative to both the number of partitions a
single pod might be assigned and the CPU actually available to it -
Spring Kafka's default of one thread per listener container is a safe,
conservative starting point, but it silently caps throughput well below
what the infrastructure around it (partitions, CPU, replicas) could
otherwise support.`,
};
