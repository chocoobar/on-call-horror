import type { Scenario } from "../types";

export const sessionAffinityCookiePinnedToDeadPod: Scenario = {
  id: "session-affinity-cookie-pinned-to-dead-pod",
  title: "The Cookie That Pointed At A Ghost",
  subtitle: "logged-in users start getting 502s right after every deploy. new visitors never see it.",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["ingress", "session-affinity", "rollout"],
  briefing: `"shopping-cart-ui" uses sticky sessions at the Ingress layer so a user's
in-progress cart state, held in local pod memory, stays consistent across
requests. Every rolling deploy produces a wave of 502 errors for existing,
logged-in users over the following several minutes - brand-new visitors
starting a fresh session are never affected.`,
  constraints: [
    "Every new pod from the rollout passes its readiness checks immediately and serves fresh sessions without any issue.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shopping-cart-ui", namespace: "cart2", labels: { app: "shopping-cart-ui" } },
        spec: { replicas: 4, strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1, maxSurge: 1 } } },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "10m",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: "shopping-cart-ui",
          namespace: "cart2",
          annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "nginx.ingress.kubernetes.io/affinity": "cookie",
            "nginx.ingress.kubernetes.io/session-cookie-name": "CARTSESSION",
            "nginx.ingress.kubernetes.io/session-cookie-hash": "sha1",
          },
        },
        spec: { rules: [{ host: "cart.example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "shopping-cart-ui", port: { number: 80 } } } }] } }] },
        age: "1y",
        events: [
          { type: "Warning", reason: "UpstreamSendFailed", age: "8m", message: "upstream sent no valid HTTP/1.1 header while reading response header from upstream, upstream pinned by cookie to a pod no longer in endpoints" },
        ],
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sticky-session-notes", namespace: "cart2" },
        spec: {
          data: {
            "notes.md":
              "The nginx ingress controller's cookie-based session affinity encodes a\nhash identifying a specific backend pod directly into the session\ncookie, issued to the client on their first request. That cookie is\nself-contained and client-held - it has no awareness of the Ingress\ncontroller's own live Endpoints list, and nothing refreshes or\ninvalidates it when the pod it's pinned to is later terminated during a\nrolling update. A returning user's browser keeps presenting a cookie\npinning them to a pod that no longer exists for as long as that cookie\nremains unexpired (its own TTL is far longer than any single rollout),\nand every request they make fails until either the cookie expires, they\nclear it, or the ingress controller happens to fall back and re-pin them\nto a currently-live pod.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "Every new pod from the rollout is confirmed healthy and serving fresh sessions fine - so the 502s aren't about the new pods being broken, they're about something failing to *reach* them.",
    "The Ingress's own event log mentions a cookie pinning a request to a pod \"no longer in endpoints\" - what does the session cookie actually encode, and does it get updated when a pod is replaced?",
    "`kubectl get configmap sticky-session-notes -n cart2 -o yaml` - is the session cookie aware of the Ingress controller's live Endpoints list at all, or is it a static value issued once and held entirely client-side?",
  ],
  options: [
    {
      id: "sticky-cookie-pinned-to-terminated-pod",
      label:
        "nginx's cookie-based session affinity encodes a specific backend pod's identity directly into a client-held cookie issued on a user's first request - that cookie has no awareness of the Ingress controller's live Endpoints and never gets updated when the pinned pod is later replaced during a rolling update, so any returning user whose cookie points at a now-terminated pod gets a 502 on every request until the cookie expires or they're re-pinned, while brand-new visitors (who get a fresh cookie pinned to a currently-live pod) are never affected.",
      explanation:
        "The Ingress's own event describes this exactly: a cookie \"pinned by cookie to a pod no longer in endpoints.\" `sticky-session-notes` explains why this persists well past the rollout itself - the cookie is static, client-held, and has a TTL far longer than any single deploy, with nothing to invalidate or refresh it when its target pod is terminated. This matches the reported pattern precisely: existing, logged-in users (holding an old cookie) affected, brand-new visitors (getting a fresh cookie pinned to a live pod) unaffected, and the wave of errors correlating exactly with each rollout replacing pods those old cookies still reference.",
    },
    {
      id: "new-pods-not-actually-ready",
      label: "The new pods from the rollout aren't actually fully ready despite passing their readiness checks.",
      explanation:
        "Every new pod is confirmed to pass readiness checks immediately and serve fresh sessions without issue - the new pods themselves are genuinely healthy; the problem is specifically about requests being routed, via a stale cookie, to *old* pods that no longer exist, not about any deficiency in the new ones.",
    },
    {
      id: "ingress-controller-not-detecting-terminated-pods",
      label: "The ingress controller's own Endpoints watch is slow to notice when a pod terminates.",
      explanation:
        "The ingress controller's own event log shows it correctly identifying the problem - a cookie pinned to a pod that's no longer in its Endpoints list - meaning it *does* have an accurate, current view of which pods exist; the issue is the cookie itself referencing a pod that's genuinely gone, not the controller's own Endpoints tracking being stale or slow.",
    },
    {
      id: "loadbalancer-algorithm-misconfigured",
      label: "The Ingress's load-balancing algorithm is misconfigured and routing to terminated pods indiscriminately.",
      explanation:
        "This isn't a general load-balancing algorithm issue affecting arbitrary requests - it's specifically the cookie-based session affinity mechanism, by design, routing a *specific* returning user back to the *specific* pod their cookie was originally pinned to, which happens to no longer exist after a rollout; unaffected new sessions with no such cookie are routed normally.",
    },
  ],
  correctOptionId: "sticky-cookie-pinned-to-terminated-pod",
  resolution: `The Ingress's own event log states the mechanism directly: a cookie
"pinned by cookie to a pod no longer in endpoints." \`sticky-session-notes\`
explains why this outlives the rollout itself: nginx's cookie-based
session affinity encodes a specific backend pod's identity into a
client-held cookie at the moment it's first issued, with no built-in
awareness of the Ingress controller's live Endpoints list and no
mechanism to refresh or invalidate it when that pod is later replaced.
A returning user's browser keeps presenting the same cookie, pinning
every subsequent request to a pod that a rolling update has since
terminated, for as long as the cookie's own (much longer) TTL keeps it
valid - producing a 502 on every request until the cookie expires, gets
cleared, or the client happens to be re-pinned. Brand-new visitors, who
get a fresh cookie pinned to whichever pod is currently live, are never
affected - exactly matching the reported pattern.

The most direct mitigation is configuring the ingress controller to fall
back gracefully to a live pod when a session's originally-pinned target
is gone, rather than failing the request outright:

\`\`\`yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "CARTSESSION"
    nginx.ingress.kubernetes.io/session-cookie-hash: "sha1"
    nginx.ingress.kubernetes.io/upstream-fail-timeout: "0"
    nginx.ingress.kubernetes.io/session-cookie-change-on-failure: "true"
\`\`\`

\`session-cookie-change-on-failure\` re-pins the client to a new, live pod
transparently on a failed attempt rather than repeatedly failing against
the same dead target. The deeper structural fix, if feasible, is moving
in-progress cart state out of pod-local memory entirely (into a shared
store like Redis) so session affinity becomes a performance optimization
rather than a hard correctness requirement - removing the failure mode
altogether rather than just mitigating it.`,
};
