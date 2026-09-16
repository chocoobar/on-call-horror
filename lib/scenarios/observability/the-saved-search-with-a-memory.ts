import type { Scenario } from "../types";

export const theSavedSearchWithAMemory: Scenario = {
  id: "the-saved-search-with-a-memory",
  title: "The Saved Search With A Memory",
  subtitle: "the on-call runbook's Kibana link keeps opening to a week-old view of nothing happening",
  difficulty: "easy",
  type: "fix",
  topic: "observability",
  timeMinutes: 10,
  tags: ["kibana", "saved-search", "logging"],
  briefing: `The runbook for "image-processor" links directly to a saved Kibana search
meant to show its error logs during an active incident. Every time
someone clicks it during a real, ongoing incident, it opens showing a
calm, empty result set from what turns out to be a fixed date range over
a week old - not "the last 15 minutes," which is what everyone assumed it
was set to.`,
  constraints: [
    "image-processor is confirmed to be actively logging errors right now, via a direct `kubectl logs` check.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "image-processor", namespace: "media", labels: { app: "image-processor" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "image-processor-4f5g6h7i8-j9k0l", namespace: "media", labels: { app: "image-processor" } },
        status: { phase: "Running", containerStatuses: [{ name: "image-processor", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "image-processor": [
            "2026-09-15T11:58:02.310Z ERROR c.e.media.ThumbnailWorker - OutOfMemoryError generating thumbnail for asset-88213",
            "2026-09-15T11:58:19.775Z ERROR c.e.media.ThumbnailWorker - OutOfMemoryError generating thumbnail for asset-88214",
          ],
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "kibana-saved-search-export", namespace: "media" },
        spec: {
          data: {
            "image-processor-errors.ndjson":
              '{"attributes":{"title":"image-processor errors","timeRestore":true,"timeTo":"2026-09-07T15:30:00.000Z","timeFrom":"2026-09-07T14:30:00.000Z","kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"level:ERROR\\"}}"}}}',
          },
        },
        age: "8d",
      },
    ],
  },
  hints: [
    "`kubectl logs image-processor-4f5g6h7i8-j9k0l -n media` - errors are actively happening right now.",
    "`kubectl get configmap kibana-saved-search-export -n media -o yaml` - look at `timeRestore`, `timeFrom`, and `timeTo` in the saved search's exported definition.",
    "`timeRestore: true` on a saved Kibana object means opening it always jumps to the *exact fixed range it was saved with*, not a relative range like 'last 15 minutes' - even if that's what someone glancing at the search box assumed.",
  ],
  options: [
    {
      id: "time-restore-pins-fixed-range",
      label:
        "The saved search has `timeRestore: true` with a fixed absolute `timeFrom`/`timeTo` from over a week ago baked in at save time - opening the link always jumps to that exact historical window regardless of when it's clicked, rather than a relative 'last 15 minutes' range, which is why it shows a calm empty result during an active incident happening right now.",
      explanation:
        "`kibana-saved-search-export` shows `timeRestore: true` along with a fixed `timeFrom`/`timeTo` from over a week prior. A saved object with `timeRestore` enabled always reopens to that exact stored absolute range, not a relative one - regardless of the query itself (`level:ERROR`) being entirely correct. Since `kubectl logs` independently confirms real errors happening right now, well outside that stored window, the search is querying the wrong slice of time, not failing to find real errors within the range it's actually looking at.",
    },
    {
      id: "elasticsearch-not-indexing-image-processor",
      label: "Elasticsearch has stopped indexing logs for image-processor entirely.",
      explanation:
        "There's nothing in the saved search's own definition pointing at an indexing failure - the fixed, week-old `timeFrom`/`timeTo` baked into the saved object is a far more direct and sufficient explanation for why current errors don't appear, without needing to assume a separate ingestion failure.",
    },
    {
      id: "wrong-log-level-field-name",
      label: "The saved search's query uses the wrong field name for log level, so it never matches ERROR logs.",
      explanation:
        "The query itself (`level:ERROR`) isn't shown to be wrong - the problem demonstrated by `timeRestore` and the stale fixed date range is that the search is scoped to entirely the wrong window of time, which would produce empty results even with a perfectly correct query.",
    },
    {
      id: "kibana-permissions-issue",
      label: "The user opening the link doesn't have permission to view image-processor's logs.",
      explanation:
        "A permissions issue would typically show an access-denied message or a blocked view, not a normally-rendered, empty-but-otherwise-functional search result - the saved object's own definition already explains the empty result via its fixed, stale time range.",
    },
  ],
  correctOptionId: "time-restore-pins-fixed-range",
  resolution: `\`kubectl logs\` confirms image-processor is actively throwing
\`OutOfMemoryError\`s right now. \`kibana-saved-search-export\` shows why the
runbook's saved search doesn't show them: the saved object has
\`timeRestore: true\`, along with a fixed, absolute \`timeFrom\`/\`timeTo\` pair
from over a week ago, baked in at the moment it was last saved. A Kibana
saved search (or dashboard) with \`timeRestore\` enabled always reopens to
that *exact stored range* every time it's opened, regardless of when -
it's designed for exactly this use case ("always show me this specific
historical incident window"), which is precisely the wrong behavior for a
runbook link meant to show "what's happening right now." The query itself,
\`level:ERROR\`, is completely correct; it's just being run against a slice
of time from over a week ago.

Whoever built this saved search most likely saved it *while looking at* a
real incident, with the time picker set to that incident's specific
window, without noticing \`timeRestore\` would lock that window in for
every future open.

The fix is re-saving the search with \`timeRestore\` disabled, so it
inherits whatever time range is currently active in Kibana instead of
forcing its own:

\`\`\`json
{
  "attributes": {
    "title": "image-processor errors",
    "timeRestore": false,
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\\"query\\":{\\"query\\":\\"level:ERROR\\"}}"
    }
  }
}
\`\`\`

Runbook-linked saved searches and dashboards meant for live incident use
should almost always have \`timeRestore\` off - it's the right setting for
"pin this to a specific past event," and the wrong one for "show me
what's happening right now."`,
};
