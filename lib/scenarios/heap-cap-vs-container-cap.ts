import type { Scenario } from "./types";

export const heapCapVsContainerCap: Scenario = {
  id: "heap-cap-vs-container-cap",
  title: "The Heap Cap vs the Container Cap",
  subtitle: "invoice-renderer gets OOMKilled while the JVM insists heap usage is fine",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "containers", "memory"],
  briefing: `"invoice-renderer" was bumped to a bigger instance type last week to handle
a new PDF export feature, and someone carried over an old JVM flag from a
much larger box: \`-Xmx6g\`. The pod itself only has a 4Gi memory limit.
It's been getting OOMKilled a few times a day, always mid-render, and the
on-call before you swears the heap dump they pulled showed plenty of
headroom.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "invoice-renderer", namespace: "billing", labels: { app: "invoice-renderer" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "invoice-renderer",
                  image: "registry.internal/invoice-renderer:2.1.4",
                  env: [{ name: "JAVA_TOOL_OPTIONS", value: "-Xmx6g -Xms2g" }],
                  resources: { requests: { memory: "4Gi" }, limits: { memory: "4Gi" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 2, availableReplicas: 1 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "invoice-renderer-6d9f8c7b5-p2q3r", namespace: "billing", labels: { app: "invoice-renderer" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "invoice-renderer",
              ready: true,
              restartCount: 6,
              state: { running: {} },
              lastState: { terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-14T20:10:00Z", finishedAt: "2026-09-15T09:41:12Z" } },
            },
          ],
        },
        events: [
          { type: "Warning", reason: "OOMKilling", age: "12m", message: "Memory cgroup out of memory: Killed process (java) total-vm:7123456kB, anon-rss:4190872kB" },
        ],
        logs: {
          "invoice-renderer": [
            "2026-09-15T09:41:10.221Z INFO  c.e.billing.PdfRenderer - rendering invoice batch INV-88213, 340 pages",
            "2026-09-15T09:41:11.884Z INFO  c.e.billing.PdfRenderer - heap after render: used=1.9G committed=3.1G max=6.0G",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "invoice-renderer-notes", namespace: "billing" },
        spec: {
          data: {
            "notes.md":
              "`-Xmx` tells the JVM the maximum size of the *Java heap*. It has no idea\nwhat the container's cgroup memory limit is unless told separately - the\ncontainer's OOM killer only looks at total memory used by the whole\nprocess (heap + metaspace + thread stacks + direct buffers + JIT code\ncache), not what the JVM itself considers 'heap full'.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod invoice-renderer-6d9f8c7b5-p2q3r -n billing` - `lastState.terminated.reason` is `OOMKilled`. Compare the container's memory `limits` against the JVM flags in the Deployment's env.",
    "The application log says heap usage is `used=1.9G ... max=6.0G` - well under the JVM's own idea of full. What's the container's actual memory limit, and does the JVM know about it at all?",
    "`kubectl get configmap invoice-renderer-notes -n billing -o yaml` - an explicit `-Xmx` overrides the JVM's own container-aware sizing entirely.",
  ],
  options: [
    {
      id: "xmx-exceeds-container-limit",
      label:
        "`-Xmx6g` was hardcoded for a larger instance and is bigger than the container's 4Gi memory limit; the cgroup OOM killer only cares about total container memory use, not the JVM's own sense of heap headroom, so it kills the process the moment total RSS crosses 4Gi - regardless of what the heap logs say.",
      explanation:
        "The Deployment sets `-Xmx6g` while `resources.limits.memory` is `4Gi`. The pod's OOM event confirms `anon-rss:4190872kB` (~4Gi) at the moment of the kill - right at the container limit, while the app's own log insists heap has 4.1G of headroom before hitting its 6G ceiling. An explicit `-Xmx` overrides the JVM's built-in container-aware sizing, so the JVM never adjusts to the smaller cgroup limit; it happily grows toward 6g of heap, and the container is killed by the kernel cgroup OOM killer well before the JVM would ever consider itself out of memory.",
    },
    {
      id: "memory-leak-in-pdf-renderer",
      label: "PdfRenderer has a memory leak that slowly exhausts available memory over each render.",
      explanation:
        "The app's own log shows heap usage sitting comfortably at 1.9G used out of a 6G max right before the kill - that's not a leak building toward the JVM's own ceiling, it's a container-level limit being hit that the JVM was never configured to respect in the first place.",
    },
    {
      id: "too-few-replicas",
      label: "Two replicas isn't enough to handle the new PDF export feature's load.",
      explanation:
        "Replica count affects how much total traffic the service can handle, not whether an individual pod gets OOMKilled - this is a per-pod memory ceiling mismatch, visible directly in the OOM event's RSS figure matching the container limit exactly.",
    },
    {
      id: "pdf-library-native-leak",
      label: "The PDF rendering library is leaking native (off-heap) memory outside the JVM's tracking.",
      explanation:
        "There's no evidence of gradually climbing native memory here - the RSS figure in the OOM event lines up almost exactly with the container's 4Gi limit at a single render, consistent with a heap simply sized larger than the container allows, not a slow native leak.",
    },
  ],
  correctOptionId: "xmx-exceeds-container-limit",
  resolution: `The OOM event's \`anon-rss:4190872kB\` lands right at the container's 4Gi
memory limit, while the app's own log insists heap usage is nowhere near
its ceiling (\`used=1.9G ... max=6.0G\`). \`invoice-renderer-notes\` explains
the gap: \`-Xmx\` only bounds the *Java heap*; it says nothing to the kernel
cgroup about the container's actual memory limit, and it overrides the
JVM's own built-in container-aware default sizing (\`-XX:MaxRAMPercentage\`)
that would otherwise size the heap relative to the limit automatically.
With \`-Xmx6g\` hardcoded from the old, larger instance type and a 4Gi
container limit, the JVM happily grows heap plus metaspace, thread
stacks, and JIT code cache toward 6g of *intent* - the kernel's cgroup OOM
killer steps in and kills the whole process the instant total memory use
crosses 4Gi, long before the JVM's own heap accounting would ever call
itself full.

The fix is to stop hardcoding an absolute heap size and let the JVM size
itself relative to the container it's actually running in:

\`\`\`yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-XX:MaxRAMPercentage=70.0"
\`\`\`

\`MaxRAMPercentage\` (rather than a fixed \`-Xmx\`) makes the JVM compute its
heap ceiling as a percentage of the container's own memory limit, so it
automatically tracks whatever the container is actually granted - on this
4Gi limit, roughly 2.8Gi of heap, leaving headroom for metaspace, thread
stacks, and native buffers instead of overshooting the container entirely.`,
};
