import type { Scenario } from "./types";

export const theTwoSourcesThatDisagreed: Scenario = {
  id: "the-two-sources-that-disagreed",
  title: "The Two Sources That Disagreed",
  subtitle: "geo-routing-service deployed a chart version that was never released alongside these values",
  difficulty: "hard",
  type: "fix",
  topic: "argocd",
  timeMinutes: 25,
  tags: ["argocd", "multi-source", "helm"],
  briefing: `"geo-routing-service" uses ArgoCD's multi-source Applications feature - one
source pulling a published Helm chart, a second source pulling a
values.yaml file from a separate git repo the app team owns directly, so
they can tune values without touching the chart repo. After the chart's
maintainers cut a new major version with renamed value keys, the
Application applied cleanly with no errors, but silently deployed using
none of the intended custom configuration at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "the-two-sources-that-disagreed", namespace: "argocd" },
        spec: {
          project: "default",
          sources: [
            {
              repoURL: "https://charts.example.com",
              chart: "geo-routing-chart",
              targetRevision: "4.0.0",
              helm: { valueFiles: ["$values/geo-routing/values-prod.yaml"] },
            },
            {
              repoURL: "https://github.com/example/geo-routing-config.git",
              targetRevision: "main",
              ref: "values",
            },
          ],
          destination: { server: "https://kubernetes.default.svc", namespace: "geo-routing" },
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: { sync: { status: "Synced" }, health: { status: "Degraded" } },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "multi-source-notes", namespace: "geo-routing" },
        spec: {
          data: {
            "values-prod.yaml.excerpt":
              "regionRouting:\n  primaryRegion: us-east-1\n  failoverRegions:\n    - us-west-2\n    - eu-west-1\n",
            "notes.md":
              "geo-routing-chart's v4.0.0 (released this week, and now what\ntargetRevision requests) renamed the entire top-level values schema:\n`regionRouting.*` became `routing.region.*` as part of a documented\nbreaking restructure (covered under 'Breaking Changes' in v4.0.0's\nreleased changelog). The app team's own values-prod.yaml, in their\nseparate config repo, still uses the OLD v3.x key structure\n(`regionRouting.*`) - it was never updated when the chart's targetRevision\nwas bumped to 4.0.0. Helm doesn't error on values keys that don't\ncorrespond to anything the chart's templates reference - it simply\nignores them silently, and the chart's own v4.0.0 defaults for\n`routing.region.*` (a single us-east-1 region, no failover configured at\nall) apply instead, with nothing in the render process ever flagging\nthat the supplied values file's keys don't match anything the chart\nactually uses.",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl get application the-two-sources-that-disagreed -n argocd -o yaml` - check both `sources` entries: which chart version is being requested, and is the values file's own key structure actually current for that version?",
    "Helm silently ignores values keys that don't match anything a chart's templates reference - it doesn't error on an unrecognized or outdated key path, it just falls back to that value's own chart default.",
    "`kubectl get configmap multi-source-notes -n geo-routing -o yaml` for the chart's own changelog around its schema restructure, and whether the separate values repo was updated to match.",
  ],
  options: [
    {
      id: "values-schema-stale-after-chart-major-bump",
      label:
        "The chart's v4.0.0 release renamed its entire values schema as a documented breaking change, but the app team's separately-sourced values-prod.yaml still uses the old v3.x key structure and was never updated alongside the chart version bump - Helm silently ignores values keys that don't correspond to anything the new chart's templates reference, so the render falls back to the chart's own bare v4.0.0 defaults with no error anywhere.",
      explanation:
        "`multi-source-notes` confirms the chart's v4.0.0 renamed `regionRouting.*` to `routing.region.*` as a documented breaking change, and that the separate values file (sourced from a different repo entirely, per this Application's multi-source setup) still uses the old key names. Helm doesn't error on unrecognized values keys - it silently ignores them and uses the chart's own defaults for whatever wasn't successfully overridden, which is exactly why the sync 'succeeded' cleanly while deploying none of the intended custom region/failover configuration.",
    },
    {
      id: "ref-values-pointing-wrong-repo",
      label: "The second source's `ref: values` isn't actually resolving to the values repo at all.",
      explanation:
        "If the `$values` reference weren't resolving, Helm would fail to find the referenced values file path entirely and error out during the sync - the sync completed successfully and applied a real (if wrong) rendered configuration, consistent with the values file being found and read, just with keys the current chart version doesn't recognize.",
    },
    {
      id: "chart-version-pinned-wrong-two-sources",
      label: "The chart's targetRevision should have stayed pinned to 3.x, and someone accidentally bumped it.",
      explanation:
        "Whether 4.0.0 was an intentional or accidental bump is a fair process question, but it doesn't change the actual mechanism of the failure - once targetRevision requests 4.0.0, the values file's outdated key structure silently fails to apply against that version's renamed schema, regardless of whether the version bump itself was deliberate.",
    },
    {
      id: "two-sources-syncing-out-of-order",
      label: "The two sources are being synced out of order, with the values source applying before the chart source is ready.",
      explanation:
        "Multi-source Applications resolve and merge all sources together as inputs to a single Helm render - there's no sequential 'sync order' between a chart source and a values-only reference source the way there is between separate sync-waved resources; both are inputs to the same render pass, and the actual issue is what's inside one of those inputs no longer matching the chart's current schema.",
    },
  ],
  correctOptionId: "values-schema-stale-after-chart-major-bump",
  resolution: `\`multi-source-notes\` confirms the chart's v4.0.0 release - which
\`targetRevision\` now requests - renamed its entire values schema as a
documented breaking change (\`regionRouting.*\` became
\`routing.region.*\`). The app team's own \`values-prod.yaml\`, sourced from
a completely separate git repo via this Application's multi-source setup,
still uses the old v3.x key names and was never updated when the chart
version was bumped. Helm doesn't validate or error on values keys that
don't correspond to anything the chart's templates reference - it simply
ignores them, silently falling back to the chart's own bare defaults for
whatever wasn't successfully overridden. The sync applies cleanly with no
error anywhere in the pipeline, while quietly deploying a single-region,
no-failover configuration instead of the intended multi-region setup.

Fix by updating the values file to the new schema the current chart
version actually expects:

\`\`\`yaml
# geo-routing-config repo: geo-routing/values-prod.yaml
routing:
  region:
    primaryRegion: us-east-1
    failoverRegions:
      - us-west-2
      - eu-west-1
\`\`\`

Once the values file's keys match what v4.0.0's templates actually
reference, the next sync correctly applies the intended multi-region
configuration. Worth a broader process fix too: any major chart version
bump needs to be reviewed against that release's changelog for schema
changes *before* bumping targetRevision, especially in a multi-source
setup where the values file lives in a separate repo from the chart and
is easy to forget needs updating in lockstep - a values file with
completely wrong keys is, by Helm's design, indistinguishable from an
intentional "use the defaults" choice.`,
};
