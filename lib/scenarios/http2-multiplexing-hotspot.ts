import type { Scenario } from "./types";

export const http2MultiplexingHotspot: Scenario = {
  id: "http2-multiplexing-hotspot",
  title: "The HTTP/2 Connection That Wouldn't Spread Out",
  subtitle: "five pods, one of them pinned at 90% CPU, four of them idling",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["http2", "load-balancing", "connection-pooling"],
  briefing: `"recommendation-api" runs 5 replicas behind a ClusterIP Service. One
particular caller, "product-page-renderer," drives the overwhelming
majority of recommendation-api's total traffic. Every time
product-page-renderer's own pods restart, load across recommendation-api's
5 pods rebalances briefly and evenly - then within minutes, it always
concentrates back onto just one or two of them.`,
  constraints: [
    "recommendation-api's Service and Endpoints are confirmed to list and correctly load-balance across all 5 healthy pods.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "recommendation-api", namespace: "recs2", labels: { app: "recommendation-api" } },
        spec: { replicas: 5 },
        status: { readyReplicas: 5, updatedReplicas: 5, availableReplicas: 5 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "recommendation-api", namespace: "recs2" },
        spec: { type: "ClusterIP", clusterIP: "10.96.44.8", selector: { app: "recommendation-api" }, ports: [{ port: 443, targetPort: 8443 }] },
        age: "6mo",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "product-page-renderer", namespace: "web2", labels: { app: "product-page-renderer" } },
        spec: { replicas: 3 },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "grpc-client-notes", namespace: "web2" },
        spec: {
          data: {
            "notes.md":
              "product-page-renderer calls recommendation-api over HTTP/2 (gRPC),\nusing a client library that opens a single, long-lived HTTP/2 connection\nper target and multiplexes every request over it via HTTP/2 streams,\nrather than opening a new TCP connection per request. Kubernetes'\nClusterIP Service load-balancing (via kube-proxy) operates at the\nconnection level, picking a single backend pod when a *new* connection\nis established - it has no visibility into, or ability to redistribute,\nindividual multiplexed streams within a connection that's already open.\nOnce each of product-page-renderer's 3 pods opens its one long-lived\nHTTP/2 connection to recommendation-api (landing on 1-3 of the 5 pods\ntotal, essentially at random), every request from that pod for the\nconnection's entire lifetime goes to that same single backend pod,\nregardless of how many separate logical requests are multiplexed through\nit.\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "recommendation-api's own Service and Endpoints are confirmed to correctly include and balance across all 5 pods - so the imbalance isn't happening at that layer.",
    "product-page-renderer calls recommendation-api over HTTP/2 (gRPC) - how many separate TCP connections does an HTTP/2 client typically open per target?",
    "`kubectl get configmap grpc-client-notes -n web2 -o yaml` - kube-proxy load-balances *connections*, not individual requests within a connection. What does that mean for an HTTP/2 client multiplexing many requests over one long-lived connection?",
  ],
  options: [
    {
      id: "http2-single-connection-pinned-per-pod",
      label:
        "product-page-renderer's HTTP/2 (gRPC) client opens one long-lived connection per pod and multiplexes every request through it via HTTP/2 streams, rather than opening a new connection per request - kube-proxy's Service load-balancing only picks a backend when a *new* connection is established, so once each of product-page-renderer's 3 pods lands its one connection on some subset of recommendation-api's 5 pods, every request from that pod goes to that same backend for the connection's entire lifetime, concentrating load onto whichever few pods happened to get picked, regardless of the Service correctly listing and being able to balance across all 5.",
      explanation:
        "`grpc-client-notes` explains the mechanism precisely: HTTP/2 multiplexes many logical requests over one physical TCP connection, and Kubernetes Service load balancing operates strictly at the connection level - it has no concept of, or ability to redistribute, individual streams within an already-open connection. With only 3 caller pods each opening one long-lived connection, at most 3 of recommendation-api's 5 pods ever receive traffic at a time, and the brief post-restart rebalancing (when new connections are established fresh) followed by re-concentration onto a few pods matches this exactly.",
    },
    {
      id: "recommendation-api-pods-unequal-resources",
      label: "One or two of recommendation-api's pods have more CPU allocated than the others, naturally attracting more load.",
      explanation:
        "All 5 replicas are part of the same Deployment with identical resource requests and limits - there's no per-pod resource disparity, and the imbalance pattern (rebalancing briefly after the caller restarts, then re-concentrating) points at connection-level pinning rather than any capacity-driven routing preference.",
    },
    {
      id: "service-selector-flaky",
      label: "recommendation-api's Service selector is intermittently only matching a subset of pods.",
      explanation:
        "The Service and Endpoints are confirmed to consistently list and be able to balance across all 5 healthy pods at all times - the selector itself isn't flaky or incomplete; the issue is that established HTTP/2 connections aren't redistributed once made, regardless of how many pods the Service correctly knows about.",
    },
    {
      id: "dns-caching-single-pod-ip",
      label: "product-page-renderer's DNS resolution is caching a single pod IP instead of the Service's ClusterIP.",
      explanation:
        "product-page-renderer connects to the Service's stable ClusterIP, not to individual pod IPs directly - DNS caching behavior for the Service's own address has no bearing on which specific backend pod kube-proxy routes an established connection to, which is determined at connection-establishment time regardless of DNS.",
    },
  ],
  correctOptionId: "http2-single-connection-pinned-per-pod",
  resolution: `\`grpc-client-notes\` explains the mechanism directly: product-page-
renderer's gRPC client, built on HTTP/2, opens a single long-lived
connection per target and multiplexes every logical request over it as
HTTP/2 streams, rather than opening a fresh TCP connection per request.
Kubernetes Service load balancing, implemented by kube-proxy, operates
purely at the connection level - it picks a backend pod when a *new*
connection is established and has no mechanism to redistribute traffic
within a connection that's already open, no matter how many requests get
multiplexed through it. With only 3 caller pods, each opening one
connection, at most 3 of recommendation-api's 5 pods ever receive any
traffic at a given time - and whichever pods those connections happened
to land on absorb the caller's entire request volume for as long as the
connection stays open, which is exactly why a caller restart (forcing
fresh connections, and a fresh, even-ish random distribution) briefly
rebalances things before they re-concentrate.

The standard fix is client-side load balancing designed for HTTP/2,
rather than relying on Kubernetes Service-level connection balancing at
all - either a gRPC-aware client-side LB policy backed by DNS-based
endpoint discovery, or routing through a proxy that understands HTTP/2
streams individually (like Envoy or Linkerd) rather than through a plain
ClusterIP Service:

\`\`\`yaml
# grpc client config (example, e.g. grpc-go or grpc-java)
grpc.service_config: |
  {"loadBalancingConfig": [{"round_robin": {}}]}
# paired with a headless Service so DNS returns every pod IP
# for the client's own connection-per-pod round robin
\`\`\`

This is a well-known gap for any gRPC/HTTP/2 service behind a plain L4
Kubernetes Service - connection-level load balancing and stream-level
multiplexing are fundamentally mismatched, and the fix always involves
either client-side awareness of individual backends or a proxy layer
that operates above the connection level.`,
};
