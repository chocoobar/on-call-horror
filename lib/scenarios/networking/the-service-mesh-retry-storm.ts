import type { Scenario } from "../types";

export const theServiceMeshRetryStorm: Scenario = {
  id: "the-service-mesh-retry-storm",
  title: "The Retry Storm Nobody Configured",
  subtitle: "a brief, minor blip in one service turned into ten times its own normal traffic within seconds",
  difficulty: "medium",
  type: "fix",
  topic: "networking",
  timeMinutes: 20,
  tags: ["service-mesh", "retries", "cascading-failure"],
  briefing: `"pricing-engine" had a brief, minor hiccup - about 2% of its requests
returned a slow 503 for roughly ninety seconds during a routine GC pause.
Its actual incoming request rate during that window spiked to nearly ten
times normal, driven entirely by callers elsewhere in the mesh, which
made the GC pause far worse and turned a minor blip into a much longer
outage.`,
  constraints: [
    "pricing-engine's own client teams confirm nobody increased their own call volume or added new callers around this time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "pricing-engine", namespace: "pricing3", labels: { app: "pricing-engine" } },
        spec: { replicas: 4, template: { metadata: { annotations: { "sidecar.istio.io/inject": "true" } } } },
        status: { readyReplicas: 4, updatedReplicas: 4, availableReplicas: 4 },
        age: "1y",
      },
      {
        apiVersion: "networking.istio.io/v1",
        kind: "DestinationRule",
        metadata: { name: "pricing-engine", namespace: "pricing3" },
        spec: {
          host: "pricing-engine.pricing3.svc.cluster.local",
          trafficPolicy: {
            connectionPool: { http: { http1MaxPendingRequests: 100, maxRequestsPerConnection: 10 } },
          },
        },
        age: "1y",
      },
      {
        apiVersion: "networking.istio.io/v1",
        kind: "VirtualService",
        metadata: { name: "pricing-engine", namespace: "pricing3" },
        spec: {
          hosts: ["pricing-engine.pricing3.svc.cluster.local"],
          http: [
            {
              route: [{ destination: { host: "pricing-engine.pricing3.svc.cluster.local" } }],
              retries: { attempts: 5, perTryTimeout: "1s", retryOn: "5xx,connect-failure,refused-stream" },
            },
          ],
        },
        age: "3mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "mesh-retry-policy-notes", namespace: "pricing3" },
        spec: {
          data: {
            "notes.md":
              "A mesh-wide default VirtualService retry policy of 5 attempts on\n5xx/connect-failure was added 3 months ago as a blanket resiliency\nmeasure, applied uniformly across every service including pricing-\nengine, without differentiating between services where blind retries\nare safe (idempotent reads) versus risky (anything prone to load-\ninduced failure, or where a retry itself adds meaningful load). When\npricing-engine started returning 503s on ~2% of requests during its GC\npause, every one of those failed calls was automatically retried up to\n5 times by each caller's own sidecar, each retry itself counting as a\nnew request against an already-struggling pricing-engine - amplifying\nan initial 2% failure rate into a large multiple of pricing-engine's\nnormal total request volume within seconds, which extended and deepened\nthe GC pressure rather than letting it resolve quickly on its own.\n",
          },
        },
        age: "3mo",
      },
    ],
  },
  hints: [
    "Client teams confirm they didn't send any more traffic than usual - so where did the extra load actually come from, if not from any application code sending more requests?",
    "`kubectl get virtualservice pricing-engine -n pricing3 -o yaml` - is there a retry policy configured? How many attempts, and on what conditions?",
    "`kubectl get configmap mesh-retry-policy-notes -n pricing3 -o yaml` - if roughly 2% of requests failed and each failure gets retried up to 5 times automatically by the mesh, what does that do to pricing-engine's total received request volume?",
  ],
  options: [
    {
      id: "mesh-retries-amplified-transient-failures-into-storm",
      label:
        "A mesh-wide VirtualService retry policy (5 attempts on 5xx/connect-failure, added 3 months ago as a blanket measure) applies to pricing-engine along with every other service - when its GC pause caused ~2% of requests to fail, every one of those failures was automatically retried up to 5 times by each caller's own sidecar, each retry counting as a brand-new request against an already-struggling pricing-engine; this turned a small, real failure rate into a large multiplier on total request volume within seconds, deepening the GC pressure and turning a minor, self-resolving blip into a much longer outage - all without any client team actually sending more traffic themselves.",
      explanation:
        "`mesh-retry-policy-notes` explains the mechanism and its consequence directly: a uniform, mesh-wide retry policy applied without differentiating which services can safely absorb blind retries under load. The VirtualService's own spec confirms 5 retry attempts configured for pricing-engine specifically. Client teams confirming they sent no additional traffic themselves rules out any application-level cause - the extra load is generated entirely by the mesh's own automatic retry behavior amplifying the original, much smaller 2% failure rate into a request-volume spike nearly ten times normal.",
    },
    {
      id: "pricing-engine-memory-leak",
      label: "pricing-engine has an underlying memory leak causing the GC pause, unrelated to retries.",
      explanation:
        "A GC pause causing a brief, initial ~2% failure rate is plausible on its own as a normal, occasional occurrence - but the question here is specifically why that minor, brief issue turned into a much larger and longer outage with request volume spiking nearly tenfold, which a memory leak alone doesn't explain; the volume spike is independently and specifically explained by the mesh's own retry amplification.",
    },
    {
      id: "autoscaler-over-provisioning-callers",
      label: "The horizontal pod autoscaler over-provisioned replicas for one of pricing-engine's callers, multiplying its legitimate call volume.",
      explanation:
        "Client teams explicitly confirm nobody increased their own call volume or added new callers - autoscaling additional caller replicas would still require each individual replica to make its own normal request rate, and the teams operating those callers have ruled out any volume increase on their end.",
    },
    {
      id: "dns-caching-causing-duplicate-requests",
      label: "DNS caching issues are causing callers' requests to be duplicated in transit.",
      explanation:
        "DNS resolution caching affects which address a connection is established to, not how many times a given logical request gets sent - there's no mechanism by which DNS caching would cause a request to be duplicated, whereas the mesh's own explicitly configured 5-attempt retry policy is a direct, confirmed mechanism for exactly that kind of amplification.",
    },
  ],
  correctOptionId: "mesh-retries-amplified-transient-failures-into-storm",
  resolution: `\`mesh-retry-policy-notes\` explains both the mechanism and why it applies
here: a mesh-wide VirtualService retry policy - 5 attempts on
5xx/connect-failure/refused-stream - was added 3 months ago as a blanket
resiliency measure, applied uniformly to every service including
pricing-engine, without distinguishing between services where blind
retries are safe and ones where they add risky additional load. The
VirtualService's own spec confirms this exact policy is active for
pricing-engine. When the GC pause caused roughly 2% of requests to
legitimately fail, each of those failures was automatically retried up
to 5 times by the calling service's own sidecar - each retry itself
landing as a brand-new request against an already-degraded
pricing-engine. That amplification turned a small, real 2% failure rate
into total received request volume spiking to nearly ten times normal
within seconds, which deepened the GC pressure and extended what should
have been a brief, self-resolving blip into a much longer outage -
entirely without any client team actually increasing their own traffic,
exactly as they reported.

The fix is scoping the retry policy more carefully rather than applying
it as a uniform blanket default - in particular, adding a retry budget
or backoff, and reconsidering blind retries for a service prone to
load-sensitive degradation:

\`\`\`yaml
spec:
  http:
    - route:
        - destination:
            host: pricing-engine.pricing3.svc.cluster.local
      retries:
        attempts: 2
        perTryTimeout: 1s
        retryOn: "5xx,connect-failure"
      retryBudget:
        percent: 20   # cap retry volume as a fraction of legitimate traffic
\`\`\`

More broadly, this is a strong case for pairing any mesh-wide retry
policy with per-service circuit breaking (via the DestinationRule's own
outlier detection) so a struggling service gets *less* traffic while
degraded, not more - a well-intentioned blanket retry policy, without
that pairing, can turn almost any transient, minor failure into a much
larger self-inflicted one.`,
};
