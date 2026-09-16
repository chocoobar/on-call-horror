import type { Scenario } from "../types";

export const theYamlListThatBecameAString: Scenario = {
  id: "the-yaml-list-that-became-a-string",
  title: "The YAML List That Became a String",
  subtitle: "cors-gateway blocks every origin except the first one on its allow-list, after a routine env-var override",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 12,
  tags: ["java25", "spring-boot", "configuration"],
  briefing: `"cors-gateway" is supposed to allow requests from three trusted frontend
origins. Since ops switched the allow-list from being baked into
\`application.yaml\` to being overridden by a Kubernetes environment
variable (for easier per-environment tuning), only the first of the three
origins works - the other two get CORS-blocked as if they were never on
the list at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "cors-gateway", namespace: "platform", labels: { app: "cors-gateway" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "cors-gateway",
                  image: "registry.internal/cors-gateway:1.0.5",
                  env: [
                    { name: "APP_CORS_ALLOWEDORIGINS_0_", value: "https://app.example.com" },
                    { name: "APP_CORS_ALLOWEDORIGINS", value: "https://app.example.com,https://admin.example.com,https://partner.example.com" },
                  ],
                },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "cors-gateway-6h7i8j9k0-l1m2n", namespace: "platform", labels: { app: "cors-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "cors-gateway", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "cors-gateway": [
            "2026-09-15T08:00:01.110Z INFO  c.e.platform.CorsProperties - bound app.cors.allowed-origins = [https://app.example.com,https://admin.example.com,https://partner.example.com]",
            "2026-09-15T09:12:04.220Z WARN  o.s.web.cors.DefaultCorsProcessor - Invalid CORS request: origin \"https://admin.example.com\" not in allowed list",
          ],
        },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cors-gateway-notes", namespace: "platform" },
        spec: {
          data: {
            "CorsProperties.java.excerpt":
              "@ConfigurationProperties(prefix = \"app.cors\")\npublic class CorsProperties {\n    private List<String> allowedOrigins = new ArrayList<>();\n    // getters/setters\n}\n",
            "notes.md":
              "Spring Boot's relaxed environment-variable binding maps\n`APP_CORS_ALLOWEDORIGINS` to the property `app.cors.allowed-origins` -\nbut binding a *single* environment variable's string value to a\n`List<String>` property only works automatically when using the\ncomma-separated form via Spring Boot's `ConfigurationPropertiesBinder`\nif indexed keys aren't present; the bound value shown in the startup log\nis actually one single-element list containing the whole comma-joined\nstring as one entry, not three separate origins, because\n`DefaultCorsProcessor` compares the raw request origin against each\nlist *element* exactly, and only the first origin substring happens to\nmatch by coincidence via a separate legacy indexed override still present\nin the manifest.",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl logs cors-gateway-6h7i8j9k0-l1m2n -n platform` - the bound value is logged directly. Does `app.cors.allowed-origins` look like a list of three separate strings, or something else?",
    "`kubectl get deployment cors-gateway -n platform -o yaml` - there are two related environment variables here: one plain, one with an odd `_0_` suffix. What does that suffix mean for Spring Boot's relaxed binding, and which one is actually taking effect for which origin?",
    "`kubectl get configmap cors-gateway-notes -n platform -o yaml` - Spring's relaxed binding needs indexed keys (`APP_CORS_ALLOWEDORIGINS_0_`, `_1_`, `_2_`) to bind separate list elements from environment variables - a single comma-joined variable without indices doesn't automatically split into a list the way it would in a YAML file.",
  ],
  options: [
    {
      id: "unindexed-env-var-becomes-single-list-element",
      label:
        "`APP_CORS_ALLOWEDORIGINS` is a single environment variable holding a comma-joined string; Spring Boot's relaxed binding for `List<String>` properties from environment variables requires indexed keys (`_0_`, `_1_`, `_2_`) to produce separate list elements, and without them the whole comma-joined string binds as one single list entry - so `DefaultCorsProcessor`, which compares each request's origin against list elements exactly, only ever matches the leftover legacy indexed override (`_0_`, still present and pointing at the first origin), and rejects everything else as not being in the list at all.",
      explanation:
        "The startup log shows the bound value as `[https://app.example.com,https://admin.example.com,https://partner.example.com]` - a *single* bracketed list entry containing all three origins comma-joined together, not three separate list elements. `cors-gateway-notes` explains that Spring's relaxed binding needs indexed environment variable keys to produce a real multi-element list; a plain, unindexed comma-separated variable doesn't automatically split the way the same value would in YAML. The only origin that actually works is the one still covered by the leftover `_0_`-indexed variable from before the switch.",
    },
    {
      id: "frontend-origins-misconfigured",
      label: "The frontend applications themselves are sending the wrong Origin header.",
      explanation:
        "The rejection log shows the origin `https://admin.example.com` arriving exactly as expected and being compared against cors-gateway's own allow-list - the origin sent by the client is correct; it's the server-side list it's being checked against that isn't structured the way the code expects.",
    },
    {
      id: "cors-filter-not-registered",
      label: "The CORS filter itself isn't registered correctly in the Spring Security filter chain.",
      explanation:
        "`DefaultCorsProcessor` is actively running and evaluating the request - it explicitly logs the rejection with a specific reason (\"not in allowed list\") - which confirms the CORS filter is registered and functioning; the list it's checking against is simply malformed.",
    },
    {
      id: "cache-serving-stale-cors-config",
      label: "A configuration cache is serving a stale CORS allow-list from before the origins were added.",
      explanation:
        "The startup log shows all three intended origins are present in the bound configuration value - they just aren't structured as separate list elements the CORS processor can match against individually; this isn't a caching or staleness issue, it's a binding-shape issue at startup.",
    },
  ],
  correctOptionId: "unindexed-env-var-becomes-single-list-element",
  resolution: `The startup log shows exactly what got bound: \`app.cors.allowed-origins =
[https://app.example.com,https://admin.example.com,https://partner.example.com]\`
- a single bracketed list containing one long, comma-joined string, not
three separate entries. \`DefaultCorsProcessor\` compares an incoming
request's \`Origin\` header against each *element* of that list exactly -
and with only one (very long) element, only a request whose origin
happens to match that entire joined string, or a leftover override from
before the switch, will ever pass.

\`cors-gateway-notes\` explains the binding mechanics: Spring Boot's relaxed
environment-variable binding can populate a \`List<String>\`
\`@ConfigurationProperties\` field, but doing so from environment variables
requires indexed keys - \`APP_CORS_ALLOWEDORIGINS_0_\`,
\`APP_CORS_ALLOWEDORIGINS_1_\`, \`APP_CORS_ALLOWEDORIGINS_2_\` - to produce
separate list elements, the same way YAML's own list syntax would. A
single plain variable holding a comma-separated string doesn't get
automatically split into a list purely by virtue of containing commas.
The only origin that worked was covered by a leftover indexed override
(\`_0_\`) still present in the manifest from before the switch to the
plain variable.

The fix is using indexed environment variable keys - one per origin -
matching what Spring's relaxed binding actually expects:

\`\`\`yaml
env:
  - name: APP_CORS_ALLOWEDORIGINS_0_
    value: "https://app.example.com"
  - name: APP_CORS_ALLOWEDORIGINS_1_
    value: "https://admin.example.com"
  - name: APP_CORS_ALLOWEDORIGINS_2_
    value: "https://partner.example.com"
\`\`\`

Any \`List<String>\` (or other collection-typed) \`@ConfigurationProperties\`
field being overridden from a Kubernetes environment variable needs
indexed keys, not a single comma-joined value - and it's worth logging the
bound value at startup (as this service already does) specifically to
catch a binding shape mismatch like this before it reaches production
traffic.`,
};
