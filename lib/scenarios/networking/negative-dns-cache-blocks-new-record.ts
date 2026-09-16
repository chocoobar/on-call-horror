import type { Scenario } from "../types";

export const negativeDnsCacheBlocksNewRecord: Scenario = {
  id: "negative-dns-cache-blocks-new-record",
  title: "The Negative Cache That Beat The New Record",
  subtitle: "the new service was created ten minutes ago. some callers still insist it doesn't exist.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["dns", "coredns", "negative-caching"],
  briefing: `A new internal service, "promo-engine," just launched. Most callers reach
it fine within seconds of its Service being created. A handful of pods
belonging to "storefront-web" - which had, seconds before promo-engine's
Service existed, made a premature call expecting it to already be there -
keep getting DNS resolution failures for promo-engine's hostname, even
minutes later, long after the Service is confirmed to exist and resolve
correctly from everywhere else.`,
  constraints: [
    "promo-engine's Service and Endpoints are confirmed correctly created and healthy, and resolve correctly from a freshly-started debug pod right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "promo-engine", namespace: "promotions", labels: { app: "promo-engine" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "11m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "promo-engine", namespace: "promotions" },
        spec: { type: "ClusterIP", clusterIP: "10.96.65.20", selector: { app: "promo-engine" }, ports: [{ port: 80 }] },
        age: "10m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "storefront-web-9f0g1h-i2j3k", namespace: "storefront2", labels: { app: "storefront-web" } },
        status: { phase: "Running", containerStatuses: [{ name: "storefront-web", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "storefront-web": [
            "2026-09-15T14:20:05.010Z ERROR c.e.storefront.PromoClient - java.net.UnknownHostException: promo-engine.promotions.svc.cluster.local",
            "2026-09-15T14:24:59.900Z ERROR c.e.storefront.PromoClient - java.net.UnknownHostException: promo-engine.promotions.svc.cluster.local",
          ],
        },
        age: "6h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "coredns", namespace: "kube-system" },
        spec: {
          data: {
            Corefile: ".:53 {\n    kubernetes cluster.local {\n        pods insecure\n        ttl 30\n    }\n    cache 30\n    forward . /etc/resolv.conf\n}\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dns-negative-cache-notes", namespace: "storefront2" },
        spec: {
          data: {
            "notes.md":
              "storefront-web's pods (long-running, 6h old) made a call to promo-\nengine's hostname roughly 30 seconds *before* promo-engine's Service was\nactually created, receiving an NXDOMAIN response. CoreDNS's `cache 30`\nplugin caches *negative* responses (NXDOMAIN) for up to 30 seconds, same\nas positive ones - but some client-side resolver stub libraries\n(including the glibc/JVM resolution path used here without further\ntuning) apply their own additional layer of negative-result caching on\ntop of whatever CoreDNS itself does, with a longer effective floor in\nsome configurations, and don't always honor the upstream TTL for\nnegative responses precisely. The result: this specific process's own\nin-process resolver cache kept treating the hostname as nonexistent well\npast CoreDNS's own 30-second negative cache window, because it cached\nthe *outcome* of its one unlucky first attempt independent of CoreDNS's\nown subsequent, now-correct answers.\n",
          },
        },
        age: "6h",
      },
    ],
  },
  hints: [
    "storefront-web's pod is 6 hours old - it made a first call to promo-engine's hostname well before promo-engine's Service even existed. What kind of DNS response would that first call have gotten?",
    "`kubectl get configmap coredns -n kube-system -o yaml` - CoreDNS caches negative (NXDOMAIN) responses too, not just successful ones. How long, per its `cache` plugin config?",
    "`kubectl get configmap dns-negative-cache-notes -n storefront2 -o yaml` - is there any caching layer *inside* storefront-web's own process, separate from and potentially longer-lived than CoreDNS's own negative cache?",
  ],
  options: [
    {
      id: "client-side-negative-cache-outlived-coredns-window",
      label:
        "storefront-web made an unlucky first call to promo-engine's hostname moments before its Service existed, getting a legitimate NXDOMAIN at that time - CoreDNS's own negative-cache window (30 seconds) has long since expired and it now answers correctly, but storefront-web's own in-process resolver applies its own separate layer of negative-result caching that outlived CoreDNS's window, so this specific process keeps treating the hostname as nonexistent based on its own stale, cached failure, independent of what CoreDNS itself would now answer.",
      explanation:
        "`dns-negative-cache-notes` explains the timing and the extra caching layer directly: storefront-web's pods are 6 hours old and made their first call roughly 30 seconds before promo-engine's Service was created, getting a real NXDOMAIN at the time. CoreDNS's own `cache 30` plugin would have cleared that negative result within 30 seconds - but a separate, longer-lived negative-caching layer inside storefront-web's own process (not honoring the same TTL) kept the failure cached well past that. promo-engine resolves correctly from anywhere else, including a fresh debug pod, confirming the DNS infrastructure itself is fine - only this one long-running process's own stale, cached outcome is wrong.",
    },
    {
      id: "coredns-not-picked-up-new-service",
      label: "CoreDNS itself hasn't picked up promo-engine's new Service yet.",
      explanation:
        "promo-engine is confirmed to resolve correctly right now from a freshly-started debug pod, meaning CoreDNS's own view (backed live by the Kubernetes API) is already correct - the failure is isolated to a specific, long-running caller's own resolution history, not to CoreDNS's own state.",
    },
    {
      id: "promo-engine-endpoints-not-populated",
      label: "promo-engine's Endpoints object hasn't been populated with pod IPs yet.",
      explanation:
        "The failure is a DNS resolution failure (`UnknownHostException`) happening before any connection attempt - an Endpoints population delay would produce a different symptom (successful DNS resolution followed by a connection failure to no available backend), not a hostname appearing not to exist at all.",
    },
    {
      id: "storefront-web-hardcoded-wrong-hostname",
      label: "storefront-web is calling a slightly different, incorrect hostname than promo-engine's actual name.",
      explanation:
        "The hostname in storefront-web's error log (`promo-engine.promotions.svc.cluster.local`) matches promo-engine's actual, correct fully-qualified Service name exactly - there's no typo or mismatch in the hostname itself; the issue is a stale cached result for that correct hostname.",
    },
  ],
  correctOptionId: "client-side-negative-cache-outlived-coredns-window",
  resolution: `\`dns-negative-cache-notes\` lays out the full timeline: storefront-web's
pods, already running for 6 hours, made a call to promo-engine's hostname
roughly 30 seconds *before* promo-engine's Service was actually created -
a legitimate NXDOMAIN at that exact moment, since the name genuinely
didn't exist yet. CoreDNS's own \`cache 30\` plugin caches negative results
for up to 30 seconds, which has long since expired; CoreDNS itself now
answers correctly, confirmed by promo-engine resolving fine from a fresh
debug pod. The gap is a separate, longer-lived negative-caching layer
inside storefront-web's own process, which doesn't honor the same TTL
CoreDNS uses - it cached the *outcome* of that one unlucky first attempt
and has kept serving that stale failure internally ever since, with no
reason to ever check again on its own.

There's no live fix for the already-affected pods short of restarting
them to clear their own in-process resolver cache, but the durable fix
is bounding or disabling that client-side negative-caching layer so it
can't outlive a transient, one-time resolution failure:

\`\`\`properties
# java.security, or set programmatically at startup
networkaddress.cache.negative.ttl=5
\`\`\`

Reducing (or eliminating) how long a process's own resolver caches a
*failed* lookup, separately from how long it caches a successful one,
avoids exactly this trap - a single unlucky, transient DNS miss (common
during any rollout where a client might race ahead of a new resource
actually existing) shouldn't get baked in as a long-lived, self-inflicted
outage for that one process.`,
};
