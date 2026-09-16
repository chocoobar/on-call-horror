import type { Scenario } from "../types";

export const theDiskThatFilledWithLogs: Scenario = {
  id: "the-disk-that-filled-with-logs",
  title: "The Disk That Filled With Logs",
  subtitle: "debug-proxy gets evicted every few hours, always with the same node",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "eviction", "storage"],
  briefing: `"debug-proxy" was deployed a week ago with verbose request/response logging
turned on "temporarily" for troubleshooting an unrelated issue - a flag
nobody has remembered to turn back off since. Every few hours it gets
evicted and rescheduled. Its own resource limits look completely
reasonable for what it does.`,
  constraints: [
    "debug-proxy's CPU and memory usage are both confirmed to be well within their requests/limits at all times - this isn't a memory or CPU issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "debug-proxy", namespace: "tools", labels: { app: "debug-proxy" } },
        spec: {
          replicas: 1,
          template: {
            spec: { containers: [{ name: "debug-proxy", image: "registry.internal/debug-proxy:0.9.1", resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } }] },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1 },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "debug-proxy-8b9c0d1e2-f3g4h", namespace: "tools", labels: { app: "debug-proxy" } },
        status: {
          phase: "Failed",
          reason: "Evicted",
          message: "The node was low on resource: ephemeral-storage. Container debug-proxy was using 9872132Ki, which exceeds its request of 0.",
        },
        events: [
          { type: "Warning", reason: "Evicted", age: "15m", message: "The node was low on resource: ephemeral-storage. Container debug-proxy was using 9872132Ki, which exceeds its request of 0." },
          { type: "Warning", reason: "FreeDiskSpaceFailed", age: "16m", message: "failed to garbage collect required amount of images. Wanted to free 5000000000 bytes, but freed 1200000000 bytes" },
        ],
        age: "15m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "debug-proxy-logging-flag-notes", namespace: "tools" },
        spec: {
          data: {
            "notes.md":
              "debug-proxy was launched 7 days ago with `VERBOSE_LOG=true` set to\ntroubleshoot a since-resolved issue - it logs full request and response\nbodies to its container's local log stream at high volume\n(roughly 1-1.5GB/hour under normal traffic). No `ephemeral-storage`\nrequest or limit was ever set on the container, so nothing bounds how\nmuch of the node's local disk it's allowed to consume before the\nkubelet's eviction manager steps in.\n",
          },
        },
        age: "7d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod debug-proxy-8b9c0d1e2-f3g4h -n tools` - the eviction message names a specific resource, and it isn't CPU or memory.",
    "`kubectl get deployment debug-proxy -n tools -o yaml` - is there any `ephemeral-storage` request or limit set?",
    "`kubectl get configmap debug-proxy-logging-flag-notes -n tools -o yaml` - what's actually consuming local disk on the node over time?",
  ],
  options: [
    {
      id: "verbose-logging-fills-ephemeral-storage",
      label:
        "debug-proxy has been running with verbose request/response logging on for a week, generating roughly 1-1.5GB/hour of log output with no `ephemeral-storage` request or limit set to bound it - it keeps consuming the node's local disk until the kubelet's eviction manager hits its low-disk threshold and evicts the pod to reclaim space, then the cycle repeats once it reschedules and starts logging heavily again.",
      explanation:
        "The eviction message is specific: \"low on resource: ephemeral-storage,\" citing debug-proxy using nearly 10GB against a request of 0 (meaning nothing was ever declared, so nothing bounds it). `debug-proxy-logging-flag-notes` explains the source - a \"temporary\" verbose logging flag left on for a week, generating log volume fast enough to exhaust local disk over a period of hours, which matches the recurring every-few-hours eviction pattern. CPU and memory are both confirmed fine, ruling those out and pointing squarely at disk usage from logging.",
    },
    {
      id: "memory-limit-too-low",
      label: "debug-proxy's 256Mi memory limit is too low for its actual workload.",
      explanation:
        "The scenario confirms memory usage stays well within limits at all times, and the eviction event explicitly cites `ephemeral-storage`, not memory - this rules out a memory-related explanation regardless of how the limit is set.",
    },
    {
      id: "node-disk-hardware-failing",
      label: "The node's disk hardware is failing, causing space to appear to shrink.",
      explanation:
        "The eviction event's own numbers show a real, large, and attributable consumer - debug-proxy using nearly 10GB - rather than any indication of unexplained or failing disk capacity. This is genuine disk usage from one workload, not a hardware problem.",
    },
    {
      id: "other-pods-on-node-using-disk",
      label: "Unrelated pods sharing the node are the ones consuming the disk space.",
      explanation:
        "The eviction message specifically attributes the usage to debug-proxy itself (\"Container debug-proxy was using 9872132Ki\"), and the pattern - recurring evictions that track directly with debug-proxy's own known verbose-logging behavior - points at it as the source, not other tenants on the node.",
    },
  ],
  correctOptionId: "verbose-logging-fills-ephemeral-storage",
  resolution: `The eviction message names the exact resource: "low on resource:
ephemeral-storage," with debug-proxy itself cited as using nearly 10GB
against a declared request of 0 - meaning nothing was ever set to bound
its disk usage in the first place. \`debug-proxy-logging-flag-notes\`
explains where that disk usage comes from: a "temporary" verbose logging
flag turned on a week ago for an unrelated investigation and never
turned back off, generating roughly 1-1.5GB/hour of request/response log
output. Left unbounded, that fills the node's local disk within a few
hours, the kubelet's eviction manager reclaims space by evicting the
worst offender, and the cycle starts over on whatever node it lands on
next.

Two fixes, one immediate and one structural. First, turn the debug
logging back off now that the original issue it was added for is
resolved - it's served its purpose. Second, put a real
\`ephemeral-storage\` limit on the container so a future "temporary" debug
flag can't repeat this:

\`\`\`yaml
resources:
  requests: { cpu: 100m, memory: 128Mi, ephemeral-storage: 512Mi }
  limits: { cpu: 500m, memory: 256Mi, ephemeral-storage: 1Gi }
\`\`\`

With a real ephemeral-storage limit in place, a future logging spike
gets the container itself evicted quickly and visibly (and ideally
alerted on) well before it can consume enough of the node's shared disk
to affect anything else running there.`,
};
