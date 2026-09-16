import type { Scenario } from "./types";

export const theStatefulsetStartupJam: Scenario = {
  id: "the-statefulset-startup-jam",
  title: "The StatefulSet Startup Jam",
  subtitle: "message-broker-2 through message-broker-5 are all just... waiting",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "statefulset", "startup"],
  briefing: `"message-broker" is a 5-node StatefulSet. An hour ago it was bumped to a
new config version. \`message-broker-0\` came up fine. \`message-broker-1\`
has been stuck at 0/1 Ready ever since - and every ordinal after it,
2 through 4, hasn't even been created yet.`,
  constraints: [
    "message-broker-0 is fully healthy and serving traffic normally - only ordinal 1 onward is affected.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "message-broker", namespace: "messaging", labels: { app: "message-broker" } },
        spec: { replicas: 5, serviceName: "message-broker", podManagementPolicy: "OrderedReady" },
        status: { readyReplicas: 1, updatedReplicas: 1, currentReplicas: 5 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "message-broker-0", namespace: "messaging", labels: { app: "message-broker" } },
        status: { phase: "Running", containerStatuses: [{ name: "message-broker", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "message-broker-1", namespace: "messaging", labels: { app: "message-broker" } },
        status: { phase: "Running", containerStatuses: [{ name: "message-broker", ready: false, restartCount: 5, state: { running: {} } }] },
        logs: {
          "message-broker": [
            "2026-09-15T10:00:01.100Z INFO  broker.Cluster - attempting to join cluster via seed message-broker-0.message-broker.messaging.svc:9094",
            "2026-09-15T10:00:31.552Z WARN  broker.Cluster - handshake with seed timed out, retrying (attempt 5)",
          ],
        },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "45s", message: "Readiness probe failed: cluster handshake incomplete" },
        ],
        age: "1h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "message-broker-network-notes", namespace: "messaging" },
        spec: {
          data: {
            "notes.md":
              "message-broker-0's own cluster-join port (9094) started refusing new\nhandshake connections after today's config bump - its inter-broker\nnetworking config accidentally got a `bind-address: 127.0.0.1` value\ninstead of `0.0.0.0`, so it only accepts loopback connections on that\nport now. message-broker-0 itself still reports fully healthy on its\nown (client-facing) readiness check, which is why it shows Running and\nReady while silently blocking every peer from joining.\n\nWith `podManagementPolicy: OrderedReady` (the StatefulSet default), each\nordinal must become Ready before the next one is even created.\n",
          },
        },
        age: "1h",
      },
    ],
  },
  hints: [
    "`kubectl get pods -n messaging` - only ordinals 0 and 1 even exist; 2 through 4 were never created at all.",
    "`kubectl logs message-broker-1 -n messaging` - it's stuck retrying a handshake to `message-broker-0`, not crashing.",
    "`kubectl get statefulset message-broker -n messaging -o yaml` - check `spec.podManagementPolicy`. What does `OrderedReady` require before the next ordinal is even created?",
  ],
  options: [
    {
      id: "ordered-ready-blocked-by-broker0-bind-address",
      label:
        "message-broker-0's inter-broker cluster port got misconfigured to `bind-address: 127.0.0.1` in today's config bump, so it silently refuses peer handshake connections on port 9094 while still reporting healthy on its own client-facing readiness check - message-broker-1 can never complete its handshake and become Ready, and because the StatefulSet's default `OrderedReady` policy creates each ordinal only after the previous one is Ready, ordinals 2 through 4 never even get created.",
      explanation:
        "`message-broker-network-notes` explains the mechanism precisely: broker-0's bind address regressed to loopback-only for its inter-broker port, so it looks perfectly healthy (its own readiness check is about client traffic, unaffected) while actually blocking every peer connection on the cluster port. message-broker-1's own logs show it repeatedly timing out trying to handshake with broker-0 specifically. `OrderedReady` (the StatefulSet default `podManagementPolicy`) requires each ordinal to become Ready before the next is created at all, which explains why ordinals 2-4 don't exist yet rather than also being stuck Pending or CrashLooping.",
    },
    {
      id: "message-broker-1-config-bad",
      label: "message-broker-1's own config from the bump is broken, unrelated to broker-0.",
      explanation:
        "message-broker-1's logs show it actively attempting and retrying a handshake against a specific target, `message-broker-0`, rather than failing to start or parse its own config - the retries are consistent with the *target* refusing the connection, not with broker-1's own configuration being invalid.",
    },
    {
      id: "statefulset-replica-count-wrong",
      label: "The StatefulSet's `spec.replicas` was accidentally set below 5.",
      explanation:
        "`spec.replicas` is confirmed at 5, and `status.currentReplicas: 5` shows the StatefulSet does intend to create all 5 - ordinals 2 through 4 simply haven't been created *yet*, which `OrderedReady`'s sequential creation behavior fully explains without needing a replica-count problem.",
    },
    {
      id: "headless-service-dns-broken",
      label: "The StatefulSet's headless Service isn't resolving pod DNS names correctly.",
      explanation:
        "message-broker-1's logs show it successfully reaching and attempting a handshake with `message-broker-0.message-broker.messaging.svc:9094` - meaning DNS resolution to that address is working. The failure happens after the connection is made, at the handshake step, not at name resolution.",
    },
  ],
  correctOptionId: "ordered-ready-blocked-by-broker0-bind-address",
  resolution: `\`message-broker-network-notes\` names the exact regression: broker-0's
inter-broker port (9094) got bound to \`127.0.0.1\` instead of \`0.0.0.0\` in
today's config bump, so it only accepts loopback connections on that
port - it can't be reached by any other pod, including message-broker-1.
Crucially, broker-0's *own* readiness check only covers client-facing
traffic, which is unaffected, so it shows up fully healthy while quietly
blocking every peer. message-broker-1's logs confirm it: repeated
handshake timeouts against broker-0 specifically. With the StatefulSet's
default \`podManagementPolicy: OrderedReady\`, each ordinal has to become
Ready before the *next* one is even created - so with ordinal 1 stuck,
ordinals 2 through 4 are correctly waiting their turn and simply don't
exist yet.

The fix is correcting broker-0's bind address back to accept
non-loopback connections:

\`\`\`yaml
# broker config for message-broker-0 (and template, so future
# ordinals don't inherit the same regression)
inter_broker:
  bind_address: 0.0.0.0
  port: 9094
\`\`\`

Once broker-0 accepts real peer connections again, message-broker-1's
handshake succeeds, it becomes Ready, and \`OrderedReady\` proceeds to
create and start ordinals 2 through 4 in sequence automatically. This is
also a good argument for a readiness probe that reflects true cluster
health (able to see peers), not just "the client port answers" - a
broker that's healthy for clients but invisible to its own cluster
shouldn't report itself as fully Ready.`,
};
