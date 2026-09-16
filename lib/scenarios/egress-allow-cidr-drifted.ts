import type { Scenario } from "./types";

export const egressAllowCidrDrifted: Scenario = {
  id: "egress-allow-cidr-drifted",
  title: "The CIDR The Cloud Left Behind",
  subtitle: "an egress rule that's been correct for two years is suddenly wrong, and nobody touched it",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["networkpolicy", "egress", "cloud-nat"],
  briefing: `"backup-uploader" has reliably pushed nightly backups to a cloud object
storage endpoint for two years through a tightly-scoped NetworkPolicy
egress rule pinned to the storage service's documented IP range. Last
night's backup job failed outright with connection timeouts. Nobody
touched the NetworkPolicy, backup-uploader's Deployment, or its
configuration in months.`,
  constraints: [
    "The cloud storage provider's own status page shows no incident, and the storage endpoint is reachable from outside this specific cluster's network right now.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: { name: "backup-uploader", namespace: "backups", labels: { app: "backup-uploader" } },
        spec: { schedule: "0 2 * * *" },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "backup-uploader-29384850-x1y2z", namespace: "backups", labels: { app: "backup-uploader" } },
        status: { phase: "Failed", containerStatuses: [{ name: "backup-uploader", ready: false, restartCount: 0, state: { terminated: { reason: "Error" } } }] },
        logs: {
          "backup-uploader": [
            "2026-09-15T02:00:05.010Z ERROR backupUploader - connect timed out: storage.cloudprovider.example:443 (203.0.113.140)",
            "2026-09-15T02:00:35.040Z ERROR backupUploader - connect timed out: storage.cloudprovider.example:443 (203.0.113.140)",
          ],
        },
        age: "12h",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: "backup-uploader-egress", namespace: "backups" },
        spec: {
          podSelector: { matchLabels: { app: "backup-uploader" } },
          policyTypes: ["Egress"],
          egress: [{ to: [{ ipBlock: { cidr: "198.51.100.0/24" } }], ports: [{ port: 443, protocol: "TCP" }] }],
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "storage-provider-notice", namespace: "backups" },
        spec: {
          data: {
            "notice.md":
              "Cloud storage provider status history (public changelog): 'As of\n2026-09-14, we have expanded our published IP ranges for the\nstorage.cloudprovider.example endpoint to include additional capacity in\na new, entirely separate address block, 203.0.113.128/27, alongside the\npreviously documented 198.51.100.0/24 range, for a growing percentage of\ntraffic as part of ongoing capacity rebalancing. Existing firewall/\nallow-list rules scoped only to the old range should be updated to also\ninclude the new block.' DNS resolution for the endpoint now returns\naddresses from both the old and new ranges, rotating over time.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "backup-uploader's log shows it attempting to connect to `203.0.113.140` - does that actually fall inside the NetworkPolicy's allowed `198.51.100.0/24` range?",
    "`kubectl get configmap storage-provider-notice -n backups -o yaml` - did the storage provider's own published IP ranges change recently, independent of anything in this cluster?",
    "Two years of stability ending abruptly, with nobody touching the policy or the job, points at something *external* to the cluster changing - what's the one thing both sides of this connection depend on that neither team directly controls?",
  ],
  options: [
    {
      id: "provider-expanded-ip-range-outside-old-cidr",
      label:
        "The cloud storage provider expanded its published IP ranges for this endpoint to include a new, entirely separate block, `203.0.113.128/27`, alongside the previously documented `198.51.100.0/24` range the NetworkPolicy was scoped to two years ago - DNS now sometimes resolves the endpoint to an address in the new range, and any connection attempt against one of those addresses falls completely outside the policy's allowed CIDR and gets silently blocked, even though the NetworkPolicy itself was never touched and used to be entirely correct.",
      explanation:
        "The failing connection attempt's target IP, `203.0.113.140`, falls inside the newly-announced `203.0.113.128/27` block - a completely different address range than the `198.51.100.0/24` CIDR the NetworkPolicy has allowed for two years. `storage-provider-notice` confirms the provider's own published range changed on 2026-09-14, right before the failures began, with DNS now returning a rotating mix of old and new addresses - explaining a job that ran reliably for two years suddenly failing with no changes on the cluster's own side at all.",
    },
    {
      id: "cloud-nat-gateway-ip-rotated",
      label: "The cluster's own outbound NAT gateway IP rotated, and the storage provider's own allow-list (in the other direction) now rejects it.",
      explanation:
        "The failure described is a connect timeout initiated from backup-uploader's side against the storage endpoint, and the NetworkPolicy governs *this cluster's own* egress rules for outbound destinations - not anything about the storage provider's inbound allow-listing of source IPs, which isn't indicated as a factor here at all.",
    },
    {
      id: "backup-payload-grew-past-a-limit",
      label: "The nightly backup's data volume grew past some undocumented size limit on the storage provider's side.",
      explanation:
        "The failure is a connection timeout occurring before any data transfer begins, not a rejection or error partway through an upload - a size-limit issue would show up as a failure during or after a substantial part of the transfer, not as an inability to even establish a connection in the first place.",
    },
    {
      id: "cronjob-schedule-conflict",
      label: "The CronJob's schedule now conflicts with another job contending for the same egress bandwidth.",
      explanation:
        "The specific, repeated error is a connect timeout to a specific IP address that falls outside the NetworkPolicy's allowed range - a bandwidth contention issue would more likely produce a slow-but-eventually-successful transfer rather than a clean, total inability to establish a connection at all, and wouldn't correlate with a specific IP address falling outside an allow-listed CIDR.",
    },
  ],
  correctOptionId: "provider-expanded-ip-range-outside-old-cidr",
  resolution: `\`storage-provider-notice\` explains exactly what changed, and when: the
cloud storage provider expanded its published IP ranges for this
endpoint effective 2026-09-14 - the day before the backup started
failing - to include additional address space as part of ongoing
capacity rebalancing, with DNS now returning a rotating mix of addresses
from both the original and newly-announced ranges. backup-uploader's own
NetworkPolicy egress rule has been correctly scoped to the provider's
*previously* documented range for two years, and nobody on this side
touched it - but the provider's own infrastructure moved a portion of
its traffic outside that original range. Whenever DNS happens to
resolve the storage endpoint to an address in the newly-added block,
the resulting connection attempt no longer falls inside the
NetworkPolicy's allowed CIDR and is silently dropped - explaining a
job that had been completely reliable for two years suddenly failing
with zero changes on the cluster's own side.

The fix is widening the egress rule to cover the provider's newly
published range as well:

\`\`\`yaml
spec:
  egress:
    - to:
        - ipBlock:
            cidr: 198.51.100.0/24
        - ipBlock:
            cidr: 203.0.113.128/27
      ports:
        - port: 443
          protocol: TCP
\`\`\`

More durably, since this provider has already signaled ongoing capacity
rebalancing (implying the range may expand again), it's worth checking
whether the provider publishes a machine-readable, authoritative list of
current IP ranges (many major cloud storage providers do, specifically
so downstream firewall/allow-list rules can be kept in sync
automatically) rather than relying on a CIDR pinned at some past point
in time. Any egress NetworkPolicy scoped to a third-party's IP range is
implicitly a bet that the third party's own address space won't change -
worth periodically re-verifying, especially for infrequent (e.g.
nightly) jobs where a break might not surface for a full day or more.`,
};
