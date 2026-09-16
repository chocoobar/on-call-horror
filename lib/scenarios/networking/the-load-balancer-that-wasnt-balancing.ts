import type { Scenario } from "../types";

export const theLoadBalancerThatWasntBalancing: Scenario = {
  id: "the-load-balancer-that-wasnt-balancing",
  title: "The Load Balancer That Wasn't Balancing",
  subtitle: "one search-web pod is pegged at 100% CPU while its three siblings sit idle",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["kubernetes", "load-balancing", "sessions"],
  briefing: `"search-web" runs 4 replicas behind a single Service specifically so no
one pod ever has to handle a disproportionate share of traffic. Right now
one specific pod is maxed out and slow, while the other three are close
to idle - and it's been the same one pod all morning, through several
scale-related restarts of the others.`,
  constraints: [
    "Total traffic volume across all users is well within what four pods should handle comfortably if it were actually spread evenly - this isn't an overall capacity problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "search-web", namespace: "search", labels: { app: "search-web" } },
        spec: { type: "ClusterIP", selector: { app: "search-web" }, sessionAffinity: "ClientIP", ports: [{ port: 80 }] },
        age: "1y",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-web", namespace: "search", labels: { app: "search-web" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-web-traffic-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "`sessionAffinity: ClientIP` was added 8 months ago for a feature that\nneeded a user's search session to stick to one backend pod for a few\nminutes at a time. That feature was removed 3 months ago; the\nsessionAffinity setting on the Service was never reverted.\n\nA large fraction of search-web's traffic comes from users behind one\ncorporate network's NAT gateway, which means a large fraction of\nrequests all present the exact same source IP address to the Service.\n",
          },
        },
        age: "8mo",
      },
    ],
  },
  hints: [
    "`kubectl get service search-web -n search -o yaml` - look at `spec.sessionAffinity`. What does `ClientIP` affinity actually key on?",
    "`kubectl get configmap search-web-traffic-notes -n search -o yaml` - was this setting added for a reason that still applies today?",
    "`ClientIP` session affinity pins all traffic from one source IP to the same backend pod for the affinity's duration. What happens when a large number of distinct real users all happen to share one visible source IP, like behind a corporate NAT?",
  ],
  options: [
    {
      id: "session-affinity-pins-nat-users-to-one-pod",
      label:
        "The Service still has `sessionAffinity: ClientIP` left over from a feature removed three months ago - it pins all traffic from a given source IP to the same backend pod, and since a large share of real, distinct users sit behind one corporate NAT gateway sharing a single visible IP, all of their traffic gets pinned to the exact same one pod regardless of how many replicas exist, while everyone else's traffic (each with their own distinct IP) spreads normally across the rest.",
      explanation:
        "`search-web-traffic-notes` confirms `sessionAffinity: ClientIP` was added for a feature that no longer exists and was never removed, and separately confirms a large fraction of real users share one corporate NAT's visible IP. `ClientIP` affinity works exactly as designed here - it just wasn't designed with 'many distinct users appearing as one IP' in mind. Every one of those users' requests gets routed to the same single pod for the affinity's duration, which is exactly the kind of one-pod-overloaded/three-pods-idle pattern that's persisted through restarts of the *other* pods (since the overloaded pod itself, and the affinity pinning traffic to it, never changed).",
    },
    {
      id: "one-pod-has-hot-cache",
      label: "One pod happens to have a 'hot' in-memory cache that's making it slightly faster, attracting more retries.",
      explanation:
        "A performance difference attracting more *retries* would be a self-correcting or at least gradually shifting pattern, not a fixed, sustained assignment surviving multiple restarts of the other pods - the described pattern points at something structurally routing specific traffic to one specific pod, not an emergent preference from client-side retry behavior.",
    },
    {
      id: "readiness-probe-failing-on-other-pods",
      label: "The other three pods are intermittently failing their readiness probes.",
      explanation:
        "All four pods are confirmed `Ready` and `Available` in the Deployment's status the entire time - readiness isn't in question for any of them; the issue is how traffic gets distributed among four pods that are all equally eligible to receive it.",
    },
    {
      id: "dns-resolving-to-single-pod-ip",
      label: "DNS for the Service is resolving to a single pod's IP instead of the Service's ClusterIP.",
      explanation:
        "Clients connect to the Service's stable ClusterIP, which then load-balances across backend pods at the kube-proxy layer - a client-side DNS issue wouldn't explain kube-proxy itself consistently routing to the same backend pod for a specific, identifiable subset of traffic.",
    },
  ],
  correctOptionId: "session-affinity-pins-nat-users-to-one-pod",
  resolution: `\`search-web-traffic-notes\` explains both halves of this: \`sessionAffinity:
ClientIP\` was added eight months ago for a feature that needed a user's
session to stick to one backend for a few minutes, and was never removed
after that feature was retired three months ago. \`ClientIP\` affinity does
exactly what its name says - it routes every request from a given source
IP to the same backend pod, for as long as the affinity window lasts.
That's a reasonable mechanism when "one IP" reliably means "one user." It
falls apart the moment a large number of genuinely distinct users all
present the same source IP, which is exactly what happens behind a
corporate NAT gateway - every one of those users' independent traffic
gets treated as a single "client" and pinned to a single pod, while
traffic from users with their own distinct IPs spreads normally across
the rest. That's precisely the lopsided pattern observed: one pod
absorbing a disproportionate, sustained share of real traffic while the
others idle, persisting through unrelated restarts because neither the
NAT'd users' shared IP nor the stale affinity setting ever changed.

The fix is removing the now-unnecessary affinity setting, since the
feature that needed it is gone:

\`\`\`yaml
spec:
  sessionAffinity: None
\`\`\`

With affinity removed, kube-proxy distributes traffic across all four
pods using its normal load-balancing behavior, regardless of how many
distinct users happen to share a visible source IP. If a future feature
genuinely needs session stickiness again, it's worth implementing at the
application or ingress layer with a proper session token or cookie
instead of client IP, which breaks down for exactly this reason any time
a meaningful share of users sit behind shared NAT.`,
};
