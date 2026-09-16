import type { Scenario } from "./types";

export const theAnnotationThatNeededAControllerRestart: Scenario = {
  id: "the-annotation-that-needed-a-controller-restart",
  title: "The Annotation That Needed A Restart",
  subtitle: "a brand-new global setting, correctly written, silently ignored by half the fleet",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["ingress", "nginx", "configmap"],
  briefing: `Platform enabled a cluster-wide nginx ingress controller setting -
increasing the global client request body size limit - by editing the
ingress controller's own ConfigMap directly, to fix upload failures
across several teams' services at once. Roughly half of all Ingress
objects in the cluster picked up the new, larger limit immediately.
The other half are still enforcing the old, smaller one.`,
  constraints: [
    "Every affected Ingress, both working and not, uses the exact same ingress class and is served by the exact same ingress controller Deployment.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ingress-nginx-controller", namespace: "ingress-nginx" },
        spec: { data: { "proxy-body-size": "50m" } },
        age: "2h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ingress-nginx-controller", namespace: "ingress-nginx", labels: { app: "ingress-nginx" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ingress-nginx-controller-1a2b3c-d4e5f", namespace: "ingress-nginx", labels: { app: "ingress-nginx" } },
        status: { phase: "Running", containerStatuses: [{ name: "controller", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-13T08:00:00Z" } } }] },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "ingress-nginx-controller-1a2b3c-g6h7i", namespace: "ingress-nginx", labels: { app: "ingress-nginx" } },
        status: { phase: "Running", containerStatuses: [{ name: "controller", ready: true, restartCount: 0, state: { running: { startedAt: "2026-09-15T10:00:00Z" } } }] },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "ingress-nginx-reload-notes", namespace: "ingress-nginx" },
        spec: {
          data: {
            "notes.md":
              "The ingress-nginx controller Deployment runs 4 replicas behind a\nregular Kubernetes Service, load-balanced by the cloud LB across all of\nthem equally. Most ConfigMap-level global settings (like\n`proxy-body-size`) are picked up via a live reload triggered by the\ncontroller's own ConfigMap watch - but this specific ingress-nginx\nversion has a documented quirk where a *subset* of global directives,\nincluding `proxy-body-size` when set at the ConfigMap level (as opposed\nto per-Ingress annotation), require a full worker process reload to\ntake effect, which the live ConfigMap watch's reload signal does not\nreliably trigger on already-running, older worker processes - only\nnewly-started controller pods pick up the new value cleanly from a fresh\nstart. Of the 4 controller replicas, 2 have been running since well\nbefore the ConfigMap change and never got a clean reload; the other 2\nwere restarted afterward for an unrelated reason and picked up the new\nvalue immediately on startup.\n",
          },
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "Every affected Ingress uses the identical ingress class and shares the identical controller Deployment - so if some work and some don't, what varies *within* that one Deployment?",
    "`kubectl get pods -n ingress-nginx -o wide` and check each pod's start time relative to when the ConfigMap was changed 2 hours ago.",
    "`kubectl get configmap ingress-nginx-reload-notes -n ingress-nginx -o yaml` - does every kind of ConfigMap-level change to this ingress controller apply via a live, in-place reload, or does some subset need a fresh process start?",
  ],
  options: [
    {
      id: "some-controller-replicas-never-reloaded-old-setting",
      label:
        "This ingress-nginx version has a documented quirk where certain ConfigMap-level global directives, including `proxy-body-size`, need a full worker process restart to take effect - the live ConfigMap watch reload doesn't reliably apply them to already-running worker processes; of the 4 controller replicas, the 2 that have been running since before the change never picked up the new value, while the 2 restarted afterward for an unrelated reason picked it up immediately on startup, so which replica the cloud load balancer happens to route a given request to determines whether the new, larger limit applies.",
      explanation:
        "`ingress-nginx-reload-notes` documents the exact quirk and its consequence, and the pod list confirms it: 2 replicas have been running since well before the 2-hour-old ConfigMap change, and 2 started afterward. Since every Ingress is served identically by whichever of the 4 replicas happens to handle a given request, and only the freshly-started replicas actually picked up the new `proxy-body-size` value, roughly half of all traffic (and therefore roughly half of Ingress objects' worth of requests, depending on routing) would see the old, smaller limit still enforced - exactly the reported split.",
    },
    {
      id: "some-ingresses-have-their-own-override-annotation",
      label: "The unaffected Ingress objects have their own per-Ingress `proxy-body-size` annotation overriding the ConfigMap's global value.",
      explanation:
        "The affected and unaffected sets both share the exact same ingress class and controller, and the described split correlates with which controller *pod* handles the request, not with any per-Ingress-object configuration difference - if per-Ingress overrides were the cause, the pattern would be tied to which Ingress objects have an annotation, not which controller replica happened to serve the request.",
    },
    {
      id: "coredns-caching-old-controller-config",
      label: "CoreDNS is serving stale cached responses for the ingress controller's Service, splitting traffic inconsistently.",
      explanation:
        "DNS resolution for the ingress controller's Service address has no bearing on which specific backend controller pod ultimately handles a given HTTP request, nor on which worker-process-level configuration that pod is running with - this is an application-layer (nginx worker reload) issue, not a DNS-layer one.",
    },
    {
      id: "configmap-change-not-saved-correctly",
      label: "The ConfigMap edit itself wasn't saved or applied correctly and is inconsistent across the cluster.",
      explanation:
        "A ConfigMap is a single, consistent object in the Kubernetes API - there's no mechanism by which different pods would see different content for the same, already-applied ConfigMap. The inconsistency is in whether each already-running controller *process* has actually reloaded and applied that (uniformly correct) ConfigMap content, not in the ConfigMap itself varying.",
    },
  ],
  correctOptionId: "some-controller-replicas-never-reloaded-old-setting",
  resolution: `\`ingress-nginx-reload-notes\` documents the exact quirk in this ingress-
nginx version: while most ConfigMap-level settings apply via a live
reload triggered by the controller's own ConfigMap watch, a subset of
global directives - including \`proxy-body-size\` set at the ConfigMap
level - require a full nginx worker process restart to actually take
effect, which the live reload signal doesn't reliably trigger on
already-running worker processes. The pod list confirms the split
directly: 2 of the 4 controller replicas have been running continuously
since well before the ConfigMap change 2 hours ago and never picked up
the new value, while the other 2, restarted afterward for an unrelated
reason, picked it up cleanly on startup. Since every Ingress object in
the cluster is served identically by whichever of the 4 replicas happens
to handle a given request (the cloud load balancer spreads traffic
across all of them), roughly half of all traffic still hits the old,
smaller limit - not tied to which Ingress object is involved at all, but
to which controller pod happens to answer.

The fix is a rolling restart of the ingress controller Deployment, so
every replica picks up the new ConfigMap value from a fresh start:

\`\`\`bash
kubectl rollout restart deployment ingress-nginx-controller -n ingress-nginx
kubectl rollout status deployment ingress-nginx-controller -n ingress-nginx
\`\`\`

For any ingress-nginx version known to have this class of ConfigMap
directive that needs a full reload rather than a live one, it's worth
making a rolling restart a standard, explicit step after any global
ConfigMap change - rather than assuming the controller's own live-reload
watch handles every kind of setting uniformly, which this version
specifically does not.`,
};
