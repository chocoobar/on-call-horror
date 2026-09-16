import type { Scenario } from "../types";

export const theConfigmapSyncDelayFlap: Scenario = {
  id: "the-configmap-sync-delay-flap",
  title: "The ConfigMap Sync Delay Flap",
  subtitle: "feature-router's behavior flickers between two configs for about a minute after every update",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "configmap", "consistency"],
  briefing: `"feature-router" watches its mounted ConfigMap file for changes and hot-reloads
without a restart - a deliberate design to allow instant config updates.
For roughly the last minute after every single update, though, its three
replicas visibly disagree with each other about which config is active,
routing some requests inconsistently before settling down.`,
  constraints: [
    "All three replicas are healthy and running the exact same code and image - there's no version skew between them.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "feature-router-config", namespace: "routing" },
        spec: { data: { "routes.yaml": "default_backend: v2-service\n" } },
        age: "90s",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "feature-router", namespace: "routing", labels: { app: "feature-router" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "feature-router", image: "registry.internal/feature-router:4.0.0", volumeMounts: [{ name: "config", mountPath: "/etc/router" }] }], volumes: [{ name: "config", configMap: { name: "feature-router-config" } }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "feature-router-9w0x1y2z3-a4b5c", namespace: "routing", labels: { app: "feature-router" } },
        status: { phase: "Running", containerStatuses: [{ name: "feature-router", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: { "feature-router": ["2026-09-15T10:00:00.100Z INFO  router.Watcher - detected routes.yaml change, now routing to v2-service"] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "feature-router-9w0x1y2z3-d6e7f", namespace: "routing", labels: { app: "feature-router" } },
        status: { phase: "Running", containerStatuses: [{ name: "feature-router", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: { "feature-router": ["2026-09-15T10:00:47.800Z INFO  router.Watcher - detected routes.yaml change, now routing to v2-service"] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kubelet-sync-behavior-notes", namespace: "routing" },
        spec: {
          data: {
            "notes.md":
              "A ConfigMap volume mount is not updated in every pod at the exact same\ninstant - each node's kubelet independently syncs mounted ConfigMap\ndata on its own periodic sync interval (bounded by, among other things,\nthe kubelet's configured sync frequency and its local cache TTL for\nConfigMap objects, commonly up to about a minute by default). Pods on\ndifferent nodes can therefore observe a ConfigMap update anywhere from\nnear-instantly to roughly that sync interval later, which is exactly\nwhy feature-router-9w0x1y2z3-a4b5c (on one node) picked up the change at\n10:00:00 while feature-router-9w0x1y2z3-d6e7f (on a different node)\ndidn't see it until 10:00:47 - both are behaving completely correctly\ngiven how ConfigMap volume propagation actually works; there's no bug\nin either the app or Kubernetes here.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs` each replica around the same config update - do they all detect and apply the change at exactly the same moment?",
    "A ConfigMap mounted as a volume doesn't update in every pod simultaneously - what actually controls when a given pod's mounted files reflect a new ConfigMap version?",
    "`kubectl get configmap kubelet-sync-behavior-notes -n routing -o yaml` - is this actually a bug, or an expected (if under-documented) property of how ConfigMap volumes propagate?",
  ],
  options: [
    {
      id: "kubelet-sync-interval-causes-propagation-skew",
      label:
        "A mounted ConfigMap's contents don't update simultaneously across every pod - each node's kubelet syncs the mounted data on its own periodic interval (commonly up to about a minute), so pods on different nodes naturally observe a config change at different times, anywhere from nearly instant to close to that full interval later - which is exactly why feature-router's replicas visibly disagree for roughly a minute after every update: it's expected ConfigMap volume propagation behavior, not a bug in the application or a Kubernetes malfunction.",
      explanation:
        "The two replicas' logs show the same config change detected 47 seconds apart, despite running identical code with no version skew. `kubelet-sync-behavior-notes` explains this as the expected mechanism: ConfigMap volume updates propagate per-node on each kubelet's own sync interval, not atomically cluster-wide, so a brief window where different replicas are serving from different config versions is an inherent, documented property of this pattern - not a defect to be root-caused away, but a real consistency window the application design needs to account for.",
    },
    {
      id: "configmap-write-not-atomic",
      label: "The ConfigMap's underlying storage in etcd isn't updating atomically, producing a partial write window.",
      explanation:
        "etcd writes to a single object like a ConfigMap are atomic - there's no partial-write state visible to readers. The propagation delay here is specifically about how and when each node's kubelet syncs an *already fully updated* ConfigMap out to its local pods' mounted volumes, not about any inconsistency in the ConfigMap object itself.",
    },
    {
      id: "one-replica-has-stale-image",
      label: "One of the replicas is running a stale image version with different config-watching logic.",
      explanation:
        "The scenario confirms all three replicas run the identical image and code with no version skew - both replicas' log lines even show the identical log message format and behavior, just at different times, which is inconsistent with a code-version difference and consistent with a timing/propagation difference instead.",
    },
    {
      id: "watcher-race-condition-in-app",
      label: "feature-router's file-watching code has an internal race condition causing it to miss change events.",
      explanation:
        "Both replicas shown did correctly detect and apply the change - neither missed the event entirely, they simply detected it at different times. A missed-event race condition would look like a replica never picking up the change at all, not all replicas eventually converging correctly after a delay.",
    },
  ],
  correctOptionId: "kubelet-sync-interval-causes-propagation-skew",
  resolution: `Both replicas' logs show the identical event - detecting the same config
change and switching to the same backend - just 47 seconds apart, with
zero code or version difference between them. \`kubelet-sync-behavior-notes\`
explains this as expected, documented behavior rather than a bug: a
ConfigMap mounted as a volume doesn't update atomically across every
pod - each node's kubelet independently syncs mounted ConfigMap data on
its own periodic interval, so pods on different nodes can observe the
same underlying change anywhere from nearly instantly to close to that
full sync interval later. feature-router's hot-reload design is working
exactly as intended on each individual replica; the inconsistency is an
inherent property of how ConfigMap volumes propagate across a
multi-node, multi-replica deployment, not a defect in the application or
in Kubernetes.

Since this can't be eliminated outright (some propagation skew across
nodes is inherent to the mechanism), the fix is designing around it
rather than trying to make it instantaneous. Options, in order of
typical preference:

- If sub-minute consistency across replicas genuinely matters (as it
  does here, given visibly inconsistent routing), move config
  distribution to something with atomic, coordinated rollout semantics -
  a proper rolling deployment triggered by a config-hash annotation, so
  every replica gets the new config as part of one coordinated rollout
  rather than independently drifting into it.
- If hot-reload must be kept, add a brief "staged" transition (e.g. a
  version/generation number embedded in the config that replicas
  cross-check before fully committing to a change) so a temporary
  disagreement doesn't translate into visibly inconsistent request
  routing.
- At minimum, document the expected propagation window explicitly so a
  future on-call engineer doesn't spend time chasing this as if it were
  a bug, the way this investigation initially did.`,
};
