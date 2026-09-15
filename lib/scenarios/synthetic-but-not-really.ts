import type { Scenario } from "./types";

export const syntheticButNotReally: Scenario = {
  id: "synthetic-but-not-really",
  title: "Synthetic, but Not Really",
  subtitle: "the uptime check was green the entire time real users couldn't check out",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["synthetic-monitoring", "blackbox-exporter", "load-balancer"],
  briefing: `checkout-web was fully broken for 45 minutes this morning - real customers
got errors on every checkout attempt. The synthetic uptime check that's
supposed to catch exactly this kind of thing stayed green the entire
time, and nobody got paged.`,
  constraints: [
    "The synthetic check genuinely was passing the whole time - it isn't a reporting bug or a dashboard lag, it was making real requests and getting real 200 responses.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "checkout-web", namespace: "checkout", labels: { app: "checkout-web" } },
        spec: { type: "LoadBalancer", selector: { app: "checkout-web" }, ports: [{ port: 443 }] },
        age: "2y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "checkout-web", namespace: "checkout", labels: { app: "checkout-web" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "synthetic-check-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "The synthetic uptime check (Blackbox exporter) probes\n`https://checkout-web.example.com/healthz`. `/healthz` is served by the\nload balancer's own lightweight health endpoint - a static, hardcoded\n200 response used by the load balancer itself to decide whether to keep\na backend in rotation - not a request that's actually routed through to\nany checkout-web pod or its application code. This morning's outage was\na bug specifically in checkout-web's payment-submission code path,\nunrelated to whether pods were up and responding to the load balancer's\nown internal health checks at all.\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap synthetic-check-notes -n monitoring -o yaml` - what does the synthetic check actually request, and what serves that specific path?",
    "A `/healthz` path is often intentionally served by infrastructure (a load balancer, an ingress controller) as a cheap, static liveness signal - not necessarily by the application itself, and not necessarily exercising any real application logic at all.",
    "The outage was in the checkout flow's actual payment code - does a request to a static health endpoint exercise that code path at all, regardless of whether the endpoint itself responds correctly?",
  ],
  options: [
    {
      id: "synthetic-check-hits-lb-healthz-not-app",
      label:
        "The synthetic check only requests `/healthz`, which is served directly by the load balancer's own static, hardcoded health response - it never actually reaches checkout-web's application code or its real payment-submission logic at all, so a genuine bug in that specific code path can (and did) break real checkout for every customer while the synthetic check kept passing, because it was never really testing the thing that broke.",
      explanation:
        "`synthetic-check-notes` confirms `/healthz` is answered by the load balancer itself as a lightweight, static signal for its own routing decisions, not proxied through to any checkout-web pod or its code. The outage was specifically in the payment-submission path - functionality the synthetic check never exercises regardless of how it's phrased. A monitor that always returns success because it's testing infrastructure liveness rather than the actual user-facing behavior it's meant to represent will stay green through exactly this kind of outage, by design, however unintentional that design turned out to be.",
    },
    {
      id: "blackbox-exporter-misconfigured-timeout",
      label: "The Blackbox exporter's probe timeout is too generous, letting a slow but broken endpoint pass.",
      explanation:
        "The check wasn't slow and then passing on a technicality - it was fast, healthy, and completely accurate about the one specific endpoint it was actually testing. A timeout adjustment wouldn't change what the check is even measuring, which is the real gap here.",
    },
    {
      id: "load-balancer-health-check-misrouted",
      label: "The load balancer's own backend health checks were misrouted during the outage.",
      explanation:
        "There's no indication the load balancer's routing was broken - checkout-web's pods were up and marked healthy the entire time by every infrastructure-level signal; the actual failure was specifically in application-level checkout logic, which infrastructure-level health checks were never designed to exercise.",
    },
    {
      id: "monitoring-alert-routing-broken",
      label: "Alertmanager's routing configuration failed to page anyone despite a real check failure.",
      explanation:
        "There was no check failure to route an alert for in the first place - the synthetic check genuinely, accurately reported success for the one thing it was actually testing, the entire time. The gap is in what's being monitored, not in what happens after a failure is detected.",
    },
  ],
  correctOptionId: "synthetic-check-hits-lb-healthz-not-app",
  resolution: `\`synthetic-check-notes\` explains the whole gap: \`/healthz\` is answered
directly by the load balancer as a cheap, static "is a backend alive"
signal for its own internal routing - it never proxies through to a
checkout-web pod, let alone exercises any of the application's real code.
This morning's outage was a bug specifically in the payment-submission
path, which a request to a static infrastructure health endpoint has no
way to ever touch, no matter how badly that path is broken. The synthetic
check wasn't lying or malfunctioning - it was accurately, faithfully
reporting on a thing (the load balancer's own liveness signal) that had
nothing to do with the thing that actually broke.

This is one of the most common synthetic-monitoring traps: a check named
and framed as "is checkout working" that's actually only testing "is
something, somewhere, technically listening" gives real, false
confidence precisely when it matters most.

The fix is making the synthetic check exercise the actual user journey it
claims to represent - a real (test-mode) checkout flow, not a static
health path:

\`\`\`yaml
# blackbox_exporter module, probing a real (sandboxed) checkout flow
modules:
  checkout_smoke_test:
    prober: http
    http:
      method: POST
      body: '{"test_mode": true, "cart_id": "synthetic-check-cart"}'
      valid_status_codes: [200]
      fail_if_body_not_matches_regexp: ["\\"status\\":\\"confirmed\\""]
\`\`\`

pointed at the real checkout submission endpoint (using a designated
test/sandbox mode so it doesn't create real orders or charges). A
synthetic check is only as good as how closely it exercises the actual
behavior users depend on - a green check on infrastructure liveness is a
different, much weaker claim than a green check on "customers can
actually check out," and treating the two as interchangeable is exactly
how a real outage hides behind a passing monitor.`,
};
