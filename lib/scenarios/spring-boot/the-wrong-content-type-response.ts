import type { Scenario } from "../types";

export const theWrongContentTypeResponse: Scenario = {
  id: "the-wrong-content-type-response",
  title: "The Wrong Content-Type Response",
  subtitle: "mobile-bff starts sending XML to a mobile app that has never once asked for it",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "jackson", "spring-boot"],
  briefing: `Mobile app crash reports spiked right after last week's dependency update
to "mobile-bff" - the app's JSON parser is choking on responses that,
when captured, turn out to be valid XML instead. Nobody changed any
controller code, and Postman requests without an explicit \`Accept\` header
get JSON just fine.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "mobile-bff", namespace: "mobile", labels: { app: "mobile-bff" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "mobile-bff", image: "registry.internal/mobile-bff:11.0.3" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "mobile-bff-9j0k1l2m3-n4o5p", namespace: "mobile", labels: { app: "mobile-bff" } },
        status: { phase: "Running", containerStatuses: [{ name: "mobile-bff", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "mobile-bff": [
            "2026-09-15T09:30:01.110Z INFO  c.e.mobile.ProfileController - handling GET /profile, Accept: application/xml;q=0.9,*/*;q=0.8",
            "2026-09-15T09:30:01.114Z DEBUG o.s.w.s.m.m.a.RequestResponseBodyMethodProcessor - Using converter MappingJackson2XmlHttpMessageConverter, writing content-type application/xml",
          ],
        },
        age: "5d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "mobile-bff-notes", namespace: "mobile" },
        spec: {
          data: {
            "CHANGELOG.excerpt":
              "Last week's dependency update added `jackson-dataformat-xml` to the\nclasspath (transitively, via a new internal reporting library). Its\npresence auto-registers `MappingJackson2XmlHttpMessageConverter` as an\nadditional `HttpMessageConverter`. Spring's content negotiation picks the\nfirst converter that supports a media type the client's `Accept` header\naccepts - and the mobile app's HTTP client sends a broad, permissive\n`Accept` header (`application/xml;q=0.9,*/*;q=0.8`) that was previously\nharmless because no XML converter existed to match it.",
          },
        },
        age: "5d",
      },
    ],
  },
  hints: [
    "`kubectl logs mobile-bff-9j0k1l2m3-n4o5p -n mobile` - the mobile app's own `Accept` header is right there in the log. What does it actually request, and in what preference order?",
    "Postman without an `Accept` header gets JSON because Spring falls back to a default when nothing is specified - that's a different code path from a client that explicitly lists `application/xml` as an acceptable type.",
    "`kubectl get configmap mobile-bff-notes -n mobile -o yaml` - what got added to the classpath transitively, and what does its mere presence cause Spring to auto-register?",
  ],
  options: [
    {
      id: "xml-converter-auto-registered-matches-broad-accept-header",
      label:
        "A transitive dependency added `jackson-dataformat-xml` to the classpath, which auto-registers an XML `HttpMessageConverter`; the mobile app's `Accept` header has always broadly included `application/xml`, which used to be harmless because no converter could satisfy it - now that one exists and content negotiation picks it, the same unchanged mobile client starts receiving XML instead of JSON for the first time.",
      explanation:
        "The log shows the mobile app's actual `Accept` header - `application/xml;q=0.9,*/*;q=0.8` - has always included XML, and the debug line confirms Spring is now selecting `MappingJackson2XmlHttpMessageConverter` specifically because it satisfies that header. `mobile-bff-notes` explains why this only started happening now: last week's dependency bump transitively pulled in `jackson-dataformat-xml`, whose mere presence on the classpath auto-registers the XML converter - a converter that wasn't there before to compete for a media type the mobile client was always willing to accept.",
    },
    {
      id: "mobile-app-changed-accept-header",
      label: "The mobile app started sending an `Accept: application/xml` header in its latest release.",
      explanation:
        "There's no indication the mobile app shipped a new release around this time, and the crash spike lines up precisely with this service's own dependency update - the client's `Accept` header behavior described here has always been broad, it just never mattered before an XML converter existed to act on it.",
    },
    {
      id: "profilecontroller-explicitly-produces-xml",
      label: "ProfileController was changed to explicitly produce XML responses.",
      explanation:
        "No controller code changed in this deploy - the changelog attributes the shift entirely to a transitive dependency's classpath presence auto-registering a converter, which is a framework-level content-negotiation change, not an explicit `produces` annotation added to any controller method.",
    },
    {
      id: "load-balancer-content-type-rewrite",
      label: "A load balancer or proxy in front of the service is rewriting response content types.",
      explanation:
        "The debug log line shows the conversion happening inside the application itself, at the `RequestResponseBodyMethodProcessor` level, selecting an XML message converter - this is Spring's own content negotiation choosing XML, not something being altered afterward by infrastructure in front of it.",
    },
  ],
  correctOptionId: "xml-converter-auto-registered-matches-broad-accept-header",
  resolution: `The pod's own log shows both halves of the mechanism. First, the mobile
app's actual request: \`Accept: application/xml;q=0.9,*/*;q=0.8\` -
XML has always been in there, just with a slightly lower preference than
a wildcard. Second, Spring's own content-negotiation decision: \`Using
converter MappingJackson2XmlHttpMessageConverter, writing content-type
application/xml\`.

\`mobile-bff-notes\` explains why that converter exists to be picked at
all now: last week's dependency update transitively pulled in
\`jackson-dataformat-xml\` through a new internal reporting library. Spring
Boot auto-configures an \`HttpMessageConverter\` for any supported format
whose library is present on the classpath - simply having
\`jackson-dataformat-xml\` available is enough to register an XML converter
automatically, no explicit configuration required. Once that converter
exists, Spring's standard content-negotiation logic picks the first
converter that satisfies the client's \`Accept\` header - and the mobile
app's header, unchanged for a long time, was always broad enough to
accept XML; it simply never had anything to match against before.

The fix is being explicit about what this API actually serves, rather
than letting classpath presence implicitly decide:

\`\`\`java
@GetMapping(value = "/profile", produces = MediaType.APPLICATION_JSON_VALUE)
public ProfileResponse getProfile() { ... }
\`\`\`

or, at the application level, disabling automatic XML support entirely if
it was never intended to be exposed:

\`\`\`yaml
spring:
  mvc:
    contentnegotiation:
      favor-parameter: false
\`\`\`

Any transitive dependency that happens to bring a new \`HttpMessageConverter\`
onto the classpath can silently change what content type existing clients
receive - pinning \`produces\` explicitly on public-facing endpoints avoids
depending on which converters happen to be present.`,
};
