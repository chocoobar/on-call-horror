import type { Scenario } from "../types";

export const logSamplingBlindness: Scenario = {
  id: "log-sampling-blindness",
  title: "Log Sampling Blindness",
  subtitle: "recommendations-api has been erroring for two days, and Kibana has almost none of it",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["elk", "log-sampling", "cost-optimization"],
  briefing: `A cost-cutting initiative added log sampling last month to cut logging
volume and storage cost, dropping a percentage of high-volume DEBUG/INFO
logs before they reach Elasticsearch. This week, "recommendations-api"
has had a real, ongoing error problem that customer support keeps
reporting - but almost none of it shows up when searching Kibana for its
error logs.`,
  constraints: [
    "`kubectl logs` on recommendations-api's pods directly confirms a steady, real stream of ERROR-level log lines the entire time - the application is genuinely logging these errors.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendations-api", namespace: "recs", labels: { app: "recommendations-api" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "recommendations-api-2u3v4w5x6-y7z8a", namespace: "recs", labels: { app: "recommendations-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "recommendations-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "recommendations-api": [
            '{"level":"ERROR","service":"recommendations-api","msg":"failed to fetch user embedding for user 88213","ts":"2026-09-15T09:00:01Z"}',
            '{"level":"ERROR","service":"recommendations-api","msg":"failed to fetch user embedding for user 88214","ts":"2026-09-15T09:00:02Z"}',
            '{"level":"INFO","service":"recommendations-api","msg":"served fallback recommendations for user 88213","ts":"2026-09-15T09:00:01Z"}',
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "log-sampling-config", namespace: "logging" },
        spec: {
          data: {
            "fluent-bit-sampling.conf":
              "[FILTER]\n    Name    throttle\n    Match   kube.recs.*\n    Rate    10\n    Interval 1s\n    # Applies per-source (by Match pattern), not per log level - every\n    # log line from a matched source competes for the same rate-limited\n    # slot, DEBUG/INFO and ERROR alike.\n",
            "notes.md":
              "This throttle filter was added last month to control log volume from\nhigh-traffic services, matched by namespace/service pattern\n(`kube.recs.*`), not by log level. `recommendations-api` is a very\nhigh-volume INFO logger (one 'served fallback recommendations' line per\nrequest) - its rare ERROR lines are competing for the same fixed-rate\nslots as its much more numerous INFO lines, and mostly losing.\n",
          },
        },
        age: "1mo",
      },
    ],
  },
  hints: [
    "`kubectl get configmap log-sampling-config -n logging -o yaml` - what does the throttle filter actually match on: log level, or something else entirely?",
    "recommendations-api logs a routine INFO line for every request, and only occasionally an ERROR line. If both compete for the same fixed number of \"slots per second,\" which one is more likely to fill up all the slots?",
    "`kubectl logs recommendations-api-... -n recs` confirms the ERROR lines are genuinely being written by the application at a steady, real rate - the gap is entirely about what happens to them on the way to Elasticsearch.",
  ],
  options: [
    {
      id: "sampling-throttle-by-source-not-severity",
      label:
        "The log sampling filter throttles by source pattern (`kube.recs.*`) with a fixed rate, not by log level - recommendations-api's high-volume routine INFO logging (one line per request) competes for the same limited per-second slots as its comparatively rare ERROR logging, and since INFO lines vastly outnumber ERROR lines, most of the real errors get dropped by the same rate limit that's mostly there to control INFO-level volume.",
      explanation:
        "`log-sampling-config` confirms the throttle filter matches by source pattern only, explicitly noting that DEBUG/INFO and ERROR lines from a matched source compete for the same rate-limited slots with no severity awareness at all. `kubectl logs` independently confirms the application really is emitting a steady stream of ERROR lines - they're being generated correctly and dropped downstream, in the log-shipping pipeline, precisely because there's no rule protecting them from being outcompeted by the much higher volume of routine INFO logs from the same service.",
    },
    {
      id: "elasticsearch-index-lifecycle-deleting-early",
      label: "An Elasticsearch index lifecycle policy is deleting these documents shortly after they're indexed.",
      explanation:
        "This isn't about documents being deleted after being indexed - the throttle filter is dropping the vast majority of these log lines before they're ever shipped to Elasticsearch at all, so there's nothing later in the pipeline for an index lifecycle policy to prematurely remove.",
    },
    {
      id: "application-error-rate-genuinely-low",
      label: "recommendations-api's real error rate is actually low - Kibana is accurately reflecting a rare problem.",
      explanation:
        "`kubectl logs` directly confirms a steady, ongoing stream of ERROR-level lines from the application itself - the error rate is real and sustained, not rare; what's inaccurate is how much of that real error volume is actually making it into what Kibana can search.",
    },
    {
      id: "kibana-search-query-wrong-field",
      label: "The Kibana search is querying the wrong field for log level.",
      explanation:
        "The logs are structured JSON with a consistent, correctly-named `level` field - a field-name mismatch would produce a total lack of any matching documents at all, not the described pattern of *almost none* getting through while the app is confirmed to be producing them steadily.",
    },
  ],
  correctOptionId: "sampling-throttle-by-source-not-severity",
  resolution: `\`log-sampling-config\`'s own comment states the mechanism plainly: the
throttle filter matches by source pattern (\`kube.recs.*\`) with a fixed
rate of samples per second, applied without any awareness of log level -
DEBUG, INFO, and ERROR lines from a matched source all compete for the
same limited number of slots. \`recommendations-api\` logs a routine INFO
line for essentially every request it serves, which vastly outnumbers its
comparatively rare ERROR lines. When both compete for the same fixed
budget of "N lines per second get through," the overwhelming volume of
routine INFO traffic fills nearly all of it, leaving the rare-but-real
ERROR lines to lose that competition most of the time - dropped by the
pipeline before ever reaching Elasticsearch, even though \`kubectl logs\`
confirms the application is generating them at a steady, genuine rate the
entire time.

The fix is making the sampling rule severity-aware, so error-level logs
are never subject to the same volume-based throttle as routine
informational logging:

\`\`\`ini
[FILTER]
    Name    throttle
    Match   kube.recs.*
    # add an upstream grep/modify step to exclude ERROR from throttling,
    # or use a level-aware sampling plugin instead of a flat per-source rate
[FILTER]
    Name    grep
    Match   kube.recs.*
    Exclude level ERROR
    # (ERROR-level records bypass this pipeline's throttle entirely)
\`\`\`

(the exact mechanism depends on the log shipper - Fluent Bit, Fluentd, and
the OpenTelemetry Collector all support conditional/severity-based
sampling rather than a single flat rate.) Cost-driven log sampling is
often necessary and reasonable, but a rate limit that treats every
severity level as equally disposable will always end up sacrificing the
rare, important signal to make room for the common, routine noise it was
actually meant to control.`,
};
