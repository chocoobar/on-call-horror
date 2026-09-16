import type { Scenario } from "./types";

export const sidecarRewritesHostHeader: Scenario = {
  id: "sidecar-rewrites-host-header",
  title: "The Sidecar That Rewrote The Host Header",
  subtitle: "one virtual host behind a shared proxy gets someone else's site every time",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["sidecar", "host-header", "virtual-hosting"],
  briefing: `"marketing-site" and "docs-site" share a single backend server process
behind name-based virtual hosting, each served from a different Host
header on the same port. Since a caching sidecar was added in front of
both for performance, requests for docs-site have started returning
marketing-site's content instead - every single time, for every visitor.`,
  constraints: [
    "The shared backend server itself is confirmed to correctly serve docs-site's content when queried directly with the correct Host header, bypassing the new sidecar.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "web-backend", namespace: "web3", labels: { app: "web-backend" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "web-backend" }, { name: "cache-sidecar", image: "registry.internal/edge-cache:3.2.0" }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cache-sidecar-config", namespace: "web3" },
        spec: {
          data: {
            "cache.conf": "upstream backend {\n    server 127.0.0.1:8080;\n}\nserver {\n    listen 8443 ssl;\n    location / {\n        proxy_pass http://backend;\n        proxy_set_header Host marketing-site.example.com;\n    }\n}\n",
          },
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "sidecar-config-history-notes", namespace: "web3" },
        spec: {
          data: {
            "notes.md":
              "The cache sidecar's config was copied and adapted from another\nproject's single-site caching setup, which hardcoded\n`proxy_set_header Host marketing-site.example.com` as part of its\noriginal, single-virtual-host use case. That line overrides *every*\nincoming request's original Host header with that one fixed value\nbefore forwarding to the shared backend - regardless of what hostname\nthe visitor actually requested. Since the backend uses the Host header\nalone to decide which virtual host's content to serve, every request\npassing through this sidecar now always resolves to marketing-site's\ncontent, including requests that arrived for docs-site.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "The backend correctly serves docs-site's content when queried directly, bypassing the sidecar - so whatever's wrong is specific to what the sidecar sends onward.",
    "`kubectl get configmap cache-sidecar-config -n web3 -o yaml` - does the sidecar's proxy config do anything to the Host header before forwarding the request to the backend?",
    "The shared backend uses the Host header to decide which virtual site to serve - if something hardcodes that header to a fixed value regardless of the original request, every site behind it would resolve to whatever that fixed value points to.",
  ],
  options: [
    {
      id: "hardcoded-host-header-override-in-sidecar",
      label:
        "The cache sidecar's config has `proxy_set_header Host marketing-site.example.com` hardcoded, a leftover from an unrelated single-site caching setup it was copied from - this unconditionally overwrites the Host header on *every* request passing through the sidecar, regardless of which hostname the visitor originally requested, so the shared backend (which relies entirely on the Host header for virtual-host selection) always serves marketing-site's content, including for every request actually meant for docs-site.",
      explanation:
        "`sidecar-config-history-notes` and the sidecar's own config confirm this directly: `proxy_set_header Host marketing-site.example.com` is a fixed, unconditional override with no logic to preserve or pass through the original request's Host header. The backend is confirmed to work correctly when queried directly with the right Host header - proving the backend's own virtual-hosting logic is fine - which isolates the problem entirely to the sidecar rewriting every request's Host header to the same fixed value before it ever reaches the backend.",
    },
    {
      id: "backend-virtual-host-config-broken",
      label: "The shared backend's own virtual-host configuration has a bug routing docs-site requests to marketing-site's content.",
      explanation:
        "The backend is confirmed to correctly serve docs-site's own content when queried directly with the correct Host header, bypassing the sidecar entirely - its virtual-hosting logic is working fine on its own; the problem is specifically introduced by what the sidecar forwards to it.",
    },
    {
      id: "dns-resolving-docs-site-to-marketing-ip",
      label: "DNS for docs-site.example.com is resolving to marketing-site's IP address.",
      explanation:
        "Both sites share the exact same backend IP/Service by design (that's the whole point of name-based virtual hosting on shared infrastructure) - a DNS resolution difference wouldn't be relevant here, since the connection reaching the correct shared infrastructure was never in question; what content gets served once it arrives is determined entirely by the Host header.",
    },
    {
      id: "tls-sni-certificate-mismatch",
      label: "A TLS SNI certificate mismatch is causing requests to be routed to the wrong virtual host at the TLS layer.",
      explanation:
        "This is an HTTP-layer Host header issue occurring after TLS termination, not a TLS/SNI-layer routing problem - the constraint confirms the backend correctly serves the right content once it receives the right Host header, meaning the connection and TLS handshake are succeeding fine; only the HTTP Host header being forwarded is wrong.",
    },
  ],
  correctOptionId: "hardcoded-host-header-override-in-sidecar",
  resolution: `\`sidecar-config-history-notes\` and the sidecar's own configuration confirm
the cause directly: \`proxy_set_header Host marketing-site.example.com\` is
a hardcoded, unconditional override, carried over from a different,
single-site caching setup this config was originally copied from. It
rewrites the Host header on *every* request passing through the sidecar
to that one fixed value, regardless of what hostname the visitor
actually requested. Since the shared backend relies entirely on the Host
header to decide which virtual host's content to serve, every request
funneled through the sidecar - docs-site included - now resolves to
marketing-site's content. The backend itself is confirmed correct when
bypassed and queried directly with the right header, isolating the fault
entirely to this one hardcoded line in the sidecar's proxy config.

The fix is removing the hardcoded override so the sidecar passes through
each request's original Host header unmodified:

\`\`\`nginx
server {
    listen 8443 ssl;
    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
    }
}
\`\`\`

\`$host\` (or the proxy's equivalent "pass through the original Host
header" variable) preserves whatever hostname the visitor actually
requested, letting the shared backend's virtual-host logic work exactly
as it did before the sidecar was introduced. Any proxy or sidecar
sitting in front of name-based virtual hosting needs to explicitly pass
through the original Host header rather than ever hardcoding it - a
config copied from a single-site use case is an easy way for this kind
of override to slip in unnoticed until a second virtual host is added
behind the same proxy.`,
};
