import type { Scenario } from "../types";

export const ingressTimeoutTooShortForReport: Scenario = {
  id: "ingress-timeout-too-short-for-report",
  title: "The Report That Never Finished Loading",
  subtitle: "every report under 60 seconds is fine. the quarterly one always dies at exactly 60 seconds",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 12,
  tags: ["ingress", "timeout", "nginx"],
  briefing: `"analytics-export" generates large quarterly reports on demand. Most
reports finish in under a minute and download fine. The heaviest
quarterly report - the one that takes closest to ninety seconds to
generate - fails every single time, always at almost exactly the
sixty-second mark, with a 504 that analytics-export itself never logged
generating.`,
  constraints: [
    "analytics-export's own logs show the report generation running to completion server-side every time, well past the point the client sees a failure.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "analytics-export", namespace: "analytics", labels: { app: "analytics-export" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "60d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "analytics-export-1a2b3c-g7h8i", namespace: "analytics", labels: { app: "analytics-export" } },
        status: { phase: "Running", containerStatuses: [{ name: "analytics-export", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "analytics-export": [
            "2026-09-15T14:00:00.010Z INFO  c.e.analytics.ReportJob - starting quarterly-full report for account 9931",
            "2026-09-15T14:01:28.442Z INFO  c.e.analytics.ReportJob - quarterly-full report for account 9931 completed in 88412ms",
            "2026-09-15T14:01:28.450Z WARN  c.e.analytics.ReportJob - client disconnected before response could be written",
          ],
        },
        age: "60d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: "analytics-export",
          namespace: "analytics",
          annotations: { "kubernetes.io/ingress.class": "nginx" },
        },
        spec: {
          rules: [{ host: "analytics.example.com", http: { paths: [{ path: "/export", pathType: "Prefix", backend: { service: { name: "analytics-export", port: { number: 80 } } } }] } }],
        },
        age: "60d",
        events: [
          { type: "Warning", reason: "UpstreamTimeout", age: "5m", message: "upstream timed out (110: Connection timed out) while reading response header from upstream, client: 203.0.113.9, request: \"GET /export?report=quarterly-full HTTP/1.1\", upstream timeout: 60s" },
        ],
      },
    ],
  },
  hints: [
    "analytics-export's own logs show the report finishing successfully server-side - well after the client already saw a failure. What sits between the two?",
    "`kubectl get ingress analytics-export -n analytics -o yaml` and its events - is there a `proxy-read-timeout` annotation, or is it relying on the ingress controller's default?",
    "The nginx ingress controller's default upstream read timeout is 60 seconds - compare that against how long the slowest report actually takes to generate.",
  ],
  options: [
    {
      id: "ingress-proxy-read-timeout-default-60s",
      label:
        "The Ingress has no `proxy-read-timeout` annotation set, so the nginx ingress controller uses its 60-second default for how long it waits for a response from the backend - the quarterly report legitimately takes about 88 seconds to generate, so the ingress controller gives up and returns a 504 to the client well before analytics-export finishes, even though the backend keeps working and completes the report anyway.",
      explanation:
        "The Ingress's own event log shows an `UpstreamTimeout` at exactly the 60-second default, and analytics-export's logs confirm the report actually completed in 88412ms (about 88 seconds) - well past that. The application never fails or errors; the ingress controller simply stops waiting for a response before the legitimately slow report is done, producing a 504 the client sees while the backend is still (successfully) working.",
    },
    {
      id: "analytics-export-memory-limit",
      label: "analytics-export is hitting a memory limit while generating the largest report and getting OOMKilled.",
      explanation:
        "analytics-export's own logs show the report completing successfully in full every time, with no restart or crash - the pod isn't being killed, it's simply taking longer than the ingress controller is willing to wait for a response.",
    },
    {
      id: "database-query-timeout",
      label: "A database query timeout is cutting off the report generation partway through.",
      explanation:
        "The application logs explicitly show the report job completing successfully end-to-end (\"completed in 88412ms\") - nothing is being cut off mid-generation on the backend side at all.",
    },
    {
      id: "client-browser-timeout",
      label: "The client's own browser has a hardcoded request timeout that's too short.",
      explanation:
        "The Ingress's own event log shows the *ingress controller itself* timing out waiting on the upstream response, independent of any client-side behavior - the 504 is generated and returned by the ingress controller, not by the client giving up on its own.",
    },
  ],
  correctOptionId: "ingress-proxy-read-timeout-default-60s",
  resolution: `The Ingress relies on the nginx ingress controller's default
\`proxy-read-timeout\` of 60 seconds, with no override annotation set. Its
own \`UpstreamTimeout\` event confirms this exactly - a 60-second timeout
hit while waiting for a response header. analytics-export's application
logs tell the other half of the story: the quarterly report legitimately
takes about 88 seconds to generate, and completes successfully every
time - the backend never errors or fails. The ingress controller simply
stops waiting at 60 seconds and returns a 504 to the client, while the
backend, unaware anyone gave up, keeps working and finishes the report
into the void (\"client disconnected before response could be written\").

The fix is raising the timeout annotation for this route to comfortably
exceed the slowest legitimate report:

\`\`\`yaml
metadata:
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/proxy-read-timeout: "180"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "180"
\`\`\`

For any endpoint whose legitimate response time can approach or exceed an
ingress controller's default timeouts, that endpoint needs its own
explicit, sized-up timeout annotation - otherwise the controller will
keep giving up on slow-but-successful requests exactly like this one,
regardless of how well the backend itself is actually performing.`,
};
