import type { Scenario } from "../types";

export const theMessageThatLostItsTrace: Scenario = {
  id: "the-message-that-lost-its-trace",
  title: "The Message That Lost Its Trace",
  subtitle: "every trace for order-service ends the instant a message hits the queue",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["tracing", "kafka", "async"],
  briefing: `Root-causing intermittent order-fulfillment delays should be straightforward
with distributed tracing in place across "order-service" and
"fulfillment-worker" - except every trace tells the same incomplete
story: a clean span for order-service publishing a message to Kafka, and
then silence. Whatever fulfillment-worker does with that message never
shows up connected to the same trace.`,
  constraints: [
    "fulfillment-worker's own logs confirm it does process every message, including the slow ones - the work is real and is happening.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "order-service", namespace: "orders", labels: { app: "order-service" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "fulfillment-worker", namespace: "fulfillment", labels: { app: "fulfillment-worker" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "order-service-producer-notes", namespace: "orders" },
        spec: {
          data: {
            "OrderPublisher.java.excerpt":
              'ProducerRecord<String, byte[]> record =\n    new ProducerRecord<>("orders.created", orderId, payload);\n// NOTE: no trace-context headers attached to the record - the\n// OpenTelemetry Kafka producer instrumentation that would normally\n// inject a "traceparent" header automatically is not active here,\n// because this service constructs its own raw KafkaProducer instead of\n// going through the wrapped/instrumented client the platform team\n// provides.\nproducer.send(record);\n',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fulfillment-worker-consumer-notes", namespace: "fulfillment" },
        spec: {
          data: {
            "OrderConsumer.java.excerpt":
              '@Override\npublic void onMessage(ConsumerRecord<String, byte[]> record) {\n    // looks for a "traceparent" header to continue an existing trace;\n    // falls back to starting a brand-new root span if none is present.\n    Context extracted = propagator.extract(Context.current(), record, getter);\n    // ...\n}\n',
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap order-service-producer-notes -n orders -o yaml` - how does order-service actually construct the Kafka producer it uses to publish messages?",
    "`kubectl get configmap fulfillment-worker-consumer-notes -n fulfillment -o yaml` - what does the consumer do when it can't find a `traceparent` header on an incoming message?",
    "OpenTelemetry's automatic Kafka instrumentation injects trace context into message headers on send, and extracts it on receive - but only when the client library it's actually wrapping is the one being used to send.",
  ],
  options: [
    {
      id: "raw-kafka-producer-skips-context-injection",
      label:
        "order-service constructs its own raw `KafkaProducer` instead of using the platform's instrumented client wrapper, so no `traceparent` header ever gets attached to published messages - fulfillment-worker's consumer correctly looks for that header, finds nothing, and starts a disconnected root span instead of continuing the original trace, even though it's genuinely processing every message including the slow ones.",
      explanation:
        "`order-service-producer-notes` shows the producer is a raw `KafkaProducer`, explicitly noted as bypassing the platform's instrumented client that would normally auto-inject a `traceparent` header. `fulfillment-worker-consumer-notes` shows the consumer correctly attempts to extract that header but falls back to a fresh root span when it's missing - exactly what happens here. The work is real (fulfillment-worker's logs confirm it), it's just untethered from the originating trace because the context was never attached to the message in the first place.",
    },
    {
      id: "kafka-broker-stripping-headers",
      label: "The Kafka broker configuration is stripping custom headers from messages in transit.",
      explanation:
        "Kafka brokers pass message headers through transparently by default and there's no broker-level configuration mentioned here that would strip them - the evidence points specifically at the header never being attached at the producer side in the first place, not at it being attached and then lost.",
    },
    {
      id: "fulfillment-worker-sampling-out-consumer-spans",
      label: "fulfillment-worker's tracing sampling configuration is dropping its consumer spans.",
      explanation:
        "fulfillment-worker's consumer code is shown correctly attempting context extraction and creating spans either way (connected or as a new root) - a sampling decision made after that point wouldn't explain why the resulting trace is disconnected specifically, only whether it's kept at all.",
    },
    {
      id: "different-tracing-backends-per-service",
      label: "order-service and fulfillment-worker are configured to send traces to two different, disconnected tracing backends.",
      explanation:
        "There's no evidence of a backend split here - both services' consumer/producer code is shown using the same context-propagation mechanism (headers plus a shared propagator), which only makes sense if they're expected to report to the same tracing system; the disconnect is in what context gets attached to the message, not where completed traces are sent.",
    },
  ],
  correctOptionId: "raw-kafka-producer-skips-context-injection",
  resolution: `\`order-service-producer-notes\` shows the actual cause directly: this
service builds its own raw \`KafkaProducer\` rather than going through the
platform's instrumented client wrapper, so the automatic OpenTelemetry
Kafka instrumentation that would normally inject a \`traceparent\` header
into every outgoing record's headers never runs. The message is published
with a real, intact payload and no trace context attached to it at all.
\`fulfillment-worker-consumer-notes\` shows the consumer side working
correctly - it tries to extract a \`traceparent\` header via
\`propagator.extract(...)\`, and when that comes up empty (as it always
does here), it falls back to starting a fresh, disconnected root span
rather than failing outright. The processing is genuinely happening, and
genuinely instrumented - it's just never given anything to link back to
the request that triggered it.

This is a common gap wherever a team hand-rolls a client library instead
of using an already-instrumented one: automatic instrumentation typically
wraps a *specific* client construction path, and bypassing it (a raw
constructor, a custom builder, a different library entirely) silently
opts out of context propagation with no error to flag it.

The fix is switching order-service to the platform's instrumented
producer, or manually injecting the trace context into the record headers
if that's not immediately possible:

\`\`\`java
ProducerRecord<String, byte[]> record =
    new ProducerRecord<>("orders.created", orderId, payload);
propagator.inject(Context.current(), record, (r, k, v) ->
    r.headers().add(k, v.getBytes(StandardCharsets.UTF_8)));
producer.send(record);
\`\`\`

Once the \`traceparent\` header is actually attached at publish time,
fulfillment-worker's existing extraction logic picks it up automatically
and continues the original trace instead of starting a new one - turning
two disconnected halves of the same operation back into one traceable
request.`,
};
