import type { Scenario } from "../types";

export const theMemoryQuotaWall: Scenario = {
  id: "the-memory-quota-wall",
  title: "The Memory Quota Wall",
  subtitle: "a new Deployment for search-suggest can't create a single pod, with a cryptic apply error",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "resourcequota", "deployment"],
  briefing: `A new "search-suggest" Deployment being onboarded to the "catalog"
namespace fails to apply with an error about "must specify limits.memory"
- confusing, since the manifest clearly does specify memory limits. The
engineer applying it is fairly sure they haven't made a typo.`,
  constraints: [
    "The Deployment's YAML is confirmed syntactically valid, and it does explicitly set both memory requests and memory limits on its one container.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ResourceQuota",
        metadata: { name: "catalog-team-quota", namespace: "catalog" },
        spec: { hard: { "requests.memory": "12Gi", "limits.memory": "24Gi", "requests.cpu": "6", "limits.cpu": "12" }, scopes: ["NotBestEffort"] },
        status: { used: { "requests.memory": "9Gi", "limits.memory": "18Gi", "requests.cpu": "4", "limits.cpu": "8" } },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-suggest", namespace: "catalog", labels: { app: "search-suggest" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                { name: "search-suggest", image: "registry.internal/search-suggest:1.0.0", resources: { limits: { memory: "512Mi" } } },
                { name: "cache-sidecar", image: "registry.internal/cache-sidecar:2.1.0" },
              ],
            },
          },
        },
        events: [
          { type: "Warning", reason: "FailedCreate", age: "3m", message: "Error creating: pods \"search-suggest-\" is forbidden: failed quota: catalog-team-quota: must specify limits.memory,requests.memory,requests.cpu for: cache-sidecar; limits.cpu for: cache-sidecar" },
        ],
        age: "3m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "catalog-quota-notes", namespace: "catalog" },
        spec: {
          data: {
            "notes.md":
              "`catalog-team-quota` has `scopes: [NotBestEffort]`, which requires\nevery container in every pod in this namespace to specify both requests\nand limits for both CPU and memory - if even one container in a pod is\nmissing any of those four, the ResourceQuota admission check rejects\nthe entire pod creation.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "Read the actual `FailedCreate` event text in full, not just the summary - it names a specific container, and it isn't the one the engineer was looking at.",
    "`kubectl get deployment search-suggest -n catalog -o yaml` - check *every* container's `resources` block, not just the first one.",
    "`kubectl get resourcequota catalog-team-quota -n catalog -o yaml` - what does a `NotBestEffort` scope require of every container in a pod, not just the pod as a whole?",
  ],
  options: [
    {
      id: "sidecar-container-missing-resources",
      label:
        "The `search-suggest` container does correctly specify a memory limit, but the Deployment's second container, `cache-sidecar`, has no `resources` block at all - `catalog-team-quota`'s `NotBestEffort` scope requires every container in every pod to specify requests and limits for both CPU and memory, and since `cache-sidecar` specifies none of them, the entire pod creation is rejected, with the error naming the actual offending container rather than the one the engineer was checking.",
      explanation:
        "The event's full text names `cache-sidecar` specifically as missing `limits.memory, requests.memory, requests.cpu` and `limits.cpu` - not `search-suggest`, which is why simply re-checking the first container's resources looked fine. `catalog-quota-notes` explains the mechanism: a `NotBestEffort`-scoped ResourceQuota requires *every* container in a pod to fully specify requests and limits for both CPU and memory, and if any one container falls short, the whole pod's creation is blocked - a detail easy to miss when a Deployment has more than one container and only the main one gets resource-tuning attention.",
    },
    {
      id: "quota-limits-exceeded",
      label: "The `catalog-team-quota`'s memory limit has already been exhausted by other workloads.",
      explanation:
        "`status.used.limits.memory` is 18Gi against a `spec.hard.limits.memory` of 24Gi - there's 6Gi of headroom remaining, plenty for this Deployment's modest request. The rejection is about a missing field on a specific container, per the event's own wording, not exhausted quota capacity.",
    },
    {
      id: "deployment-yaml-typo",
      label: "There's a subtle typo in the memory limit's value or unit in the manifest.",
      explanation:
        "The scenario confirms the YAML is syntactically valid, and the error text is explicit about which *fields are entirely absent* on a *specific container* (`cache-sidecar`) rather than describing any malformed or invalid value - this is a missing-field problem on the second container, not a typo in the first.",
    },
    {
      id: "namespace-quota-scope-misapplied",
      label: "The ResourceQuota's `NotBestEffort` scope is misconfigured and shouldn't apply to this namespace at all.",
      explanation:
        "The scope is working exactly as `NotBestEffort` is documented to: requiring full resource specification on every container. There's nothing misconfigured about the quota itself - the gap is in the Deployment's manifest, which forgot to give the sidecar container any resources at all.",
    },
  ],
  correctOptionId: "sidecar-container-missing-resources",
  resolution: `The \`FailedCreate\` event's full text names the actual problem container:
\`cache-sidecar\`, missing \`limits.memory, requests.memory, requests.cpu\`,
and \`limits.cpu\` - not \`search-suggest\`, which does have a memory limit
set and was the container the engineer kept re-checking. \`catalog-quota-notes\`
explains why a single container's gap blocks the whole pod:
\`catalog-team-quota\`'s \`NotBestEffort\` scope requires every container in
every pod in the namespace to fully specify requests and limits for both
CPU and memory - miss it on even one container, including an
easily-overlooked sidecar, and the ResourceQuota admission check rejects
pod creation entirely, with an error that (helpfully, once read in full)
names exactly which container and which fields are missing.

The fix is giving \`cache-sidecar\` the resource spec it was missing:

\`\`\`yaml
- name: cache-sidecar
  image: registry.internal/cache-sidecar:2.1.0
  resources:
    requests: { cpu: 50m, memory: 64Mi }
    limits: { cpu: 200m, memory: 128Mi }
\`\`\`

A multi-container pod under a \`NotBestEffort\`-scoped quota is only as
compliant as its least-configured container - it's worth double-checking
every container (main app, sidecars, and any injected ones) whenever a
Deployment is going into a namespace with this kind of ResourceQuota
scope, since the API's rejection message, while accurate, is easy to
misread as being about the container that's actually top of mind.`,
};
