import type { Scenario } from "../types";

export const theMemoryLimitThatWasntEnough: Scenario = {
  id: "the-memory-limit-that-wasnt-enough",
  title: "The Memory Limit That Wasn't Enough",
  subtitle: "invoice-render restarts every few minutes, always mid-job",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "oom", "resources"],
  briefing: `"invoice-render" generates PDF invoices in batches. Since a traffic bump
started routing bigger batches to it this week, it's been restarting every
few minutes - always partway through a batch, never at a predictable
point in the code. No one has touched its deployment config in months.`,
  constraints: [
    "The container isn't crashing with an application error - there's no stack trace or exception anywhere in its logs before a restart.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-render", namespace: "billing", labels: { app: "invoice-render" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "invoice-render",
                  image: "registry.internal/invoice-render:2.2.0",
                  resources: { requests: { memory: "128Mi", cpu: "100m" }, limits: { memory: "256Mi", cpu: "500m" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-render-6f7g8h9i0-j1k2l", namespace: "billing", labels: { app: "invoice-render" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "invoice-render",
              ready: false,
              restartCount: 11,
              state: { waiting: { reason: "CrashLoopBackOff" } },
              lastState: { terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-15T08:40:00Z", finishedAt: "2026-09-15T08:44:12Z" } },
            },
          ],
        },
        logs: {
          "invoice-render": [
            "2026-09-15T08:44:10.881Z INFO  render.Batch - rendering invoice batch (size=340 PDFs)",
            "2026-09-15T08:44:12.014Z INFO  render.Batch - accumulating pages in memory before flush...",
          ],
        },
        events: [
          { type: "Warning", reason: "BackOff", age: "30s", message: "Back-off restarting failed container invoice-render in pod invoice-render-6f7g8h9i0-j1k2l_billing" },
        ],
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-render-notes", namespace: "billing" },
        spec: {
          data: {
            "notes.md":
              "Batch sizes historically stayed under 50 invoices per job, comfortably\nunder the 256Mi memory limit. This week's traffic bump increased average\nbatch size to 300-400 invoices - the renderer holds all pages in memory\nuntil the whole batch is done before flushing to disk.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod invoice-render-6f7g8h9i0-j1k2l -n billing` - check `lastState.terminated.reason`, not just the current waiting state.",
    "`OOMKilled` with exit code 137 means the kernel's cgroup memory limit was hit, not an application-level crash - that's consistent with no stack trace anywhere.",
    "`kubectl get configmap invoice-render-notes -n billing -o yaml` - how has the workload's actual memory usage pattern changed recently versus the limit it was set with?",
  ],
  options: [
    {
      id: "limit-too-low-for-new-batch-size",
      label:
        "invoice-render's 256Mi memory limit was sized for ~50-invoice batches held entirely in memory before flushing - now that batches average 300-400 invoices, it reliably exceeds that limit mid-batch and gets OOMKilled by the kernel, every time, well before any application code would throw an exception.",
      explanation:
        "`lastState.terminated.reason: OOMKilled` with exit code 137 is a kernel cgroup kill, not an app crash - explaining the total absence of stack traces. `invoice-render-notes` confirms batch sizes grew 6-8x this week while the renderer still accumulates the entire batch in memory before flushing, and the limit was never revisited. The restart happening at an unpredictable point in the code (rather than a fixed line) is exactly what an external memory kill looks like, versus a deterministic application bug.",
    },
    {
      id: "cpu-throttling",
      label: "The container's CPU limit of 500m is throttling it so severely that it appears to hang and gets restarted.",
      explanation:
        "CPU throttling slows a container down but doesn't cause Kubernetes to kill and restart it - only a failed probe or an OOM kill does that. `lastState.terminated.reason` explicitly says `OOMKilled`, not a probe failure, which rules out a CPU-related explanation entirely.",
    },
    {
      id: "application-bug-in-render-batch",
      label: "There's a bug in the batch rendering logic that crashes on larger inputs.",
      explanation:
        "There's no exception, stack trace, or application-level error anywhere in the logs before a restart - the container is killed externally (`OOMKilled`, exit 137), which the kernel does regardless of whether the application code itself is correct.",
    },
    {
      id: "node-out-of-memory",
      label: "The node itself is out of memory and evicting pods indiscriminately.",
      explanation:
        "A node-level memory pressure eviction would show as the pod's phase changing to `Failed` with an `Evicted` reason and status, and would typically affect multiple unrelated pods on that node - this is a per-container cgroup OOM kill scoped to invoice-render's own 256Mi limit, not a node-wide event.",
    },
  ],
  correctOptionId: "limit-too-low-for-new-batch-size",
  resolution: `\`lastState.terminated.reason: OOMKilled\` (exit code 137) confirms the
kernel's cgroup memory controller killed the container for exceeding its
256Mi limit - not an application crash, which is exactly why there's no
stack trace anywhere. \`invoice-render-notes\` explains why now: batch sizes
jumped from ~50 to 300-400 invoices this week, and the renderer holds
every page of a batch in memory until the whole thing is done before
flushing to disk. The limit was sized for the old batch size and never
revisited when traffic patterns changed.

Two complementary fixes: raise the memory limit to match real usage at
the new batch size, and stop holding an entire batch in memory at once:

\`\`\`yaml
resources:
  requests: { memory: 512Mi, cpu: 100m }
  limits: { memory: 1Gi, cpu: 500m }
\`\`\`

with a follow-up engineering task to make the renderer flush pages to
disk incrementally instead of accumulating a whole batch in memory - so
memory usage stays roughly constant regardless of batch size, instead of
scaling linearly with however large a batch happens to be that day.`,
};
