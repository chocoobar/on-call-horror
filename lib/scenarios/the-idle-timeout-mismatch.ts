import type { Scenario } from "./types";

export const theIdleTimeoutMismatch: Scenario = {
  id: "the-idle-timeout-mismatch",
  title: "The Idle Timeout Mismatch",
  subtitle: "webhook-receiver drops roughly one in every few hundred inbound webhooks with no server-side error",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "tomcat", "networking"],
  briefing: `Partners integrating with "webhook-receiver" occasionally report a
webhook delivery that their system marks as failed with a connection
reset, even though webhook-receiver's own logs show no error, no
exception, and no dropped request around that time. It's intermittent -
maybe one in a few hundred deliveries - and always from partners whose
own HTTP client keeps connections open between calls.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "webhook-receiver", namespace: "integrations", labels: { app: "webhook-receiver" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                { name: "webhook-receiver", image: "registry.internal/webhook-receiver:1.7.2" },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "10d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "webhook-receiver", namespace: "integrations" },
        spec: {
          type: "LoadBalancer",
          ports: [{ port: 443, targetPort: 8080 }],
          annotations: { "service.beta.kubernetes.io/aws-load-balancer-idle-timeout": "120" },
        },
        age: "10d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "webhook-receiver-5d4e3f2g1-h0i9j", namespace: "integrations", labels: { app: "webhook-receiver" } },
        status: { phase: "Running", containerStatuses: [{ name: "webhook-receiver", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "webhook-receiver": [
            "2026-09-15T05:00:01.114Z INFO  c.e.integrations.WebhookController - processed webhook evt-88112 from partner-acme in 41ms",
            "2026-09-15T05:00:02.980Z INFO  c.e.integrations.WebhookController - processed webhook evt-88113 from partner-acme in 37ms",
          ],
        },
        age: "10d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "webhook-receiver-notes", namespace: "integrations" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "server:\n  tomcat:\n    connection-timeout: 60000  # ms - governs how long an idle keep-alive\n                              # connection is held open before Tomcat\n                              # closes it server-side\n",
            "notes.md":
              "The load balancer in front of this service has a 120-second idle\ntimeout on its side (see the Service annotation), meaning it will keep a\nclient's connection registered as reusable for up to 120 seconds of\ninactivity. Tomcat's own `connection-timeout` governs how long *it*\nkeeps an idle keep-alive connection open before closing it from its own\nside. A partner's HTTP client that reuses a connection somewhere between\n60 and 120 seconds after its last request can end up sending a new\nrequest down a socket Tomcat already silently closed.",
          },
        },
        age: "10d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap webhook-receiver-notes -n integrations -o yaml` - compare Tomcat's `connection-timeout` against the load balancer's idle timeout annotation on the Service.",
    "There's no server-side error logged for these drops because nothing ever reaches the application - the connection is closed at the TCP layer before Tomcat even routes the request to a controller.",
    "A keep-alive connection reused right in the gap between Tomcat's own idle timeout and the load balancer's (longer) idle timeout is a connection the load balancer still considers valid, but Tomcat has already silently closed.",
  ],
  options: [
    {
      id: "tomcat-timeout-shorter-than-lb-idle-timeout",
      label:
        "Tomcat's `connection-timeout` (60s) is shorter than the load balancer's idle timeout (120s), so a partner's HTTP client reusing a keep-alive connection anywhere between 60 and 120 seconds of inactivity sends its request down a socket the load balancer still considers open but Tomcat has already silently closed on its own side - producing a connection reset the application never even sees, let alone logs.",
      explanation:
        "`webhook-receiver-notes` shows the exact numbers: Tomcat's `connection-timeout: 60000` (60s) versus the load balancer's `idle-timeout: 120` (120s) annotation on the Service. Whenever a partner's client reuses a connection in that 60-120 second window, the load balancer still believes the connection is good and forwards the client's bytes - but Tomcat closed its side of that socket 60+ seconds ago, so the client gets a reset instead of a response. Because the connection dies before any HTTP request is routed to a controller, there's nothing for the application to log - matching the reports of failures with zero corresponding server-side errors.",
    },
    {
      id: "webhookcontroller-intermittent-bug",
      label: "WebhookController itself has an intermittent bug that silently drops some requests.",
      explanation:
        "Every logged webhook shows a clean, fast completion with no gaps or unexplained absences in the sequence - and the failures partners report never produce any corresponding server-side log line at all, which points at requests never reaching the controller rather than the controller mishandling ones it did receive.",
    },
    {
      id: "load-balancer-misconfigured-health-checks",
      label: "The load balancer's health checks are intermittently marking a healthy pod as unhealthy.",
      explanation:
        "A health-check flap would show up as a pod briefly receiving no traffic at all (and likely an event or log gap around that time), not as an occasional single connection reset on an otherwise steadily-processing pod with no corresponding gaps in its request log.",
    },
    {
      id: "partner-client-implementation-bug",
      label: "The affected partners' own HTTP client implementations are simply buggy.",
      explanation:
        "The behavior described - reusing a keep-alive connection between requests - is completely standard, correct HTTP client behavior; the actual mismatch is between the two timeout values on the server side of the connection, which is squarely within this service's own configuration to fix.",
    },
  ],
  correctOptionId: "tomcat-timeout-shorter-than-lb-idle-timeout",
  resolution: `Nothing appears in the application logs around these failures because
nothing ever reaches the application - the connection dies before Tomcat
routes any request to a controller. \`webhook-receiver-notes\` lays out
the mismatch: Tomcat's own \`server.tomcat.connection-timeout\` is set to
60 seconds, while the load balancer in front of it (per the Service's
\`aws-load-balancer-idle-timeout\` annotation) allows a connection to sit
idle for up to 120 seconds before it considers it stale.

Both timeouts are individually reasonable - the problem is that they
disagree. A partner's HTTP client that reuses a keep-alive connection
somewhere between 60 and 120 seconds after its last request is following
completely normal HTTP semantics from the load balancer's point of view
(still well within its 120s window) - but Tomcat closed its half of that
same TCP connection 60+ seconds earlier. The client's next request lands
on a socket that's alive on one end and already dead on the other,
producing a connection reset with nothing for the application to log,
since the request never got far enough to be routed anywhere.

The fix is making the server-side timeout comfortably longer than
whatever sits in front of it, not shorter:

\`\`\`yaml
server:
  tomcat:
    connection-timeout: 150000  # ms - safely longer than the LB's 120s idle timeout
    keep-alive-timeout: 150000
\`\`\`

The rule of thumb: the timeout closest to the client (here, Tomcat) should
always be equal to or longer than the timeout of anything sitting in
front of it - otherwise the upstream hop will keep reusing connections
the downstream hop has already quietly closed.`,
};
