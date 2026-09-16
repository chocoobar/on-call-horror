import type { Scenario } from "../types";

export const serviceSelectorLabelTypo: Scenario = {
  id: "service-selector-label-typo",
  title: "The Selector With A Typo",
  subtitle: "recommendation-engine's pods are all green. its Service has never routed a single request.",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["service", "endpoints", "labels"],
  briefing: `"recommendation-engine" just shipped for the first time. Every pod is
Running and passing readiness checks. Every caller trying to reach it via
its Service gets an immediate connection refused, as if nothing is
listening on the other end at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-engine", namespace: "recs", labels: { app: "recommendation-engine" } },
        spec: { replicas: 3, selector: { matchLabels: { app: "recommendation-engine" } }, template: { metadata: { labels: { app: "recommendation-engine" } } } },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "recommendation-engine-8b7c6d-r5s6t", namespace: "recs", labels: { app: "recommendation-engine" } },
        status: { phase: "Running", containerStatuses: [{ name: "recommendation-engine", ready: true, restartCount: 0, state: { running: {} } }] },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "recommendation-engine", namespace: "recs" },
        spec: { type: "ClusterIP", clusterIP: "10.96.77.9", selector: { app: "recommendation-egine" }, ports: [{ port: 80, targetPort: 8080 }] },
        age: "25m",
      },
      {
        apiVersion: "v1",
        kind: "Endpoints",
        metadata: { name: "recommendation-engine", namespace: "recs" },
        status: { subsets: [] },
        age: "25m",
      },
    ],
  },
  hints: [
    "`kubectl get endpoints recommendation-engine -n recs` - how many addresses does it list?",
    "`kubectl get svc recommendation-engine -n recs -o yaml` and compare `spec.selector` against the Deployment's pod template labels character by character.",
    "An empty Endpoints object with healthy, Running, Ready pods elsewhere in the same namespace almost always means the Service's selector simply doesn't match the pods' actual labels.",
  ],
  options: [
    {
      id: "selector-typo-egine",
      label:
        "The Service's selector is `app: recommendation-egine` (missing the 'n' in 'engine') while the pods are labeled `app: recommendation-engine` - the typo means the selector never matches any pod, so the Service has no Endpoints at all and every connection to it is refused before it reaches any pod.",
      explanation:
        "Comparing the Service's `spec.selector` (`recommendation-egine`) against the pods' actual label (`recommendation-engine`) character by character shows a one-letter typo. Since Kubernetes label selectors require exact matches, this Service selects zero pods - confirmed by its empty `Endpoints` object - which is exactly why every pod is healthy on its own but the Service can't route to any of them.",
    },
    {
      id: "readiness-probe-not-actually-passing",
      label: "The pods' readiness probes aren't actually passing despite showing Running status.",
      explanation:
        "The Deployment shows 3/3 ready replicas and each pod's container status reports `ready: true` - readiness is confirmed working correctly. An Endpoints object stays empty regardless of readiness if the Service's selector doesn't match any pod's labels in the first place, which is the case here.",
    },
    {
      id: "wrong-target-port",
      label: "The Service's `targetPort` doesn't match the port the container actually listens on.",
      explanation:
        "A `targetPort` mismatch would still produce populated Endpoints (pod IPs would be listed, just with the wrong port) resulting in connection refused only after a pod is actually targeted - here the Endpoints object is completely empty, meaning no pod was ever selected as a target at all.",
    },
    {
      id: "namespace-mismatch",
      label: "The Service and Deployment are actually in different namespaces.",
      explanation:
        "Both the Service and the Deployment are defined in the `recs` namespace - a Service can only select pods within its own namespace, and that's already the case here, so a cross-namespace mismatch isn't the issue.",
    },
  ],
  correctOptionId: "selector-typo-egine",
  resolution: `The Service's selector reads \`app: recommendation-egine\` - missing the
'n' in "engine" - while every pod carries the label
\`app: recommendation-engine\`, applied consistently via the Deployment's
pod template. Kubernetes label selectors require an exact string match,
so this one-character typo means the Service matches zero pods, which is
exactly why its \`Endpoints\` object is empty despite three healthy,
Running, Ready pods sitting right there in the same namespace. Anything
connecting to the Service gets refused immediately, because there's
nothing listed to route to at all.

The fix is correcting the selector to match the pods' real label:

\`\`\`yaml
spec:
  selector:
    app: recommendation-engine
  ports:
    - port: 80
      targetPort: 8080
\`\`\`

Once the selector matches, the Endpoints controller picks up the pods'
IPs automatically within seconds - no pod restart needed. A Service with
healthy pods elsewhere in the namespace but an empty \`Endpoints\` object
is one of the most common "everything looks fine but nothing works" signs
in Kubernetes, and it's almost always a selector/label mismatch like this
one.`,
};
