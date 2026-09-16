import type { Scenario } from "../types";

export const networkpolicyOrderBlocksMonitoring: Scenario = {
  id: "networkpolicy-order-blocks-monitoring",
  title: "The Policy That Forgot The Scraper",
  subtitle: "every dashboard for one namespace has been blank for two days, and nobody's paged because the alerts depend on the same missing data",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["networkpolicy", "prometheus", "ingress"],
  briefing: `Two days ago, "fulfillment" adopted a namespace-wide default-deny ingress
NetworkPolicy with explicit allow rules for its own internal traffic, as
part of a security hardening initiative. Every internal call between
fulfillment's own services still works. Every Prometheus target in that
namespace has been silently reporting as down ever since, and every
metric-based alert for the namespace has gone completely quiet as a
result - not firing, just producing no data at all.`,
  constraints: [
    "Prometheus's own target scrape errors show connection timeouts, not authentication or TLS failures.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipment-worker", namespace: "fulfillment", labels: { app: "shipment-worker" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "fulfillment-default-deny-ingress", namespace: "fulfillment", labels: { "policy-baseline": "true" } },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress"],
          ingress: [
            { from: [{ podSelector: {} }] },
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-scrape-notes", namespace: "fulfillment" },
        spec: {
          data: {
            "notes.md":
              "Prometheus itself runs as a separate deployment in the `monitoring`\nnamespace and scrapes every workload namespace's pods directly over\ntheir metrics port via pod IP, on a fixed interval, driven by\nServiceMonitor/PodMonitor discovery. The new `fulfillment-default-deny-\ningress` NetworkPolicy allows ingress only from other pods *within the\nsame namespace* (a bare `podSelector: {}` with no `namespaceSelector`\nonly ever matches within the policy's own namespace) - Prometheus's\nscraper pods, living in the separate `monitoring` namespace, aren't\ncovered by that rule at all, and there's no additional ingress rule\ngranting them access. Every scrape attempt against any pod in\n`fulfillment` now times out, which Prometheus surfaces as each target\nbeing 'down' - and because every alert rule for this namespace is\nbuilt on top of those same now-missing metrics, none of them can\nevaluate to true (or false) at all, so nothing pages despite a real,\nongoing loss of visibility into the whole namespace.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get networkpolicy fulfillment-default-deny-ingress -n fulfillment -o yaml` - the one ingress rule allows traffic from a bare `podSelector: {}` with no `namespaceSelector`. What namespace does that actually cover?",
    "Prometheus's own scraper pods live in a completely different namespace (`monitoring`) than the services they scrape - does the new policy have any rule permitting ingress from outside `fulfillment` at all?",
    "`kubectl get configmap prometheus-scrape-notes -n fulfillment -o yaml` - if every alert for this namespace depends on metrics that are now missing entirely (rather than metrics showing a real problem), what would that do to whether any of those alerts ever fire?",
  ],
  options: [
    {
      id: "default-deny-ingress-missing-monitoring-namespace-rule",
      label:
        "The new default-deny ingress policy's only rule allows traffic from a bare `podSelector: {}`, which - with no `namespaceSelector` - only ever matches pods within `fulfillment` itself; Prometheus's scraper pods live in the separate `monitoring` namespace and have no matching rule at all, so every scrape attempt against any pod in `fulfillment` now times out, Prometheus marks every target down, and since every alert for the namespace is built on top of those same missing metrics, none of them can evaluate and fire - producing total, silent monitoring loss rather than any actual alert.",
      explanation:
        "`prometheus-scrape-notes` explains the exact mechanism: the policy's one ingress rule only ever covers same-namespace traffic, and Prometheus's scrapers, running in `monitoring`, aren't included. Prometheus's own scrape errors showing connection timeouts (not auth/TLS failures) are consistent with the NetworkPolicy dropping the connection outright rather than the target actively rejecting it. The alerts-gone-silent (rather than alerts firing) detail is explained precisely by every rule depending on now-nonexistent metrics, which can't evaluate to a firing condition at all - a classic and dangerous monitoring blind spot.",
    },
    {
      id: "prometheus-itself-down",
      label: "The Prometheus server itself is down or misconfigured.",
      explanation:
        "Prometheus is actively scraping and correctly reporting the *results* of its scrape attempts (targets down, connection timeouts) - it's functioning correctly and doing its job; the problem is specifically that its connection attempts into the `fulfillment` namespace are being blocked, not that Prometheus itself has failed.",
    },
    {
      id: "shipment-worker-metrics-endpoint-broken",
      label: "shipment-worker's own /metrics endpoint has a bug and isn't responding correctly.",
      explanation:
        "A broken metrics endpoint would typically produce an HTTP-level error (a 404, 500, or malformed response) rather than a connection timeout - Prometheus's own scrape errors specifically show connection timeouts, consistent with the connection being blocked before ever reaching the application's metrics endpoint at all.",
    },
    {
      id: "coincidental-timing-unrelated-outage",
      label: "This is an unrelated monitoring infrastructure outage that happens to coincide with the NetworkPolicy rollout.",
      explanation:
        "The failure is isolated specifically to the `fulfillment` namespace and started at almost exactly the moment its new NetworkPolicy was applied two days ago - a coincidental, unrelated monitoring-wide outage wouldn't explain why only this one namespace's targets are affected while presumably every other namespace's monitoring continues working normally.",
    },
  ],
  correctOptionId: "default-deny-ingress-missing-monitoring-namespace-rule",
  resolution: `\`prometheus-scrape-notes\` explains the exact mechanism: the new
\`fulfillment-default-deny-ingress\` policy's only ingress rule uses a bare
\`podSelector: {}\` with no \`namespaceSelector\`, which only ever matches
pods within the policy's own namespace, \`fulfillment\`. Prometheus's own
scraper pods live in a completely separate \`monitoring\` namespace and
have no matching rule granting them ingress at all - every scrape attempt
against any pod in \`fulfillment\` now gets dropped by the NetworkPolicy,
which Prometheus surfaces as each target simply being "down" (matching
its own scrape errors showing connection timeouts, not any
authentication or application-level rejection). Because every alert rule
scoped to this namespace depends on metrics that no longer exist at all
rather than metrics reflecting a real, evaluable condition, none of them
can fire - producing total silent monitoring loss rather than a page,
which is exactly why this went unnoticed for two days.

The fix is adding an explicit ingress rule permitting Prometheus's
scrapers, scoped as tightly as reasonable (by namespace, and ideally also
by the scraper's own pod label):

\`\`\`yaml
spec:
  ingress:
    - from:
        - podSelector: {}   # existing same-namespace rule
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
          podSelector:
            matchLabels:
              app.kubernetes.io/name: prometheus
      ports:
        - port: 9090
          protocol: TCP
\`\`\`

Any namespace adopting a default-deny ingress policy needs an explicit
rule for its monitoring scraper as a first-class requirement, not an
afterthought - missing it doesn't just break dashboards, it breaks the
alerting built on top of them, silently converting a visible problem
into an invisible one at exactly the moment visibility matters most.`,
};
