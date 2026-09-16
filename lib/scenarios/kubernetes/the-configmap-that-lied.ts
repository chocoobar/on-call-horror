import type { Scenario } from "../types";

export const theConfigmapThatLied: Scenario = {
  id: "the-configmap-that-lied",
  title: "The ConfigMap That Lied",
  subtitle: "the config was fixed an hour ago - the pods still act like it wasn't",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "configmap", "rollout"],
  briefing: `Someone noticed "rates-api" was using a stale currency conversion rate and
fixed it by editing the \`rates-api-config\` ConfigMap directly. That was an
hour ago. The pods are still returning the old rate.`,
  constraints: [
    "The ConfigMap itself is confirmed correct right now - the problem is entirely about whether the running pods have picked it up.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "rates-api-config", namespace: "rates" },
        spec: { data: { "rates.yaml": "usd_to_eur: 0.94\n" } },
        age: "1h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "rates-api", namespace: "rates", labels: { app: "rates-api" } },
        spec: {
          replicas: 3,
          template: {
            metadata: { labels: { app: "rates-api" } },
            spec: { containers: [{ name: "rates-api", image: "registry.internal/rates-api:1.4.0", volumeMounts: [{ name: "config", mountPath: "/config" }] }] },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "rates-api-7a8b9c0d1-e2f3g", namespace: "rates", labels: { app: "rates-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "rates-api", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-14T20:00:00Z" } } }] },
        logs: {
          "rates-api": [
            "2026-09-15T09:00:01.114Z INFO  c.e.rates.RatesLoader - loaded rates.yaml at startup: usd_to_eur=0.91",
            "2026-09-15T09:00:05.204Z INFO  c.e.rates.RatesController - quote requested, using cached usd_to_eur=0.91",
          ],
        },
        age: "13h",
      },
    ],
  },
  hints: [
    "`kubectl get configmap rates-api-config -n rates -o yaml` vs `kubectl logs <pod> -n rates` - what value did the app actually load, and when?",
    "`kubectl get pod rates-api-7a8b9c0d1-e2f3g -n rates -o yaml` - check the container's `startedAt` against when the ConfigMap was edited.",
    "A ConfigMap volume mount does eventually sync new file content into a running pod, but the app in these logs only reads the file once, at startup ('loaded rates.yaml at startup') - it isn't watching the file for changes.",
  ],
  options: [
    {
      id: "app-reads-config-once-at-startup",
      label:
        "rates-api reads rates.yaml once at startup and caches the value in memory - editing the ConfigMap changes the file that gets mounted, but the already-running pods (started 13 hours ago) never re-read it, so they keep serving the value they loaded when they last started.",
      explanation:
        "The pod's own log line says exactly this: \"loaded rates.yaml at startup: usd_to_eur=0.91\" - a one-time read, not something re-evaluated per request. The pod started 13 hours ago, long before the ConfigMap edit an hour ago. Editing a ConfigMap updates the mounted file's content live, but it does nothing to a process that already read that file into memory and never looks at it again.",
    },
    {
      id: "configmap-not-mounted",
      label: "The ConfigMap isn't actually mounted into the pod at all.",
      explanation:
        "The Deployment's volume mount for `config` at `/config` is present and correctly configured, and the pod's own startup log confirms it successfully read a rates.yaml file (just an old value) - the mount is working, the pod simply hasn't re-read it since.",
    },
    {
      id: "wrong-configmap-name",
      label: "The Deployment references a different ConfigMap name than the one that got edited.",
      explanation:
        "There's only one `rates-api-config` ConfigMap in this namespace, and the pod's startup log shows it successfully loading a `rates.yaml` file - if the name were wrong, the mount would fail entirely rather than loading stale-but-present values.",
    },
    {
      id: "dns-caching-config",
      label: "DNS caching is preventing the pod from seeing the updated ConfigMap.",
      explanation:
        "ConfigMaps are delivered to pods via the kubelet syncing volume contents, not DNS - DNS resolution has nothing to do with how a mounted file's contents reach a container.",
    },
  ],
  correctOptionId: "app-reads-config-once-at-startup",
  resolution: `The pod's own log line gives it away: \`loaded rates.yaml at startup\` -
a one-time read at process start, then cached in memory for the pod's
entire lifetime. Editing the ConfigMap does update the file kubelet
mounts into the container (usually within a minute or so), but that only
matters to code that re-reads the file or watches it for changes.
rates-api does neither - it read the old value 13 hours ago and has had
no reason to look again since.

There's nothing wrong with the ConfigMap, the mount, or Kubernetes here -
this is purely a "the app doesn't know it's supposed to reload"
mismatch. Editing a ConfigMap is not equivalent to redeploying an
application unless something ties the two together. The fix is a rolling
restart to pick up the new value:

\`\`\`bash
kubectl rollout restart deployment/rates-api -n rates
\`\`\`

For the future, the standard pattern is annotating the pod template with
a hash of the ConfigMap's contents (many teams use a Helm/Kustomize
plugin, or a checksum annotation set by CI) so that any ConfigMap change
automatically changes the pod template and triggers a real rollout -
rather than relying on someone remembering to restart pods by hand every
time config changes.`,
};
