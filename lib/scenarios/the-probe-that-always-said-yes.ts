import type { Scenario } from "./types";

export const theProbeThatAlwaysSaidYes: Scenario = {
  id: "the-probe-that-always-said-yes",
  title: "The Probe That Always Said Yes",
  subtitle: "the uptime dashboard for partner-api has read 100% for six months, through two real outages",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["blackbox-exporter", "synthetic-monitoring", "http"],
  briefing: `A post-incident review for a partner-facing outage on "partner-api" turns
up an uncomfortable fact: the Blackbox exporter-based uptime probe for it
has reported 100% availability every single day for the past six months -
including today, during an outage confirmed by multiple partners
independently, and including a previous outage three months ago that
everyone remembers clearly.`,
  constraints: [
    "During today's outage, partner-api was confirmed returning HTTP 500 responses to every real partner request for roughly twenty minutes.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "partner-api", namespace: "partners", labels: { app: "partner-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "blackbox-exporter-module-config", namespace: "monitoring" },
        spec: {
          data: {
            "blackbox.yml":
              "modules:\n  partner_api_check:\n    prober: tcp\n    timeout: 5s\n    tcp:\n      preferred_ip_protocol: ip4\n      # NOTE: uses the generic `tcp` prober, configured when this check was\n      # first set up years ago to simply verify the service was listening\n      # on its port at all - never migrated to the `http` prober, which\n      # would additionally validate the actual HTTP response status code.\n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "blackbox-probe-behavior-notes", namespace: "monitoring" },
        spec: {
          data: {
            "notes.md":
              "The `tcp` prober module only verifies that a TCP connection can be\nestablished to the target port - it succeeds as soon as the three-way\nhandshake completes, regardless of what the application does\nafterward. partner-api's load balancer and its listening socket both\nstayed up and accepting connections throughout today's outage; the\nfailure was entirely at the application layer, where every request\nreceived a valid HTTP response with a 500 status code. A `tcp` probe has\nno visibility into HTTP status codes at all - from its perspective, a\nserver that accepts a connection and then returns 500 to everything\nlooks identical to one returning 200 to everything.\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap blackbox-exporter-module-config -n monitoring -o yaml` - which Blackbox exporter prober module is this check actually using?",
    "`kubectl get configmap blackbox-probe-behavior-notes -n monitoring -o yaml` - what does the `tcp` prober actually verify, and does it look at the HTTP response at all?",
    "A TCP connection succeeding just means something is listening and accepting connections on the port - it says nothing about whether the application behind it is returning successful responses or failing every request with a 500.",
  ],
  options: [
    {
      id: "tcp-prober-never-checks-http-status",
      label:
        "The Blackbox exporter check for partner-api uses the `tcp` prober module, configured years ago to simply verify something is listening on the port - it never inspects the actual HTTP response, so as long as the TCP connection succeeds (which it did throughout today's outage, since the load balancer and listening socket stayed up while only the application layer was failing and returning 500s), the probe reports success regardless of what status code partner-api actually returns, explaining the impossible-looking 100% uptime through two real, confirmed outages.",
      explanation:
        "`blackbox-exporter-module-config` confirms the check uses `prober: tcp`, never migrated to an HTTP-aware prober. `blackbox-probe-behavior-notes` explains the `tcp` prober only verifies a successful TCP handshake, with no visibility into the application-layer HTTP response - and confirms today's outage was purely application-layer (valid HTTP 500 responses, TCP connections still succeeding), exactly the condition under which a `tcp` probe cannot distinguish success from failure, consistent with the probe having missed this outage, the one three months ago, and presumably any other purely-application-layer failure over the past six months.",
    },
    {
      id: "blackbox-exporter-itself-down",
      label: "The Blackbox exporter instance running this check has been down or unreachable for six months.",
      explanation:
        "If the exporter itself were down, Prometheus would show the scrape target for the exporter as failing (missing data or `up=0`), rather than a clean, consistently reported `100%` uptime metric - the check is actively running and reporting a real (if misleading) result, not failing to run at all.",
    },
    {
      id: "partner-api-load-balancer-masking-failures",
      label: "partner-api's load balancer is silently retrying failed requests before returning a response, masking failures from any external check.",
      explanation:
        "Today's outage is confirmed to return actual HTTP 500 responses to every real partner request - there's no indication of silent retries masking failures from the load balancer's own client-facing behavior; the gap is specifically in what the monitoring probe itself checks, not in how the load balancer handles real traffic.",
    },
    {
      id: "alert-threshold-too-lenient",
      label: "The uptime alert's threshold is set too leniently, allowing brief outages to go unnoticed.",
      explanation:
        "This isn't a thresholding issue - the underlying uptime metric itself reads a flat 100% with no dip recorded at all during either outage, which means there was never a below-threshold value for any alert threshold to catch in the first place.",
    },
  ],
  correctOptionId: "tcp-prober-never-checks-http-status",
  resolution: `\`blackbox-exporter-module-config\` shows partner-api's uptime check uses the
\`tcp\` prober module, set up years ago and never migrated to an
HTTP-aware one. \`blackbox-probe-behavior-notes\` explains exactly what that
means: the \`tcp\` prober's entire job is verifying a TCP connection can be
established - it succeeds the moment the handshake completes and has no
mechanism at all for inspecting whatever HTTP response comes back
afterward. Today's outage, like the one three months ago, was confirmed
to be purely application-layer: partner-api's load balancer and listening
socket stayed up and accepting connections the whole time, while the
application itself returned a valid HTTP 500 to every real request for
about twenty minutes. From a \`tcp\` probe's perspective, that's
completely indistinguishable from a healthy server returning 200s to
everything - both establish a TCP connection successfully. The probe has
been telling the truth about exactly one narrow thing, "can I connect to
this port," for six straight months, while everyone reading the dashboard
assumed it was answering a much broader question it was never built to
answer.

The fix is switching to the \`http\` prober module, which validates the
actual response status code (and can optionally check response body
content):

\`\`\`yaml
modules:
  partner_api_check:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: [200]
      preferred_ip_protocol: ip4
\`\`\`

Any synthetic uptime check worth trusting for an HTTP service needs to
validate at the HTTP layer, not just the TCP layer beneath it - a
listening socket and a working application are two different, separately
verifiable things, and a check built only for the first will happily
report "up" through any outage confined to the second.`,
};
