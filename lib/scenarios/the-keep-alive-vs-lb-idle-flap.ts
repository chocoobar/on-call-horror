import type { Scenario } from "./types";

export const theKeepAliveVsLbIdleFlap: Scenario = {
  id: "the-keep-alive-vs-lb-idle-flap",
  title: "The Keep-Alive vs LB Idle Flap",
  subtitle: "notification-preferences-api serves the occasional empty response with a 200 status, driving mobile clients up the wall",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "tomcat", "networking"],
  briefing: `Mobile client crash reports show occasional responses from
"notification-preferences-api" that come back with a 200 status but a
completely empty body, which the client can't parse and treats as
corrupt. It's rare - maybe one in ten thousand requests - and only
happens on connections that have been idle for a little while before the
next request.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notification-preferences-api", namespace: "notifications", labels: { app: "notification-preferences-api" } },
        spec: { replicas: 3, template: { spec: { containers: [{ name: "notification-preferences-api", image: "registry.internal/notification-preferences-api:1.8.0" }] } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "18d",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "notification-preferences-api", namespace: "notifications", annotations: { "service.beta.kubernetes.io/aws-load-balancer-idle-timeout": "60" } },
        spec: { type: "LoadBalancer", ports: [{ port: 443, targetPort: 8080 }] },
        age: "18d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notification-preferences-api-5a6b7c8d9-e0f1g", namespace: "notifications", labels: { app: "notification-preferences-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "notification-preferences-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "notification-preferences-api": [
            "2026-09-15T12:00:00.114Z INFO  c.e.notifications.PreferencesController - served GET /preferences/user-88213 in 12ms",
            "2026-09-15T12:02:05.220Z WARN  o.apache.coyote.AbstractProtocol - a connection was closed server-side while a request was pending",
          ],
        },
        age: "18d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "notification-preferences-api-notes", namespace: "notifications" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "server:\n  tomcat:\n    keep-alive-timeout: 90000  # 90s - LONGER than the load balancer's\n                                # own 60s idle timeout, intentionally\n                                # set generously after a past incident\n",
            "notes.md":
              "This service already learned the 'Tomcat timeout shorter than LB\nidle timeout' lesson from a past incident and deliberately set Tomcat's\n`keep-alive-timeout` (90s) longer than the load balancer's 60s idle\ntimeout. But that only protects the case where Tomcat closes first -\nthe load balancer's own 60s idle timeout means *it* will close its side\nof an idle connection at 60s regardless of what Tomcat's timeout is set\nto, and if a client's request happens to race that closure - arriving\njust as (or just after) the LB has decided to tear down the connection\nbut before the client's OS has been notified - the request can be sent\ndown an already-half-closed connection.",
          },
        },
        age: "18d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap notification-preferences-api-notes -n notifications -o yaml` - Tomcat's `keep-alive-timeout` (90s) is deliberately *longer* than the load balancer's own idle timeout (60s), unlike the classic mismatch. Does that fully solve the problem, or just half of it?",
    "The load balancer has its own 60-second idle timeout, completely independent of what Tomcat is configured to do - what happens when *the load balancer itself* decides to close an idle connection?",
    "A request racing a connection teardown that's happening from the *upstream* side (the LB), rather than the downstream side (Tomcat), can land on a connection that's already been torn down on one end - producing a malformed or empty response rather than a clean connection-refused.",
  ],
  options: [
    {
      id: "lb-idle-timeout-fires-independently-regardless-of-tomcat-setting",
      label:
        "Tomcat's `keep-alive-timeout` being longer than the load balancer's 60-second idle timeout only prevents Tomcat from closing a connection prematurely - it has no effect on the load balancer's own independent decision to close its side of an idle connection at exactly 60 seconds; when a client's next request on a reused connection races that LB-side closure, it can be forwarded down a connection the LB has already started tearing down, producing a corrupt or empty response instead of a clean retry-able connection error.",
      explanation:
        "`notification-preferences-api-notes` explains that this service already fixed the *other* direction of timeout mismatch (Tomcat closing before the LB) by intentionally setting `keep-alive-timeout` longer than the LB's own timeout - but that only ever protected against Tomcat closing first. The load balancer's own 60-second idle timeout still fires independently on its own schedule; the warning log (`a connection was closed server-side while a request was pending`) shows a request landing on a connection right as it's being torn down, consistent with a request racing the load balancer's own idle closure rather than Tomcat's.",
    },
    {
      id: "tomcat-keep-alive-still-too-short",
      label: "Tomcat's `keep-alive-timeout` of 90 seconds is still too short and needs to be even longer.",
      explanation:
        "90 seconds is already comfortably longer than the load balancer's 60-second idle timeout - lengthening it further wouldn't address the actual mechanism here, since the load balancer will still independently close idle connections at 60 seconds regardless of how long Tomcat is willing to wait on its own side.",
    },
    {
      id: "preferencescontroller-returning-empty-body-bug",
      label: "PreferencesController itself has a rare bug that returns an empty response body under some condition.",
      explanation:
        "The warning log points at a connection being closed server-side while a request was pending - a transport-level event happening before any response body would even be constructed - rather than at application code successfully handling a request and choosing to return nothing.",
    },
    {
      id: "mobile-client-connection-reuse-bug",
      label: "The mobile clients' own HTTP libraries have a bug in how they reuse idle connections.",
      explanation:
        "Reusing an idle keep-alive connection for a subsequent request is completely standard, correct client behavior - the actual defect is a timing gap on the server side between the load balancer's own independent idle timeout and the connection genuinely being safe to reuse, not anything wrong with how the client behaves.",
    },
  ],
  correctOptionId: "lb-idle-timeout-fires-independently-regardless-of-tomcat-setting",
  resolution: `\`notification-preferences-api-notes\` reveals that this service already
addressed the well-known version of this problem - Tomcat's own
\`keep-alive-timeout\` is deliberately set to 90 seconds, comfortably longer
than the load balancer's 60-second idle timeout, specifically to avoid
Tomcat closing a connection the load balancer still considers alive. That
fix is correct as far as it goes. But it only protects against Tomcat
closing first - it does nothing about the load balancer's own,
completely independent decision to close *its* side of an idle
connection at exactly 60 seconds, on its own schedule, regardless of what
Tomcat is configured to tolerate.

The warning log - \`a connection was closed server-side while a request
was pending\` - is consistent with exactly that: a client's request,
sent down a connection reused right around the 60-second idle mark,
racing the load balancer's own teardown of that same connection. Unlike
the classic mismatch (where the downstream side closes first and the
client cleanly sees a connection error), a request racing the *upstream*
side's closure can be partially forwarded before the LB fully tears the
connection down - producing a malformed, incomplete, or empty response
rather than a clean, retry-able failure.

The fix is closing the loop on both sides: keep Tomcat's timeout longer
than the LB's (already done), but also make sure clients themselves treat
connection reuse conservatively, and consider whether the LB's idle
timeout itself should simply be raised to match Tomcat's, removing the
race entirely:

\`\`\`yaml
# Service annotation - raise the LB's own idle timeout to match Tomcat's,
# rather than just keeping Tomcat's longer than the LB's
service.beta.kubernetes.io/aws-load-balancer-idle-timeout: "90"
\`\`\`

The safest fix for this class of problem is making every hop's idle
timeout equal, rather than just ensuring the downstream one is longer -
"longer than the load balancer" avoids one direction of the race, but
only a matching value on both sides removes the race condition itself.`,
};
