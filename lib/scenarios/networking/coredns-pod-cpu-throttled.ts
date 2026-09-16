import type { Scenario } from "../types";

export const corednsPodCpuThrottled: Scenario = {
  id: "coredns-pod-cpu-throttled",
  title: "The DNS Slowdown Nobody's Service Caused",
  subtitle: "every team is convinced it's their own service. it's not any of them.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["coredns", "cpu-throttling", "cluster-wide"],
  briefing: `Over the past week, dozens of unrelated services across the cluster have
each independently reported occasional, seemingly random slow requests -
each team assuming it's a problem isolated to their own service. No two
affected services share a namespace, a node, or a common dependency other
than the cluster itself.`,
  constraints: [
    "The slow requests, wherever traced in detail, all show the delay concentrated in a single DNS lookup within the request, not in any application logic or downstream call.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "coredns", namespace: "kube-system", labels: { "k8s-app": "kube-dns" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "coredns", resources: { limits: { cpu: "200m" }, requests: { cpu: "100m" } } }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "coredns-6f5e4d-h3i2j", namespace: "kube-system", labels: { "k8s-app": "kube-dns" } },
        status: { phase: "Running", containerStatuses: [{ name: "coredns", ready: true, restartCount: 0, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "CPUThrottlingHigh", age: "3h", message: "43.20% throttling of CPU in container coredns in pod coredns-6f5e4d-h3i2j" },
        ],
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "coredns-capacity-notes", namespace: "kube-system" },
        spec: {
          data: {
            "notes.md":
              "CoreDNS's 2 replicas were sized (100m request / 200m limit CPU each)\nwhen the cluster ran roughly a third of the pods it runs today - overall\ncluster pod count, and with it aggregate DNS query volume, has grown\nsteadily over the past two quarters without CoreDNS's own resourcing\never being revisited. Both CoreDNS pods now regularly hit their 200m CPU\nlimit during normal peak periods and get throttled by the kernel's CFS\nbandwidth controller - during a throttled window, individual queries\nqueue up behind CPU starvation and take substantially longer to answer,\nwhile queries handled outside a throttled window resolve normally and\nquickly. Because throttling windows are short, frequent, and effectively\nrandom relative to any given caller's own request pattern, the resulting\nslow lookups appear scattered unpredictably across whichever unrelated\nservices happen to make a DNS call during a throttled window, with no\nvisible correlation to anything about the affected service itself.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "The affected services share no namespace, node, or dependency other than the cluster - and every traced slow request bottlenecks specifically inside DNS resolution. What's the one thing every pod in the cluster depends on for DNS?",
    "`kubectl get events -n kube-system | grep -i throttl` (or check CoreDNS's own pod events) - is there anything suggesting CoreDNS itself is resource-constrained?",
    "`kubectl get configmap coredns-capacity-notes -n kube-system -o yaml` - has anything about the cluster's overall size changed significantly since CoreDNS's own resource limits were last set?",
  ],
  options: [
    {
      id: "coredns-undersized-getting-cpu-throttled",
      label:
        "CoreDNS's own CPU limits were sized for a cluster roughly a third the size it is today, and query volume has grown right along with it - both CoreDNS replicas now regularly hit their CPU limit during normal peak periods and get throttled by the kernel, causing individual DNS queries that happen to land during a throttled window to queue up and resolve slowly, while queries outside those windows resolve normally; since throttling windows are short and effectively random relative to any one caller, the resulting slowness appears scattered unpredictably across whichever unrelated services happen to make a DNS call at the wrong moment, matching reports with no common thread except the cluster itself.",
      explanation:
        "CoreDNS's own pod event states it directly: 43.20% CPU throttling. `coredns-capacity-notes` explains why this produces exactly the reported pattern: CoreDNS's resourcing was never revisited as the cluster grew roughly threefold, so it now regularly hits its CPU limit and gets throttled during normal peak periods - and because every pod in the cluster depends on the same shared CoreDNS deployment for DNS resolution, throttling-induced slow queries would naturally appear scattered across whichever unrelated services happen to query during a throttled window, with the delay concentrated specifically in DNS lookups, exactly as every affected team traced it.",
    },
    {
      id: "each-service-has-its-own-unrelated-bug",
      label: "Each affected service independently has its own unrelated performance bug that happens to look similar.",
      explanation:
        "Dozens of otherwise-unrelated services, sharing no namespace, node, or dependency, all independently developing a bug with the exact same signature - a delay isolated specifically to one DNS lookup - is a far less likely explanation than a single shared dependency (which every one of them does have in common: CoreDNS) being the actual bottleneck.",
    },
    {
      id: "network-policy-rules-slowing-dns-lookups",
      label: "A recently added, overly broad NetworkPolicy is adding processing overhead to every DNS lookup cluster-wide.",
      explanation:
        "There's no NetworkPolicy change indicated here, and a NetworkPolicy either allows or blocks a connection outright - it doesn't introduce variable, intermittent latency to individual queries the way CPU throttling on the DNS server itself does, which is exactly the pattern reported (some queries slow, most fine, no clear on/off boundary).",
    },
    {
      id: "node-level-dns-caching-daemon-misconfigured",
      label: "A node-local DNS caching daemon is misconfigured and adding latency to a subset of lookups.",
      explanation:
        "There's no indication a node-local DNS cache is even deployed in this cluster, and CoreDNS's own event log already directly confirms significant CPU throttling - a more specific, better-evidenced explanation for exactly the reported symptom than an unconfirmed, undocumented additional caching layer.",
    },
  ],
  correctOptionId: "coredns-undersized-getting-cpu-throttled",
  resolution: `CoreDNS's own pod event states the mechanism directly: 43.20% CPU
throttling. \`coredns-capacity-notes\` fills in why: CoreDNS's CPU
request/limit was sized when the cluster ran roughly a third of today's
pod count, and neither its replica count nor its per-pod resources were
ever revisited as the cluster - and with it, aggregate DNS query volume -
grew. Both CoreDNS pods now regularly hit their 200m CPU limit during
normal peak periods and get throttled by the kernel's CFS bandwidth
controller; queries that happen to be in flight during a throttled
window queue up behind CPU starvation and resolve slowly, while queries
outside those windows resolve normally and quickly. Because every pod in
the cluster shares this same CoreDNS deployment for DNS resolution, and
throttling windows are short, frequent, and effectively uncorrelated
with any particular caller's own request pattern, the resulting slow
lookups show up scattered unpredictably across whichever unrelated
services happen to query DNS at the wrong moment - exactly matching
reports from dozens of otherwise-unconnected teams, each isolated
individually to a delay concentrated specifically inside DNS resolution.

The fix is giving CoreDNS enough CPU headroom (and likely more replicas)
for the cluster's actual current size:

\`\`\`yaml
resources:
  requests:
    cpu: 300m
    memory: 128Mi
  limits:
    cpu: 800m
    memory: 256Mi
---
# and scale out replica count to match current node/pod count,
# e.g. via the cluster-proportional-autoscaler for CoreDNS
\`\`\`

CoreDNS is a shared, cluster-wide dependency that's easy to under-scale
silently, since its own resourcing rarely gets revisited alongside
organic cluster growth the way an individual team's own service
resourcing does - it's worth alerting directly on CoreDNS CPU throttling
and query latency percentiles specifically, rather than relying on
individual teams to notice and report symptoms that, from their own
vantage point, look like isolated, unrelated problems.`,
};
