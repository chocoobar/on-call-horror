import type { Scenario } from "./types";

export const theShardThatStayedHome: Scenario = {
  id: "the-shard-that-stayed-home",
  title: "The Shard That Stayed Home",
  subtitle: "a third of orders-index's documents vanish from search results every time the eu-2 zone gets busy",
  difficulty: "hard",
  type: "fix",
  topic: "observability",
  timeMinutes: 25,
  tags: ["elasticsearch", "shard-allocation", "availability-zones"],
  briefing: `Search results for the "orders-index" Elasticsearch index have been
intermittently incomplete for a couple of weeks - roughly a third of
expected documents missing, but only during certain periods, always
seeming to correlate loosely with overall cluster load. The index's own
health status reports "green" throughout, showing no unassigned or
relocating shards at any point checked.`,
  constraints: [
    "A manual document-count check during one of these incomplete-result periods confirms roughly a third of orders-index's documents are genuinely not being returned by search queries, despite existing in the cluster.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "orders-index-shard-allocation", namespace: "search" },
        spec: {
          data: {
            "allocation-settings.json":
              '{\n  "index.routing.allocation.awareness.attributes": "zone",\n  "cluster.routing.allocation.awareness.attributes": "zone",\n  "index.number_of_shards": 6,\n  "index.number_of_replicas": 1\n}',
          },
        },
        age: "1y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "elasticsearch-zone-notes", namespace: "search" },
        spec: {
          data: {
            "notes.md":
              "Shard allocation awareness spreads primary/replica pairs across zones\n(`zone` values: `eu-1`, `eu-2`) so a single zone loss doesn't lose data.\nCritically, allocation *awareness* alone (without\n`cluster.routing.allocation.awareness.force.zone.values` explicitly set\nto the full list of zones) does NOT prevent Elasticsearch from routing\nqueries to a zone that's currently under heavy load or experiencing\nelevated query rejection - it only affects *where shards are placed*,\nnot how queries are load-balanced or retried across replicas at request\ntime. `eu-2` has intermittently been hitting its `search` thread pool\nqueue limit during load spikes over the past couple of weeks (a\ncapacity issue, separately being addressed), and Elasticsearch's default\nbehavior returns whatever *partial* results it successfully gathered\nfrom the shards that did respond in time, by default WITHOUT erroring or\nflagging the response as partial unless the client explicitly checks the\nresponse's `_shards.failed` count and `timed_out` field - which the\nsearch service's client code does not do.\n",
          },
        },
        age: "2mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "search-client-notes", namespace: "search" },
        spec: {
          data: {
            "SearchClient.java.excerpt":
              "SearchResponse response = client.search(request, RequestOptions.DEFAULT);\nreturn response.getHits(); // does not check response.getFailedShards()\n                            // or response.isTimedOut() before returning\n                            // results as if they were complete\n",
          },
        },
        age: "1y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap orders-index-shard-allocation -n search -o yaml` - is shard allocation *forced* evenly across zones, or just made *aware* of them? Those are two different settings with very different guarantees.",
    "`kubectl get configmap elasticsearch-zone-notes -n search -o yaml` - what happens to a search request when some shards can't respond in time due to load, and does Elasticsearch fail loudly or return whatever it has by default?",
    "`kubectl get configmap search-client-notes -n search -o yaml` - does the application's search client actually check whether a response represents complete or partial results before using it?",
  ],
  options: [
    {
      id: "partial-results-silently-returned-during-shard-timeout",
      label:
        "eu-2 intermittently hits its search thread pool queue limit under load, causing some of orders-index's shards there to time out or fail to respond to a given query in time - Elasticsearch's default behavior is to return whatever partial results it did successfully gather without erroring, and since the search client's code never checks `_shards.failed` or `timed_out` on the response, it silently treats an incomplete result set as if it were complete, explaining the intermittent missing documents despite the index reporting a healthy 'green' status the whole time.",
      explanation:
        "`elasticsearch-zone-notes` explains that allocation *awareness* (configured here) only controls shard placement, not query-time load balancing or failure handling, and confirms eu-2 has been intermittently hitting thread pool limits under load, causing Elasticsearch to silently return partial results by default. `search-client-notes` confirms the application's client code never inspects `_shards.failed` or `timed_out` before using a response's hits - together explaining exactly why search results are intermittently missing roughly a third of documents (consistent with one of several shards failing to respond) correlating with cluster load, while the index's own health status stays 'green' since a query-time partial-results event doesn't affect shard health or allocation status at all.",
    },
    {
      id: "shards-genuinely-unassigned",
      label: "orders-index has unassigned shards during these periods that simply aren't showing up in the health check.",
      explanation:
        "The index's health status is explicitly confirmed 'green' with no unassigned or relocating shards at any point checked - unassigned shards would show as yellow or red health status, which directly rules this out as the mechanism, regardless of how convincing the missing-documents symptom looks.",
    },
    {
      id: "documents-being-deleted-under-load",
      label: "A background process is deleting roughly a third of orders-index's documents under high load.",
      explanation:
        "The manual document-count check confirms the missing documents genuinely still exist in the cluster during these periods - they're being under-returned by search queries, not actually deleted. A deletion process would reduce the real document count, which isn't what's observed here.",
    },
    {
      id: "index-refresh-interval-too-long",
      label: "The index's refresh interval is too long, so recently indexed documents aren't yet searchable.",
      explanation:
        "A refresh-interval delay would affect only very recently indexed documents, not roughly a third of the entire index's existing, already-indexed documents - and it wouldn't correlate with cluster load or zone-level query pressure the way described here.",
    },
  ],
  correctOptionId: "partial-results-silently-returned-during-shard-timeout",
  resolution: `\`orders-index-shard-allocation\` shows \`index.routing.allocation.awareness.attributes\`
set to \`zone\`, but no corresponding \`cluster.routing.allocation.awareness.force.zone.values\`.
\`elasticsearch-zone-notes\` explains the important distinction: allocation
*awareness* alone only influences where shards are physically placed
across zones for resilience - it says nothing about how queries get
load-balanced or handled at request time. Separately, \`eu-2\` has been
intermittently hitting its search thread pool queue limit during load
spikes over the past couple of weeks, a known capacity issue being
addressed on its own. When some of orders-index's shards in that zone
can't respond to a query in time under that pressure, Elasticsearch's
default behavior is to return whatever results it *did* successfully
gather from the shards that responded, without erroring - the response
simply carries a nonzero \`_shards.failed\` count and possibly
\`timed_out: true\`, available for any client that bothers to check.
\`search-client-notes\` confirms this one doesn't: it reads \`response.getHits()\`
directly and returns them, with no check of shard failure or timeout
status at all - silently treating a partial result set as if it were
complete. That's exactly why the index's own health status stays "green"
throughout (a query-time partial-result event has nothing to do with
shard allocation health) while real search results intermittently drop
roughly the documents that live on whichever shards didn't make it back
in time.

The fix has two parts: making the search client fail loudly (or retry)
on partial results instead of silently trusting them, and addressing the
underlying eu-2 capacity pressure:

\`\`\`java
SearchResponse response = client.search(request, RequestOptions.DEFAULT);
if (response.getFailedShards() > 0 || response.isTimedOut()) {
    throw new IncompleteSearchResultException(
        "search returned partial results: " + response.getFailedShards() + " shards failed");
}
return response.getHits();
\`\`\`

Elasticsearch's "return what we've got" default is a reasonable
availability tradeoff, but only for a client that's actually checking
whether what it got was everything - silently trusting a response's hits
without checking shard failure status turns a visible, alertable
degraded-search event into an invisible, silently wrong one.`,
};
