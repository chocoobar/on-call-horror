import type { Scenario } from "../types";

export const dnsSearchAppendedToFqdn: Scenario = {
  id: "dns-search-appended-to-fqdn",
  title: "The Short Name That Meant Two Different Things",
  subtitle: "one legacy job talks to the wrong 'metrics' entirely, and nobody touched its config",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["dns", "search-domain", "namespaces"],
  briefing: `A legacy batch job, "legacy-etl," has always sent its completion metrics to
a short hostname, just "metrics" - originally the name of a service that
lived alongside it in the same namespace years ago. Since a new "metrics"
Service was created in a completely different namespace last week for an
unrelated team's use, legacy-etl's metrics have been silently landing on
the wrong system entirely, with no errors anywhere.`,
  constraints: [
    "legacy-etl's own logs show every metrics call succeeding with a 200 response - it has no idea anything is wrong.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "legacy-etl", namespace: "etl", labels: { app: "legacy-etl" } },
        spec: { schedule: "0 * * * *" },
        age: "3y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "legacy-etl-29384710-k9l0m", namespace: "etl", labels: { app: "legacy-etl" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "legacy-etl", ready: false, restartCount: 0, state: { terminated: { reason: "Completed" } } }] },
        logs: {
          "legacy-etl": [
            "2026-09-15T05:00:12.010Z INFO  etl.MetricsReporter - posting completion metrics to http://metrics:9091/job/legacy-etl",
            "2026-09-15T05:00:12.140Z INFO  etl.MetricsReporter - metrics accepted (200)",
          ],
        },
        age: "10m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "metrics", namespace: "reporting2", labels: { app: "clickstream-metrics" } },
        spec: { clusterIP: "10.96.88.4", selector: { app: "clickstream-metrics" }, ports: [{ port: 9091 }] },
        age: "9d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "dns-search-notes", namespace: "etl" },
        spec: {
          data: {
            "notes.md":
              "Pods in this cluster get a DNS `search` list that includes every\nnamespace's short-form suffix in a shared order defined at the cluster\nlevel: `etl.svc.cluster.local`, then `reporting2.svc.cluster.local`, then\nothers, due to a non-default custom `dnsConfig` applied cluster-wide\nyears ago for a now-defunct multi-namespace service discovery scheme.\nA bare hostname like `metrics` (with zero dots, well under any `ndots`\nthreshold) gets tried against each search suffix in that fixed order\nuntil one resolves. There used to be a `metrics` Service in the `etl`\nnamespace itself years ago, which is what `legacy-etl` was originally\nwritten to reach - that Service no longer exists, so the very next\nsuffix in the search order, `reporting2.svc.cluster.local`, is what now\nresolves `metrics` to - an unrelated clickstream-metrics Service created\nlast week.\n",
          },
        },
        age: "3y",
      },
    ],
  },
  hints: [
    "legacy-etl calls a bare hostname, `metrics`, with no dots at all - where does a name like that actually get resolved to, given the pod's DNS search list?",
    "`kubectl get configmap dns-search-notes -n etl -o yaml` - what's the search order, and did a Service named `metrics` in the *first* searched namespace exist recently?",
    "A brand-new Service named `metrics` in a completely different namespace, created just last week, would become the very next thing a short, unqualified hostname resolves to once the original same-namespace one it depended on is gone.",
  ],
  options: [
    {
      id: "bare-hostname-resolved-into-wrong-namespace",
      label:
        "legacy-etl calls the bare, unqualified hostname `metrics`, which gets resolved via the pod's DNS search list - the original `metrics` Service that once lived in `etl` (the namespace the search order tries first) is long gone, so the search falls through to the next suffix in order, `reporting2.svc.cluster.local`, which now happens to have its own unrelated `metrics` Service (for clickstream data) as of last week - legacy-etl has been silently reporting its completion metrics there instead, with no error at any point since both Services accept the same request shape and return 200.",
      explanation:
        "`dns-search-notes` lays out the exact resolution path: a bare hostname like `metrics` gets tried against each namespace suffix in the cluster's DNS search order, and the `etl` namespace's own old `metrics` Service no longer exists, so resolution falls through to the next suffix, `reporting2.svc.cluster.local` - which now has its own, unrelated `metrics` Service, created just last week. legacy-etl's logs show a successful 200 response every time, exactly consistent with metrics being silently delivered to the wrong (but functioning) destination rather than failing outright.",
    },
    {
      id: "legacy-etl-app-bug-wrong-endpoint",
      label: "legacy-etl's own application code has a bug and is calling the wrong endpoint path.",
      explanation:
        "legacy-etl's logs show it calling exactly the hostname it's always been configured with (`metrics`) and getting a clean 200 - the application code hasn't changed and isn't malfunctioning; what changed is what that unqualified hostname now resolves to, due to a new same-named Service appearing in a namespace earlier in the DNS search order.",
    },
    {
      id: "new-metrics-service-misconfigured",
      label: "The new clickstream-metrics Service in reporting2 was misconfigured with the wrong selector.",
      explanation:
        "The new Service is functioning exactly as intended for its own team's use, correctly selecting its own clickstream-metrics pods and returning 200 to any caller - the issue is that an unrelated caller (legacy-etl) is unintentionally reaching it at all, due to DNS search-order resolution, not any misconfiguration on the new Service's own part.",
    },
    {
      id: "coredns-caching-stale-record",
      label: "CoreDNS is serving a stale cached record for the old `metrics` Service that no longer exists.",
      explanation:
        "There's no old record being served at all - the old `metrics` Service in `etl` is genuinely gone, and DNS correctly reports nothing there, which is exactly why resolution falls through to the next namespace in the search list rather than returning any cached, stale answer for the original one.",
    },
  ],
  correctOptionId: "bare-hostname-resolved-into-wrong-namespace",
  resolution: `\`dns-search-notes\` lays out the exact chain of events. legacy-etl has
always called a bare, unqualified hostname, \`metrics\`, which a pod's DNS
resolver handles by trying it against each suffix in the cluster's
configured search list, in order - starting with \`etl.svc.cluster.local\`,
the pod's own namespace, where a \`metrics\` Service genuinely used to live
years ago (which is what legacy-etl was originally written against).
That Service is long gone, so resolution silently falls through to the
*next* suffix in the search order, \`reporting2.svc.cluster.local\` - which,
as of last week, now has its own unrelated \`metrics\` Service for a
completely different team's clickstream data. Both accept the same kind
of request and return 200, so nothing about this ever surfaces as an
error anywhere - legacy-etl has simply been reporting into the wrong
system since the new Service appeared.

The fix is making legacy-etl's target fully qualified, removing any
dependency on search-order resolution and its accidental collisions:

\`\`\`yaml
# legacy-etl's job config
METRICS_ENDPOINT: "http://metrics.etl.svc.cluster.local:9091"
\`\`\`

and, since the original \`metrics\` Service in \`etl\` no longer exists, that
also surfaces the real underlying gap - legacy-etl needs to be pointed at
wherever its metrics are actually supposed to go today. Bare, unqualified
hostnames inside a cluster are inherently fragile to exactly this kind of
collision: any new Service created in a namespace earlier in the DNS
search order, sharing a short name with something a completely unrelated
caller already depends on, can silently redirect traffic with no error at
all. Fully-qualified service names avoid the ambiguity entirely.`,
};
