import type { Scenario } from "../types";

export const theIdleProxyHangup: Scenario = {
  id: "the-idle-proxy-hangup",
  title: "The Idle Proxy Hangup",
  subtitle: "502s cluster around the start of every hour, then vanish",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 18,
  tags: ["nginx", "reverse-proxy", "keep-alive"],
  briefing: `"billing-portal" sits behind an internal nginx reverse proxy that fronts
several backend services. A cluster of 502 errors shows up reliably every
hour, right around the top of the hour, then disappears within a minute
or two - correlating with the end of the previous hour's quietest traffic
window.`,
  constraints: [
    "billing-portal's own pods show no restarts, crashes, or errors in their own logs during these windows.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-portal", namespace: "billing3", labels: { app: "billing-portal" } },
        spec: {
          replicas: 2,
          template: { spec: { containers: [{ name: "billing-portal", env: [{ name: "HTTP_KEEP_ALIVE_TIMEOUT_SECONDS", value: "120" }] }] } },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "9mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "internal-nginx-proxy-config", namespace: "billing3" },
        spec: {
          data: {
            "proxy.conf": "upstream billing_portal {\n    server billing-portal.billing3.svc.cluster.local:8080;\n    keepalive 32;\n}\nproxy_read_timeout 60s;\n# no explicit keepalive_timeout set on the upstream connection - uses\n# nginx's compiled-in default of 75s for the proxy's own connections,\n# but the OS-level TCP idle connection reaper on this proxy's host is\n# configured to close any idle backend TCP socket after 55s.\n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "proxy-incident-notes", namespace: "billing3" },
        spec: {
          data: {
            "notes.md":
              "Traffic to billing-portal is lowest in the last ~10 minutes of every\nhour and picks back up right at the top of the next hour. The internal\nnginx proxy keeps a pool of persistent upstream connections to\nbilling-portal via its `keepalive 32` directive, each of which is\nsubject to this host's OS-level idle-TCP-connection reaper - configured\ncluster-wide, outside of nginx's own awareness, to silently close any\nTCP socket idle for more than 55 seconds. billing-portal's own\napplication keep-alive timeout is set to 120 seconds, comfortably longer\nthan nginx would ever consider a pooled connection idle on its own -\nbut neither side knows about the OS-level reaper closing the socket out\nfrom under both of them after the quiet period crosses 55 seconds.\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap proxy-incident-notes -n billing3 -o yaml` - when exactly during each hour is traffic quietest, and how does that line up with when 502s start?",
    "The nginx proxy pools persistent upstream connections (`keepalive 32`) - but is nginx the only thing that can close an idle TCP connection on this host?",
    "billing-portal's own keep-alive timeout (120s) and nginx's upstream keepalive pooling both look reasonable on their own - what third party, outside of either application's configuration, might be closing connections after a shorter idle window?",
  ],
  options: [
    {
      id: "os-level-conntrack-reaper-closes-pooled-connections",
      label:
        "This proxy host's OS-level idle-TCP-connection reaper silently closes any idle backend socket after 55 seconds - shorter than both nginx's own upstream connection pooling assumptions and billing-portal's 120-second application keep-alive - so during the quietest ~10 minutes of each hour, pooled connections in nginx's upstream keepalive pool age past 55 seconds idle and get closed out from under both sides; the next requests at the start of the new hour try to reuse those now-dead pooled connections and get an immediate 502 until nginx cycles in fresh ones.",
      explanation:
        "`proxy-incident-notes` lays out the exact mechanism and timing: quietest traffic in the last ~10 minutes of every hour gives pooled upstream connections enough idle time to cross the OS-level reaper's 55-second threshold, closing them silently, invisible to both nginx's own keepalive pool bookkeeping and billing-portal's separate 120-second application-level timeout. Neither side ever sees this happen; nginx just tries to reuse a pooled connection that's already dead the moment fresh traffic arrives at the top of the hour, producing exactly the reliable, short-lived 502 cluster observed.",
    },
    {
      id: "billing-portal-scheduled-job-conflict",
      label: "billing-portal runs a scheduled job at the top of every hour that blocks request handling.",
      explanation:
        "billing-portal's own logs show no errors, restarts, or unusual activity during these windows - there's no evidence of any in-process job or blocking behavior on the application side; the 502s are generated by the proxy, which means it's failing to get a working connection to the backend, not the backend being busy.",
    },
    {
      id: "nginx-worker-restart-scheduled",
      label: "The nginx proxy's worker processes restart on an hourly schedule, briefly dropping connections.",
      explanation:
        "There's no scheduled nginx worker restart configured anywhere in this setup, and a worker restart would typically be a much shorter, cleaner blip rather than repeatedly clustering right after the identified quiet period - the timing lines up specifically with idle-connection aging, not a periodic process restart.",
    },
    {
      id: "dns-ttl-causing-reresolution-hourly",
      label: "nginx re-resolves billing-portal's DNS name on an hourly cycle, briefly losing the upstream.",
      explanation:
        "The upstream is configured with a static, resolved hostname in nginx's config (not using a dynamic resolver with an hourly re-resolution cycle), and even a DNS re-resolution wouldn't explain 502s specifically triggered by a preceding quiet traffic period - the timing correlates with idle time, not with any DNS refresh interval.",
    },
  ],
  correctOptionId: "os-level-conntrack-reaper-closes-pooled-connections",
  resolution: `\`proxy-incident-notes\` connects the timing directly: traffic to
billing-portal is quietest in roughly the last 10 minutes of every hour,
comfortably long enough for pooled connections sitting in nginx's
\`keepalive 32\` upstream pool to go idle past 55 seconds - the threshold
at which this proxy host's OS-level idle-TCP-connection reaper silently
closes the socket, entirely outside of and invisible to both nginx's own
keepalive bookkeeping and billing-portal's separate 120-second
application-level keep-alive timeout. Neither application-layer setting
has any awareness this is happening. The moment traffic picks back up at
the top of the hour, nginx reaches into its pool, grabs a connection it
still believes is good, and gets a 502 the instant it tries to reuse a
socket the OS already tore down - repeating for however many pooled
connections went stale during the quiet window, then clearing up quickly
as nginx replaces them with fresh ones.

The fix is making nginx's own upstream keepalive timeout shorter than
the OS-level reaper's threshold, so nginx proactively retires idle pooled
connections before the OS ever gets the chance to silently kill them out
from under it:

\`\`\`nginx
upstream billing_portal {
    server billing-portal.billing3.svc.cluster.local:8080;
    keepalive 32;
    keepalive_timeout 45s;   # under the OS reaper's 55s threshold
}
\`\`\`

and, ideally, also raising or disabling the OS-level idle-connection
reaper for this internal proxy-to-backend traffic path, since it's an
infrastructure-level setting neither the proxy config nor the
application was ever designed around. As a general pattern: any hop in a
chain of proxies/backends with its own idle-connection timeout needs
that timeout to be the shortest, most proactive one in the chain -
including timeouts enforced by the underlying OS or network fabric, not
just the ones visible in application or proxy configuration.`,
};
