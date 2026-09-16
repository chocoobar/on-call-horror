import type { Scenario } from "./types";

export const theLivenessProbeTouchingASlowBean: Scenario = {
  id: "the-liveness-probe-touching-a-slow-bean",
  title: "The Liveness Probe Touching a Slow Bean",
  subtitle: "contract-archive-api gets restarted by Kubernetes several times a week, always mid-perfectly-healthy-operation",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "actuator", "kubernetes"],
  briefing: `"contract-archive-api" gets killed and restarted by its liveness probe
several times a week, always without warning, while otherwise processing
requests completely normally. The team's first instinct - that the JVM is
deadlocking or hanging - doesn't match what they see: the restarts are
brief, and the pod comes right back up and resumes normal operation
immediately after.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "contract-archive-api", namespace: "legal", labels: { app: "contract-archive-api" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                { name: "contract-archive-api", image: "registry.internal/contract-archive-api:2.4.0", livenessProbe: { httpGet: { path: "/actuator/health/liveness", port: 8080 }, periodSeconds: 10, timeoutSeconds: 2, failureThreshold: 3 } },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "16d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "contract-archive-api-1g2h3i4j5-k6l7m", namespace: "legal", labels: { app: "contract-archive-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "contract-archive-api", ready: true, restartCount: 4, state: { running: {} } }] },
        events: [
          { type: "Warning", reason: "Unhealthy", age: "40m", message: "Liveness probe failed: Get \"http://10.244.4.7:8080/actuator/health/liveness\": context deadline exceeded" },
          { type: "Normal", reason: "Killing", age: "40m", message: "Container contract-archive-api failed liveness probe, will be restarted" },
        ],
        logs: {
          "contract-archive-api": [
            "2026-09-15T10:05:01.114Z INFO  c.e.legal.ArchiveStorageHealthIndicator - checking cold-storage archive availability (synchronous HEAD request to archive-vault)",
            "2026-09-15T10:05:07.884Z WARN  c.e.legal.ArchiveStorageHealthIndicator - archive-vault HEAD request took 6770ms (cold storage occasionally has high latency on first access after idle)",
          ],
        },
        age: "16d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "contract-archive-api-notes", namespace: "legal" },
        spec: {
          data: {
            "ArchiveStorageHealthIndicator.java.excerpt":
              "@Component(\"archiveStorage\")\npublic class ArchiveStorageHealthIndicator implements HealthIndicator {\n    @Override\n    public Health health() {\n        // included in the LIVENESS group - synchronously pings the\n        // cold-storage archive backend, which occasionally has high\n        // latency (multiple seconds) on its first access after being\n        // idle for a while\n        boolean reachable = archiveVaultClient.headCheck();\n        return reachable ? Health.up().build() : Health.down().build();\n    }\n}\n",
            "notes.md":
              "Liveness is meant to answer one question: 'is this process so broken\nit needs to be killed and restarted?' `archiveVaultClient.headCheck()`\nbeing occasionally slow doesn't mean the JVM is stuck or unrecoverable -\nit means one specific downstream dependency is briefly slow, which is\nan entirely different condition than the process itself being dead.",
          },
        },
        age: "16d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod contract-archive-api-1g2h3i4j5-k6l7m -n legal` - the liveness probe fails with `context deadline exceeded`. What's the probe's own `timeoutSeconds`, and how does that compare to how long `ArchiveStorageHealthIndicator` sometimes takes?",
    "`kubectl logs contract-archive-api-1g2h3i4j5-k6l7m -n legal` - the health indicator itself explains its own occasional slowness. Is that slowness a sign the JVM is broken, or a sign a downstream dependency is briefly slow?",
    "`kubectl get configmap contract-archive-api-notes -n legal -o yaml` - is `ArchiveStorageHealthIndicator` part of the *liveness* group specifically? What's the difference between what liveness is supposed to mean versus what this check is actually verifying?",
  ],
  options: [
    {
      id: "downstream-dependent-indicator-wired-into-liveness-not-readiness",
      label:
        "`ArchiveStorageHealthIndicator` is wired into the *liveness* group and synchronously pings a cold-storage backend known to occasionally take several seconds on its first access after being idle; when that happens, it blows past the liveness probe's own `timeoutSeconds: 2`, and Kubernetes - correctly following its own semantics for a liveness failure - kills and restarts a process that was never actually broken, just temporarily waiting on a slow but healthy downstream dependency during a check that should never have been part of liveness in the first place.",
      explanation:
        "The event shows the liveness probe failing with `context deadline exceeded`, and the application's own log explains why: `ArchiveStorageHealthIndicator`'s synchronous check to `archive-vault` took 6770ms - more than three times the probe's `timeoutSeconds: 2` and well past its `periodSeconds: 10` window too. `contract-archive-api-notes` makes the underlying issue explicit: liveness is meant to answer whether the process itself is unrecoverable, and a downstream dependency being briefly slow is an entirely different condition - one that should affect readiness (temporarily pull the pod from traffic) at most, never trigger Kubernetes to kill and restart an otherwise perfectly healthy JVM.",
    },
    {
      id: "liveness-probe-timeout-simply-too-short",
      label: "The liveness probe's `timeoutSeconds: 2` is simply too short and needs to be increased to accommodate the check.",
      explanation:
        "Loosening the timeout would reduce how often this specific incident happens, but it doesn't address the deeper design problem: liveness should never depend on a downstream dependency's availability at all, since a sufficiently slow (or briefly unreachable) downstream would still eventually breach any fixed timeout and cause the same unnecessary restart.",
    },
    {
      id: "archive-vault-genuinely-unreliable",
      label: "archive-vault itself is unreliable and its own availability issues need to be fixed directly.",
      explanation:
        "`contract-archive-api-notes` describes archive-vault's occasional latency on cold access as a known, expected characteristic of cold storage, not a genuine reliability defect - the actual problem is that this expected behavior was wired into a Kubernetes-facing check with severe consequences (a process restart) for something that isn't actually process failure.",
    },
    {
      id: "jvm-genuinely-hanging-under-gc-pressure",
      label: "The JVM is genuinely hanging under GC pressure exactly when these liveness failures occur.",
      explanation:
        "There's no GC log evidence, no long pause, and no other application activity stalling during these incidents - the application's own health indicator explains its own delay directly and specifically as a downstream network call taking longer than usual, not as the JVM itself being unresponsive.",
    },
  ],
  correctOptionId: "downstream-dependent-indicator-wired-into-liveness-not-readiness",
  resolution: `The Kubernetes event names the failure precisely: \`context deadline
exceeded\` on the liveness probe. The application's own log, moments
before, explains exactly why: \`ArchiveStorageHealthIndicator\`'s check
against \`archive-vault\` took 6770ms - well past the probe's own
\`timeoutSeconds: 2\`, and the indicator's own log message even
acknowledges this is expected, occasional behavior for cold storage
accessed after being idle.

\`contract-archive-api-notes\` names the actual design flaw:
\`ArchiveStorageHealthIndicator\` was wired into the *liveness* health
group, but what it actually measures - whether a downstream cold-storage
backend responds quickly - has nothing to do with whether the JVM itself
is broken and needs to be killed. Liveness exists to answer one narrow
question: is this process in an unrecoverable state that only a restart
can fix? A downstream dependency being briefly, expectedly slow is a
completely different condition - one liveness should never even be aware
of. Kubernetes did exactly what liveness failing tells it to do: kill and
restart a process that was, the whole time, perfectly healthy and simply
waiting on a slow network call.

The fix is moving this check out of liveness entirely - at most, it
belongs in readiness (where a temporary failure means "pull from traffic
briefly," not "kill the process"), and ideally it should time out
gracefully rather than block:

\`\`\`java
@Component("archiveStorage")
public class ArchiveStorageHealthIndicator implements HealthIndicator {
    // NOT included in the liveness group - moved to readiness only,
    // and given its own short timeout so a slow downstream can't even
    // stall readiness checks indefinitely
    @Override
    public Health health() {
        try {
            boolean reachable = archiveVaultClient.headCheckWithTimeout(Duration.ofSeconds(1));
            return reachable ? Health.up().build() : Health.down().build();
        } catch (TimeoutException e) {
            return Health.unknown().withDetail("reason", "archive-vault slow to respond").build();
        }
    }
}
\`\`\`

\`\`\`yaml
management:
  endpoint:
    health:
      group:
        liveness:
          include: livenessState  # no downstream dependency checks
        readiness:
          include: readinessState, archiveStorage
\`\`\`

Liveness should only ever depend on the process's own internal state -
any check that can fail because of something outside the JVM (a
database, a downstream API, a storage backend) belongs in readiness at
most, never liveness, or a temporary hiccup anywhere downstream becomes
an unnecessary restart of a perfectly healthy process.`,
};
