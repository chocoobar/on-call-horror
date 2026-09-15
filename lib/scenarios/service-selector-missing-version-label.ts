import type { Scenario } from "./types";

export const serviceSelectorMissingVersionLabel: Scenario = {
  id: "service-selector-missing-version-label",
  title: "The Version Label That Got Left Behind",
  subtitle: "the rollout succeeded. the Service now points at nothing.",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["service", "endpoints", "deployment"],
  briefing: `"catalog-api" just went through a routine deploy that bumped its pod
template labels to include a new "version: v2" tag for an upcoming canary
setup. The rollout itself completed cleanly - new pods are Running and
Ready. Within a minute of the old pods finishing termination, every
request to catalog-api's Service started failing outright.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "catalog-api", namespace: "catalog", labels: { app: "catalog-api" } },
        spec: {
          replicas: 4,
          selector: { matchLabels: { app: "catalog-api", version: "v2" } },
          template: { metadata: { labels: { app: "catalog-api", version: "v2" } } },
        },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "6m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "catalog-api-5f6g7h-w8x9y", namespace: "catalog", labels: { app: "catalog-api", version: "v2" } },
        status: { phase: "Running", containerStatuses: [{ name: "catalog-api", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "5m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "catalog-api", namespace: "catalog" },
        spec: { type: "ClusterIP", clusterIP: "10.96.42.18", selector: { app: "catalog-api", version: "v1" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Endpoints",
        metadata: { name: "catalog-api", namespace: "catalog" },
        status: { subsets: [] },
        age: "1y",
        events: [
          { type: "Warning", reason: "NoEndpoints", age: "4m", message: "no matching pods for service catalog-api since 2026-09-15T09:50:00Z" },
        ],
      },
    ],
  },
  hints: [
    "`kubectl get endpoints catalog-api -n catalog` - any addresses listed since the new rollout finished?",
    "`kubectl get svc catalog-api -n catalog -o yaml` and `kubectl get deploy catalog-api -n catalog -o yaml` - compare the Service's `selector` against the Deployment's `template.metadata.labels`. Both changed recently, but did they change together?",
    "The Service was never touched as part of this deploy - only the Deployment's pod template labels changed. A Service's selector has to be updated in lockstep with any pod label change that affects it.",
  ],
  options: [
    {
      id: "service-selector-still-v1-pods-now-v2",
      label:
        "The rollout added `version: v2` to the pod template labels (and to the Deployment's own selector, to match), but the Service's selector was never updated and still requires `version: v1` - none of the new pods carry that label anymore, so the Service has had zero matching pods, and zero Endpoints, since the old v1 pods finished terminating.",
      explanation:
        "The Service's selector is `{app: catalog-api, version: v1}` while every current pod is labeled `{app: catalog-api, version: v2}` - the Endpoints object's own `NoEndpoints` event confirms zero matching pods since the moment the old pods disappeared. The Deployment itself is healthy with 4/4 ready pods; the mismatch is entirely in the now-stale Service selector, not anything wrong with the pods.",
    },
    {
      id: "deployment-rollout-actually-stuck",
      label: "The Deployment rollout is actually stuck partway and hasn't finished replacing all pods.",
      explanation:
        "The Deployment reports 4/4 ready, updated, and available replicas - the rollout completed successfully and cleanly. The problem is entirely downstream of the Deployment, in the Service's selector no longer matching the (successfully rolled out) new pods.",
    },
    {
      id: "targetport-changed-in-rollout",
      label: "The new v2 pods listen on a different container port than the Service expects.",
      explanation:
        "There's no indication the container's listening port changed as part of this rollout - only pod labels changed. And a port mismatch would still produce populated Endpoints with the wrong port, not a completely empty Endpoints object with zero matched pods.",
    },
    {
      id: "canary-ingress-misrouting",
      label: "A canary-related Ingress rule is misrouting all traffic away from the Service.",
      explanation:
        "No Ingress or canary traffic-splitting resource is involved in this failure - the Endpoints object itself is empty, meaning the Service has no pods to route to in the first place, which is a problem at the Service/pod-selection layer, not anything downstream at an Ingress.",
    },
  ],
  correctOptionId: "service-selector-still-v1-pods-now-v2",
  resolution: `The rollout updated the Deployment's pod template (and its own
\`spec.selector\`, which is immutable and had to match) to add
\`version: v2\`, in preparation for an upcoming canary setup. Nobody
updated the Service's selector to match - it's still pinned to
\`version: v1\`. As long as old v1 pods were still terminating, the Service
kept some matching Endpoints; the moment the last v1 pod finished
terminating, the Service's selector matched precisely zero pods, which
its own \`NoEndpoints\` event confirms happened right at that point. The
Deployment itself is perfectly healthy - this is purely a Service
selector left behind by a labeling change made only on the pod template
side.

The fix is updating the Service's selector to match the pods' current
labels:

\`\`\`yaml
spec:
  selector:
    app: catalog-api
    version: v2
\`\`\`

Longer-term, if a real canary setup (splitting traffic between v1 and v2)
is the actual goal, the Service's selector should key off just
\`app: catalog-api\` (matching both versions) with a separate mechanism -
like two Services behind a weighted Ingress, or a service mesh
VirtualService - actually handling the version split. Whenever a pod
template label used in a Service's selector changes, the Service itself
needs a coordinated update in the same change, not a follow-up fix after
the fact.`,
};
