import type { Scenario } from "./types";

export const theHeadlessDnsRace: Scenario = {
  id: "the-headless-dns-race",
  title: "The Headless DNS Race",
  subtitle: "kafka-broker-2 joins the cluster, then immediately gets kicked out as \"unreachable\"",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "statefulset", "dns"],
  briefing: `Scaling "kafka-broker" from 2 to 3 replicas keeps producing the same
result: \`kafka-broker-2\` starts, the other brokers briefly see it join
the cluster, and then within seconds they mark it unreachable and evict
it from the quorum. It repeats this cycle indefinitely instead of
settling.`,
  constraints: [
    "kafka-broker-2's own process is confirmed to be up, healthy, and listening on its ports the entire time - it never crashes.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "kafka-broker", namespace: "streaming", labels: { app: "kafka-broker" } },
        spec: { replicas: 3, serviceName: "kafka-broker-headless" },
        status: { readyReplicas: 2, updatedReplicas: 3, currentReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "kafka-broker-headless", namespace: "streaming" },
        spec: { clusterIP: "None", selector: { app: "kafka-broker" }, publishNotReadyAddresses: false },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "kafka-broker-2", namespace: "streaming", labels: { app: "kafka-broker" } },
        status: { phase: "Running", containerStatuses: [{ name: "kafka-broker", ready: false, restartCount: 0, state: { running: {} } }] },
        logs: {
          "kafka-broker": [
            "2026-09-15T10:00:02.100Z INFO  broker.Cluster - joined quorum, advertising as kafka-broker-2.kafka-broker-headless.streaming.svc:9092",
            "2026-09-15T10:00:09.410Z WARN  broker.Cluster - peer kafka-broker-0 reports DNS lookup for kafka-broker-2.kafka-broker-headless failed: NXDOMAIN, marking unreachable",
          ],
        },
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "headless-svc-readiness-notes", namespace: "streaming" },
        spec: {
          data: {
            "notes.md":
              "`kafka-broker-headless`'s Service has `publishNotReadyAddresses: false`\n(the default) - a headless Service's per-pod DNS record for a given pod\nonly exists once that pod is marked Ready, not merely Running. But\nkafka-broker's own application code advertises itself to peers\n(announcing its hostname over the wire) the instant it joins the\nquorum, well before its own readiness probe passes (which requires a\nfollow-up internal handshake). Peers that receive that early\nadvertisement and immediately try to resolve the new broker's DNS name\nget NXDOMAIN, because Kubernetes hasn't published that DNS record yet -\nthey mark it unreachable, which then prevents kafka-broker-2 from ever\ncompleting the handshake that would make it Ready in the first place.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl logs kafka-broker-2 -n streaming` - peers are failing a DNS lookup for *this pod's own* hostname, right after it announces itself.",
    "`kubectl get service kafka-broker-headless -n streaming -o yaml` - check `publishNotReadyAddresses`. When does a headless Service's per-pod DNS record actually become resolvable?",
    "Is kafka-broker-2 announcing itself to peers before or after its own readiness probe would pass?",
  ],
  options: [
    {
      id: "advertises-before-ready-dns-not-published-yet",
      label:
        "kafka-broker-2 advertises its own hostname to peers the instant it joins the quorum, but the headless Service's `publishNotReadyAddresses: false` means its per-pod DNS record doesn't actually exist until it's marked Ready - peers that receive the early self-announcement and immediately try to resolve it get NXDOMAIN and mark it unreachable, which then blocks the very handshake kafka-broker-2 needs to complete in order to become Ready, creating a loop it can never escape on its own.",
      explanation:
        "kafka-broker-2's own log shows exactly this sequence: it announces itself at 10:00:02, and 7 seconds later a peer reports the DNS lookup for its own hostname failing with `NXDOMAIN`. `headless-svc-readiness-notes` explains the timing gap precisely - `publishNotReadyAddresses: false` (the default) means a headless Service's DNS record for a pod isn't published until that pod is Ready, but the application announces itself to peers before that readiness gate is satisfied, creating a race the pod loses every time: peers can't resolve it yet, so they can't complete the handshake it needs to become Ready in the first place.",
    },
    {
      id: "cluster-dns-coredns-unhealthy",
      label: "CoreDNS itself is unhealthy and failing lookups intermittently.",
      explanation:
        "A generally unhealthy CoreDNS would produce widespread, inconsistent lookup failures across many services, not a specific and consistent NXDOMAIN for one pod's own headless-Service DNS record right before it becomes Ready - the failure here is specifically about a record that hasn't been published yet, which is expected, deterministic headless-Service behavior, not a DNS outage.",
    },
    {
      id: "kafka-broker-2-crashlooping",
      label: "kafka-broker-2 is repeatedly crashing and restarting, resetting the join process each time.",
      explanation:
        "The scenario confirms kafka-broker-2's process stays up and healthy throughout with `restartCount: 0` - it never crashes. The instability is entirely about peers being unable to resolve its DNS name at the moment they try, not about the pod itself failing to run.",
    },
    {
      id: "wrong-service-selector",
      label: "The headless Service's label selector doesn't match kafka-broker-2's pod labels.",
      explanation:
        "If the selector didn't match, kafka-broker-2 would never get a DNS record even once Ready, and no peer would ever succeed in reaching it at all - here the failure is specifically a timing race (DNS not published *yet*, not never), which points at the `publishNotReadyAddresses` readiness gate, not a selector mismatch.",
    },
  ],
  correctOptionId: "advertises-before-ready-dns-not-published-yet",
  resolution: `kafka-broker-2's own logs lay out the race precisely: it announces itself
to the cluster at 10:00:02, and a peer's DNS lookup for that exact
hostname fails with NXDOMAIN seven seconds later. \`headless-svc-readiness-notes\`
explains why: \`kafka-broker-headless\`'s \`publishNotReadyAddresses: false\`
(the default, sensible setting for most use cases) means a headless
Service's per-pod DNS record isn't published until the pod itself is
Ready - but kafka-broker's own application logic announces itself to
peers the moment it joins the quorum, which happens before its readiness
probe (gated on a further internal handshake) can pass. Peers that act on
that early announcement can't yet resolve the new broker's name, mark it
unreachable, and that rejection blocks the very handshake kafka-broker-2
needs in order to ever become Ready - a self-perpetuating loop with no
way out on its own.

Two possible fixes, and the cleaner one is changing when the application
announces itself rather than changing DNS visibility: delay the
self-announcement until after the local readiness condition (or at least
until a fixed short grace period post-startup) rather than broadcasting
immediately on quorum join. If the application can't be changed quickly,
the workaround is:

\`\`\`yaml
spec:
  publishNotReadyAddresses: true
\`\`\`

which makes DNS resolve pods before they're Ready, letting peers reach
kafka-broker-2 immediately - but this is a real tradeoff: it also means
*other* not-yet-ready pods become discoverable via DNS, which is
generally undesirable for anything besides this specific narrow
bootstrapping problem, and needs to be a deliberate choice, not a
blanket default. Fixing the application's own announcement timing is the
more durable path.`,
};
