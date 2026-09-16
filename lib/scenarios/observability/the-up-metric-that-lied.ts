import type { Scenario } from "../types";

export const theUpMetricThatLied: Scenario = {
  id: "the-up-metric-that-lied",
  title: "The Up Metric That Lied",
  subtitle: "Grafana says notification-dispatcher has been up the whole time it was completely down",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["prometheus", "scrape-config", "up-metric"],
  briefing: `Customers report they stopped receiving any push notifications for about
forty minutes this morning. "notification-dispatcher"'s own dashboard,
built around the standard \`up{job="notification-dispatcher"}\` metric,
shows a flawless, unbroken line at 1 (up) for the entire period - not a
single blip.`,
  constraints: [
    "notification-dispatcher's pod was confirmed, after the fact via `kubectl get events`, to have been in `CrashLoopBackOff` for exactly that forty-minute window.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "notification-dispatcher", namespace: "notifications", labels: { app: "notification-dispatcher" } },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "notification-dispatcher-9m0n1o2p3-q4r5s", namespace: "notifications", labels: { app: "notification-dispatcher" } },
        events: [
          { type: "Warning", reason: "BackOff", age: "3h", message: "Back-off restarting failed container notification-dispatcher in pod notification-dispatcher-9m0n1o2p3-q4r5s_notifications (was CrashLoopBackOff 08:10-08:50)" },
        ],
        status: { phase: "Running", containerStatuses: [{ name: "notification-dispatcher", ready: true, restartCount: 14, state: { running: {} } }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "prometheus-scrape-config-snippet", namespace: "monitoring" },
        spec: {
          data: {
            "scrape-config.yaml":
              "- job_name: notification-dispatcher\n  static_configs:\n    - targets: ['notification-dispatcher.notifications.svc:9090']\n  # NOTE: static_configs with a fixed Service DNS name, rather than\n  # kubernetes_sd_configs targeting individual pods. Scraping a Service\n  # (rather than a pod directly) means kube-proxy load-balances each\n  # scrape request across whatever endpoints are currently healthy and\n  # registered - if a Service still has at least one working endpoint\n  # (or briefly, a stale one, depending on readiness probe timing), a\n  # scrape can still succeed even while the specific replica an engineer\n  # cares about is crash-looping.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "notification-dispatcher-topology-notes", namespace: "notifications" },
        spec: {
          data: {
            "notes.md":
              "notification-dispatcher normally runs as a single replica. During the\ncrash loop this morning, the single pod's readiness probe (which gates\nSocietyendpoint membership) was misconfigured to check only a basic TCP\nconnect on the metrics port - which the process's Prometheus client\nlibrary kept accepting connections on even while the main application\nthread was deadlocked and unable to actually do its real notification-\nsending work. The Service kept the pod registered as a ready endpoint\nthe entire time, so scrapes of the metrics port kept succeeding.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get events` for the pod - it really was in CrashLoopBackOff for that window. So what was Prometheus actually able to successfully connect to during that time?",
    "`kubectl get configmap prometheus-scrape-config-snippet -n monitoring -o yaml` - is Prometheus scraping the pod directly, or scraping through the Service?",
    "`kubectl get configmap notification-dispatcher-topology-notes -n notifications -o yaml` - what does the readiness probe actually check, and does a successful `up{}` scrape necessarily mean the application's real work is happening?",
  ],
  options: [
    {
      id: "shallow-readiness-probe-kept-endpoint-registered",
      label:
        "The readiness probe only checks a basic TCP connect on the metrics port, which the Prometheus client library kept accepting even while the application's main thread was deadlocked and genuinely unable to process notifications - so the Service kept the crash-looping pod registered as a healthy endpoint, and Prometheus's Service-based scrape kept succeeding the whole time, making `up{}` report exactly what a shallow, misleading readiness check said: technically reachable, not actually working.",
      explanation:
        "`notification-dispatcher-topology-notes` confirms the readiness probe only checks a bare TCP connect, which the metrics endpoint kept accepting even during the deadlock, and `prometheus-scrape-config-snippet` confirms Prometheus scrapes through the Service rather than the pod directly - so as long as the endpoint stayed registered, scrapes kept succeeding and `up{}` stayed 1. `kubectl get events` independently confirms the pod really was crash-looping for that exact window - `up{}` measured 'can Prometheus reach something that responds on the metrics port,' not 'is the application actually doing its job,' and those turned out to be two different questions here.",
    },
    {
      id: "prometheus-cached-stale-up-value",
      label: "Prometheus cached a stale `up=1` value from before the crash loop started and never refreshed it.",
      explanation:
        "Prometheus re-evaluates `up{}` fresh on every scrape interval based on whether that specific scrape attempt succeeded - it doesn't carry forward a cached value from a previous scrape. The unbroken `up=1` line reflects scrapes that were genuinely succeeding throughout, not a stale, unrefreshed reading.",
    },
    {
      id: "wrong-job-label-on-dashboard",
      label: "The dashboard is querying `up{}` with the wrong `job` label, showing a different job's healthy status instead.",
      explanation:
        "The scrape config confirms `job_name: notification-dispatcher` matches exactly what the dashboard queries - there's no label mismatch here; the scrapes being reflected are genuinely for this job, they're just succeeding against an endpoint that wasn't actually doing useful work.",
    },
    {
      id: "events-report-is-inaccurate",
      label: "The CrashLoopBackOff events are misleading and the pod wasn't actually failing during that window.",
      explanation:
        "The CrashLoopBackOff window is independently confirmed after the fact via `kubectl get events`, and it lines up exactly with the customer-reported forty-minute notification outage - there's no reason to doubt it happened; the surprising part is that `up{}` didn't reflect it, not whether it happened.",
    },
  ],
  correctOptionId: "shallow-readiness-probe-kept-endpoint-registered",
  resolution: `\`kubectl get events\` confirms notification-dispatcher's pod genuinely was in
\`CrashLoopBackOff\` for the exact forty-minute window customers reported
missing notifications. \`notification-dispatcher-topology-notes\` explains
why \`up{}\` never noticed: the pod's readiness probe only checked a basic
TCP connect on the metrics port, and the Prometheus client library inside
the process kept accepting connections on that port even while the
application's main thread was deadlocked and genuinely unable to do its
real work of sending notifications. Because the readiness probe kept
passing, Kubernetes kept the pod registered as a healthy Service
endpoint. \`prometheus-scrape-config-snippet\` confirms Prometheus scrapes
this job through the Service's DNS name rather than the pod directly - so
as long as *some* registered endpoint answered on the metrics port, the
scrape succeeded, and \`up{job="notification-dispatcher"}\` stayed exactly
1 the entire time.

\`up{}\` only measures "did the last scrape attempt succeed" - it says
nothing about whether the process behind that successful connection is
actually doing its job. A shallow readiness probe and a healthy-looking
metrics endpoint can both be true while the application itself is
completely deadlocked.

Two independent fixes matter here: tightening the readiness probe so it
reflects real application health, not just a TCP handshake, and adding a
business-level metric (successful notifications sent per minute) as a
second, harder-to-fool signal:

\`\`\`yaml
readinessProbe:
  httpGet:
    path: /healthz/deep   # actually exercises the dispatch queue
    port: 8080
  periodSeconds: 5
\`\`\`

\`\`\`promql
rate(notifications_sent_total[5m]) == 0
\`\`\`

\`up{}\` is a useful baseline signal, but for anything where "technically
reachable" and "actually working" can diverge, it needs a deeper probe
and a business-level metric standing behind it.`,
};
