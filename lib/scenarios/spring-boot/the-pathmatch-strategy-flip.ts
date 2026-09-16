import type { Scenario } from "../types";

export const thePathmatchStrategyFlip: Scenario = {
  id: "the-pathmatch-strategy-flip",
  title: "The Path-Match Strategy Flip",
  subtitle: "document-search-api's one endpoint with a dot in its path parameter started 404ing after a routine Spring Boot bump",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 18,
  tags: ["java25", "spring-boot", "spring-mvc"],
  briefing: `A routine Spring Boot minor version bump to "document-search-api" shipped
with no application code changes. Since then, requests to
\`/documents/{filename}\` for any filename containing a dot before the last
segment - like \`report.v2.pdf\` - started returning 404, while filenames
without an extra dot work exactly as before.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "document-search-api", namespace: "documents", labels: { app: "document-search-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "document-search-api", image: "registry.internal/document-search-api:10.2.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "document-search-api-0f1g2h3i4-j5k6l", namespace: "documents", labels: { app: "document-search-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "document-search-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "document-search-api": [
            "2026-09-15T11:00:01.114Z WARN  o.s.web.servlet.PageNotFound - No mapping for GET /documents/report.v2.pdf",
            "2026-09-15T11:00:05.220Z INFO  c.e.documents.DocumentController - served GET /documents/summary (no extra dots, matched fine)",
          ],
        },
        age: "8h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "document-search-api-notes", namespace: "documents" },
        spec: {
          data: {
            "CHANGELOG.excerpt":
              "Spring Boot's default `spring.mvc.pathmatch.matching-strategy`\nmoved from the older `AntPathMatcher` to `PathPatternParser` several\nmajor versions ago, but this app had never explicitly set the property\neither way, and had been relying on a transitively-inherited override\nfrom a shared starter dependency that pinned the old strategy - until\nthis version bump also picked up a newer version of that shared starter,\nwhich dropped its own override, letting Spring Boot's real default\n(`PathPatternParser`) finally take effect. `AntPathMatcher` treated a\ntrailing dot-suffix in a path variable as a file extension by default\nunless explicitly told not to (`useSuffixPatternMatch=false`) - a\nbehavior `PathPatternParser` does not replicate the same way, and\n`{filename}` was never given an explicit regex constraint to allow dots.",
          },
        },
        age: "8h",
      },
    ],
  },
  hints: [
    "`kubectl logs document-search-api-0f1g2h3i4-j5k6l -n documents` - `No mapping for GET /documents/report.v2.pdf`. A filename with a *single* dot (like a normal extension) presumably still worked before - what's different about a path segment with more than one dot?",
    "`kubectl get configmap document-search-api-notes -n documents -o yaml` - what does the changelog say actually changed about `spring.mvc.pathmatch.matching-strategy`, and why did a version bump with no application code change end up flipping it?",
    "The two path-matching strategies (`AntPathMatcher` and `PathPatternParser`) have historically had different default behavior around treating a dot in a path variable as a file extension separator - does `{filename}` have any explicit regex constraint controlling that?",
  ],
  options: [
    {
      id: "pathpattern-parser-default-now-in-effect-changes-dot-handling",
      label:
        "A shared starter dependency had been silently pinning Spring Boot's older `AntPathMatcher` path-matching strategy for this app all along; the version bump picked up a newer version of that starter which dropped its own override, letting Spring Boot's actual current default, `PathPatternParser`, take effect for the first time - and because `{filename}` was never given an explicit regex constraint, and the two strategies handle a dot inside a path variable differently by default, any filename with more than one dot (like `report.v2.pdf`) no longer matches the route the way it used to.",
      explanation:
        "The failure is precise and consistent: `report.v2.pdf` (two dots) 404s while `summary` (no dots) matches fine. `document-search-api-notes` explains the underlying cause: this app was never explicitly configured for either path-matching strategy and had been unknowingly relying on a transitively-inherited override from a shared starter, which the version bump's newer starter dependency silently dropped - letting Spring Boot's real current default, `PathPatternParser`, take effect for the first time and change how a dot inside `{filename}` is interpreted, with no application code change required to trigger it.",
    },
    {
      id: "documentcontroller-mapping-annotation-removed",
      label: "The `@GetMapping` annotation on the documents endpoint was accidentally removed or altered.",
      explanation:
        "The log shows a working, successful match for a filename without extra dots on the exact same endpoint moments later - the mapping itself is present and functioning; the specific behavior that changed is how the path *variable* handles an embedded dot, not whether the endpoint is mapped at all.",
    },
    {
      id: "filenames-with-dots-are-invalid-urls",
      label: "Filenames containing multiple dots produce technically invalid URLs that were never actually supported.",
      explanation:
        "A dot is a perfectly valid character in a URL path segment, and the changelog confirms this specific pattern (multi-dot filenames as a path variable) worked correctly before the version bump - this isn't a URL-validity issue, it's a change in how Spring's routing layer parses path variables containing dots.",
    },
    {
      id: "document-search-service-reindexed",
      label: "The underlying document search/storage index was rebuilt and no longer contains those specific documents.",
      explanation:
        "The failure happens at the HTTP routing layer itself - `No mapping for GET /documents/report.v2.pdf` is Spring MVC reporting it couldn't match the URL to any controller method at all, before any document lookup or index query would ever be attempted.",
    },
  ],
  correctOptionId: "pathpattern-parser-default-now-in-effect-changes-dot-handling",
  resolution: `The failure is narrow and consistent: \`No mapping for GET
/documents/report.v2.pdf\` (two dots), while the identical endpoint
correctly serves \`/documents/summary\` (no dots) moments later. That
precision - failing specifically on filenames with more than one dot -
points at something in how the path variable itself gets parsed, not at
the endpoint or controller being broken generally.

\`document-search-api-notes\` traces it to a dependency the team never
directly controlled: this application never explicitly set
\`spring.mvc.pathmatch.matching-strategy\` itself, and had unknowingly been
relying on a shared starter dependency that pinned the older
\`AntPathMatcher\` strategy on its behalf. The version bump pulled in a
newer release of that same shared starter, which dropped its own
override - letting Spring Boot's actual current default,
\`PathPatternParser\`, take effect for the very first time in this
application, with zero lines of this app's own code changing.
\`AntPathMatcher\` and \`PathPatternParser\` have historically differed in
how they treat a dot embedded in a path variable (a legacy of
\`AntPathMatcher\`'s file-extension-suffix handling); \`{filename}\` was never
given an explicit regex constraint to make its intended behavior
independent of that default, so the strategy switch silently changed
which URLs it would match.

The fix is making the path variable's behavior explicit, independent of
whichever matching strategy happens to be active:

\`\`\`java
@GetMapping("/documents/{filename:.+}")
public Document getDocument(@PathVariable String filename) { ... }
\`\`\`

The \`{filename:.+}\` regex constraint tells Spring's routing layer
explicitly that this variable should greedily match everything up to the
end of the path, dots included, regardless of which path-matching
strategy is active underneath. Any route whose path variables can
legitimately contain dots is worth double-checking after any Spring Boot
or shared-starter-dependency bump - especially when, as here, a
transitively-inherited configuration override that nobody remembered
setting is silently removed by an upstream change.`,
};
