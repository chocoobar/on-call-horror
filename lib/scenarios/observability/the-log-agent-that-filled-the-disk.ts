import type { Scenario } from "../types";

export const theLogAgentThatFilledTheDisk: Scenario = {
  id: "the-log-agent-that-filled-the-disk",
  title: "The Log Agent That Filled The Disk",
  subtitle: "a node goes to DiskPressure and starts evicting healthy pods for no reason anyone can find",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 20,
  tags: ["fluentd", "disk-pressure", "logging"],
  briefing: `Node "worker-node-14" started evicting pods under \`DiskPressure\` this
morning, seemingly at random - the evicted pods themselves are unrelated
services with nothing in common, none of them writing unusual amounts of
data anywhere obvious. Nobody deployed anything to this node recently.
Disk usage on the node just keeps climbing.`,
  constraints: [
    "None of the evicted application pods have unusually large persistent volumes or are themselves writing excessive data - their own storage usage is normal and small.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "worker-node-14", labels: { "kubernetes.io/hostname": "worker-node-14" } },
        status: {
          conditions: [{ type: "DiskPressure", status: "True", reason: "KubeletHasDiskPressure" }],
        },
        events: [
          { type: "Warning", reason: "EvictionThresholdMet", age: "40m", message: "Attempting to reclaim ephemeral-storage to reclaim disk pressure" },
        ],
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        metadata: { name: "fluentd", namespace: "logging", labels: { app: "fluentd" } },
        spec: {},
        status: { desiredNumberScheduled: 12, numberReady: 12 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fluentd-buffer-notes", namespace: "logging" },
        spec: {
          data: {
            "notes.md":
              "fluentd on worker-node-14 uses `buffer_type file` writing to\n`/var/log/fluentd-buffers/` on the node's local disk, sized to grow\nunbounded (no `total_limit_size` configured) whenever its output\n(Elasticsearch) can't keep up. Elasticsearch's cluster has been rejecting\nwrites from this fluentd instance with `429 Too Many Requests` (circuit\nbreaker tripped) for the past several hours, following an unrelated\nspike in log volume from a *different* node's misbehaving pod flooding\nthe shared Elasticsearch cluster. fluentd on worker-node-14 keeps\nbuffering to local disk during every one of those rejected writes,\nretrying indefinitely, with nothing capping how large that buffer\ndirectory can grow.\n",
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "fluentd-output-config", namespace: "logging" },
        spec: {
          data: {
            "fluent.conf":
              "<match kubernetes.**>\n  @type elasticsearch\n  host elasticsearch.logging.svc\n  <buffer>\n    @type file\n    path /var/log/fluentd-buffers/kubernetes.system.buffer\n    retry_forever true\n    # NOTE: no total_limit_size set - defaults to effectively unbounded\n    # growth against local disk space.\n  </buffer>\n</match>",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl describe node worker-node-14` - what's actually consuming disk space? It's worth checking what's running on every node, not just the evicted application pods.",
    "`kubectl get configmap fluentd-buffer-notes -n logging -o yaml` - is fluentd's Elasticsearch output succeeding right now, and if not, where do the log entries it can't deliver actually go?",
    "`kubectl get configmap fluentd-output-config -n logging -o yaml` - is there any configured cap on how large fluentd's local file buffer is allowed to grow?",
  ],
  options: [
    {
      id: "unbounded-fluentd-buffer-fills-disk",
      label:
        "fluentd's file buffer on worker-node-14 has no `total_limit_size` configured, and Elasticsearch has been rejecting its writes with `429`s for hours (due to an unrelated log-volume spike from a different node) - with `retry_forever` set and nowhere to send buffered logs, the buffer directory on local disk keeps growing without a cap, consuming node disk space until kubelet hits `DiskPressure` and starts evicting unrelated pods that have nothing to do with the actual cause.",
      explanation:
        "`fluentd-buffer-notes` confirms Elasticsearch has been rejecting this fluentd instance's writes for hours due to an unrelated spike elsewhere, and that its local file buffer has no size cap, growing unbounded while retrying indefinitely. `fluentd-output-config` confirms `retry_forever true` with no `total_limit_size` set. The evicted pods themselves are unrelated and confirmed to have normal, small storage usage - the disk pressure is coming from the DaemonSet's own log-shipping buffer silently consuming the node's shared disk, not from anything the evicted application pods are doing.",
    },
    {
      id: "evicted-pods-writing-excessive-logs",
      label: "The evicted application pods are themselves writing an unusually large volume of logs or data.",
      explanation:
        "The evicted pods are confirmed to have normal, small storage usage and nothing unusual in common - they're victims of the node running low on disk space, not the cause of it. The actual disk consumption is coming from fluentd's local buffer, which sits outside any individual application pod's own storage accounting.",
    },
    {
      id: "node-kubelet-log-rotation-broken",
      label: "kubelet's own container log rotation on worker-node-14 has stopped working.",
      explanation:
        "There's no evidence of a kubelet log rotation failure - the specific, evidenced cause is a DaemonSet's (fluentd's) own unbounded local buffer directory, which is a separate location from the container logs kubelet itself manages and rotates.",
    },
    {
      id: "elasticsearch-cluster-down",
      label: "The Elasticsearch cluster is completely down, unrelated to any specific node's disk usage.",
      explanation:
        "Elasticsearch isn't down - it's actively rejecting writes with `429 Too Many Requests` due to being overloaded by volume from an unrelated node, which is a different (and directly relevant) situation from being fully unavailable. The key evidenced effect specific to this node is what fluentd does locally when its writes keep getting rejected: buffer to unbounded local disk.",
    },
  ],
  correctOptionId: "unbounded-fluentd-buffer-fills-disk",
  resolution: `\`fluentd-buffer-notes\` traces the real cause: Elasticsearch has been
rejecting writes from worker-node-14's fluentd instance with \`429 Too Many
Requests\` for several hours, triggered by an unrelated log-volume spike
from a misbehaving pod on a *different* node overwhelming the shared
cluster. \`fluentd-output-config\` shows this fluentd instance is configured
with \`retry_forever true\` and no \`total_limit_size\` on its file buffer -
so every rejected write just gets retried indefinitely, and every log
entry waiting to be delivered piles up in \`/var/log/fluentd-buffers/\` on
the node's local disk, with nothing capping how large that directory is
allowed to grow. The evicted application pods are unrelated bystanders,
confirmed to have completely normal, small storage footprints - they got
evicted simply because kubelet's \`DiskPressure\` eviction doesn't target
"whatever's actually consuming the disk," it evicts pods by its own
priority/usage heuristics, which can easily land on services that had
nothing to do with the real problem.

This is a common blind spot: a DaemonSet's local buffer directory isn't
part of any individual application pod's storage accounting, so nothing
about the evicted pods themselves would ever point at it - the disk usage
has to be found by looking at the node as a whole.

The fix is capping the buffer size (so fluentd degrades to dropping or
backpressuring logs instead of consuming unlimited disk) and alerting on
Elasticsearch write rejections directly:

\`\`\`xml
<buffer>
  @type file
  path /var/log/fluentd-buffers/kubernetes.system.buffer
  total_limit_size 2GB
  retry_forever false
  retry_max_times 10
</buffer>
\`\`\`

\`\`\`promql
rate(fluentd_output_status_num_errors_total{type="elasticsearch"}[5m]) > 0
\`\`\`

A capped buffer turns "logging backpressure silently fills a node's disk
and evicts unrelated pods" into "logging backpressure drops some logs and
raises an alert" - a much smaller, much more visible problem.`,
};
