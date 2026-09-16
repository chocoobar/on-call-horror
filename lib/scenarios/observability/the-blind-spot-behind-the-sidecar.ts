import type { Scenario } from "../types";

export const theBlindSpotBehindTheSidecar: Scenario = {
  id: "the-blind-spot-behind-the-sidecar",
  title: "The Blind Spot Behind the Sidecar",
  subtitle: "wallet-api shows as a Prometheus scrape target \"down\", but the app is fine",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["prometheus", "service-mesh", "mtls"],
  briefing: `Right after "wallet-api" was onboarded onto the service mesh (a sidecar
proxy injected into every pod for mTLS between services), its Prometheus
target started showing "down" - scrape failing. The application itself is
completely healthy: no errors, normal traffic, normal latency.`,
  constraints: [
    "wallet-api's own /actuator/prometheus endpoint has been confirmed to work and return valid metrics when queried directly from inside the pod's network namespace - the application side is not the problem.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "wallet-api", namespace: "wallet", labels: { app: "wallet-api" } },
        spec: {
          replicas: 3,
          template: { metadata: { annotations: { "sidecar.istio.io/inject": "true" } }, spec: { containers: [{ name: "wallet-api", image: "registry.internal/wallet-api:8.0.0" }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "1d",
      },
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: { name: "wallet-api", namespace: "wallet" },
        spec: {
          selector: { matchLabels: { app: "wallet-api" } },
          endpoints: [{ port: "http", interval: "30s", path: "/actuator/prometheus" }],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "mesh-onboarding-notes", namespace: "wallet" },
        spec: {
          data: {
            "notes.md":
              "wallet-api's namespace was added to the service mesh yesterday with\nmesh-wide `PeerAuthentication` set to `STRICT` mTLS - every pod in a\nmeshed namespace gets a sidecar proxy that transparently intercepts all\ninbound and outbound traffic via iptables rules, and requires mTLS for\nany inbound connection by default. Prometheus, which lives outside the\nmesh, scrapes pods directly over plain HTTP by IP address - exactly the\nkind of inbound connection STRICT mTLS now rejects unless the scrape\ntraffic is either exempted or itself brought into the mesh.\n",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get configmap mesh-onboarding-notes -n wallet -o yaml` - what changed for this namespace yesterday, and what does it say about how inbound connections to pods are now handled?",
    "The sidecar proxy intercepts *all* inbound traffic to the pod, including a Prometheus scrape - that's the mesh working as designed for actual application traffic. What happens when a scraper outside the mesh tries to connect the old way, in plain HTTP, to a pod that now requires mTLS for anything coming in?",
    "The problem isn't wallet-api's metrics endpoint at all - confirmed working from inside the pod's own network namespace. Something is intercepting or rejecting the connection *before* it reaches the application, at the mesh sidecar's layer.",
  ],
  options: [
    {
      id: "strict-mtls-blocks-plaintext-scrape",
      label:
        "The namespace's mesh-wide `PeerAuthentication` is `STRICT`, which requires mTLS for any inbound connection to a meshed pod - Prometheus, running outside the mesh, still tries to scrape over plain HTTP the same way it always has, and the sidecar proxy now intercepts and rejects that plaintext connection before it ever reaches the application's actual metrics endpoint.",
      explanation:
        "`mesh-onboarding-notes` confirms STRICT mTLS went into effect for this namespace yesterday - exactly when the scrape started failing - and explains that every pod's sidecar transparently intercepts all inbound traffic, requiring mTLS by default. Prometheus, outside the mesh, has no way to present a mesh-issued client certificate and is still connecting exactly the way it always did: plain HTTP, direct to the pod IP. The application's own metrics endpoint is confirmed healthy when queried from inside the pod's own network namespace (bypassing the sidecar's inbound interception entirely) - the rejection is happening at the mesh layer, in front of the app, not within it.",
    },
    {
      id: "servicemonitor-selector-wrong",
      label: "The ServiceMonitor's label selector doesn't match wallet-api's pods.",
      explanation:
        "The ServiceMonitor's `matchLabels: { app: wallet-api }` correctly matches the Deployment's pod labels, and this setup was working fine before yesterday's mesh onboarding - the selector itself hasn't changed and isn't the new variable introduced.",
    },
    {
      id: "actuator-endpoint-changed",
      label: "wallet-api's `/actuator/prometheus` endpoint path or port changed in a recent release.",
      explanation:
        "The endpoint is explicitly confirmed to return valid metrics when queried directly from inside the pod - there's no indication the path, port, or endpoint configuration itself is wrong, only that something outside the application is preventing the connection from arriving there via the network at all.",
    },
    {
      id: "prometheus-scrape-timeout-too-short",
      label: "The scrape timeout is too short for wallet-api to respond in time.",
      explanation:
        "A slow response would typically show up as an intermittent or partial scrape failure with a timeout-specific error - the described symptom is a clean, total \"down\" status starting precisely at the moment mTLS enforcement began, which points at the connection being actively rejected, not merely slow.",
    },
  ],
  correctOptionId: "strict-mtls-blocks-plaintext-scrape",
  resolution: `\`mesh-onboarding-notes\` pins the timing and the mechanism together:
STRICT mTLS went into effect for this namespace yesterday, the same day
the scrape started failing. Every pod in a meshed namespace gets a
sidecar proxy that transparently intercepts all inbound traffic via
iptables, and STRICT mode requires mTLS for any inbound connection by
default - with no exception carved out for anything, including a
monitoring scraper. Prometheus lives outside the mesh and has no mesh
identity or certificate; it's still connecting to pods exactly the way it
always has, plain HTTP straight to the pod IP. The sidecar now intercepts
that connection and rejects it before it ever reaches the application,
which is exactly consistent with the metrics endpoint working perfectly
when confirmed from inside the pod's own network namespace (bypassing
the sidecar's inbound interception) while looking completely "down" from
Prometheus's perspective outside the mesh.

There are two standard ways to fix this, and the right one depends on the
mesh: either exempt the metrics port from mTLS enforcement specifically
(most meshes support a per-port exception for scraping), or route the
scrape itself through the sidecar so it participates in mTLS properly:

\`\`\`yaml
# Istio: exempt the metrics port from mTLS via PeerAuthentication
spec:
  selector:
    matchLabels: { app: wallet-api }
  portLevelMtls:
    9464:
      mode: PERMISSIVE
\`\`\`

(Istio's own Prometheus-scraping documentation also covers annotating
pods so the sidecar's own merged metrics endpoint handles this
automatically in many setups.) Either way, onboarding a namespace onto a
mesh with strict mTLS needs to explicitly account for anything outside
the mesh that still needs to reach into it - monitoring scrapers being
the most common one to get silently cut off.`,
};
