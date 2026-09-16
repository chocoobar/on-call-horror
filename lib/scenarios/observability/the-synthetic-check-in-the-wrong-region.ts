import type { Scenario } from "../types";

export const theSyntheticCheckInTheWrongRegion: Scenario = {
  id: "the-synthetic-check-in-the-wrong-region",
  title: "The Synthetic Check In The Wrong Region",
  subtitle: "every synthetic probe says storefront-web is fine while an entire region's customers can't check out",
  difficulty: "medium",
  type: "fix",
  topic: "observability",
  timeMinutes: 15,
  tags: ["synthetics", "multi-region", "monitoring"],
  briefing: `Customer support is fielding a wave of complaints about "storefront-web"
being completely unreachable - but every single synthetic uptime check
on the status dashboard is green, all passing, response times normal. It
takes an unusually long time to notice the complaints are coming almost
entirely from one geographic region.`,
  constraints: [
    "storefront-web is deployed multi-region, and the affected region's own load balancer metrics independently confirm a real, near-total outage there.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "storefront-web", namespace: "storefront", labels: { app: "storefront-web", region: "eu-west-1" } },
        spec: { replicas: 4 },
        status: { readyReplicas: 0, updatedReplicas: 4, availableReplicas: 0 },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "synthetics-config", namespace: "monitoring" },
        spec: {
          data: {
            "checks.yaml":
              "checks:\n  - name: storefront-web-uptime\n    url: https://storefront.example.com/health\n    probe_locations: ['us-east-1']\n    interval: 60s\n    # NOTE: originally configured with probe_locations covering both\n    # us-east-1 and eu-west-1 when storefront-web was US-only; eu-west-1\n    # was added to the *application's* deployment regions eight months\n    # ago as part of European expansion, but nobody updated this\n    # synthetic check's probe_locations to add a matching probe region.\n",
          },
        },
        age: "2y",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "storefront-dns-routing-notes", namespace: "storefront" },
        spec: {
          data: {
            "notes.md":
              "storefront.example.com uses geo-based DNS routing - requests from\nEuropean IP ranges resolve to the eu-west-1 deployment, and requests from\nAmerican IP ranges resolve to us-east-1. The us-east-1 deployment is\ncompletely healthy and unaffected by the current incident, which is\nisolated entirely to eu-west-1 (0 of 4 pods currently Ready there).\n",
          },
        },
        age: "2y",
      },
    ],
  },
  hints: [
    "`kubectl get configmap synthetics-config -n monitoring -o yaml` - which region(s) is this check actually probing from?",
    "`kubectl get configmap storefront-dns-routing-notes -n storefront -o yaml` - with geo-based DNS routing, does a probe from one region necessarily reach the deployment serving customers in a different region?",
    "A synthetic check probing exclusively from us-east-1, against a domain that geo-routes by requester location, will only ever exercise the us-east-1 deployment - no matter how badly eu-west-1 is failing.",
  ],
  options: [
    {
      id: "probe-only-covers-healthy-region",
      label:
        "The synthetic check's `probe_locations` only includes `us-east-1`, left over from before storefront-web expanded to `eu-west-1` eight months ago, and since the domain uses geo-based DNS routing, a probe from `us-east-1` always resolves to and exercises the healthy US deployment - it never reaches the eu-west-1 deployment at all, so a total outage isolated to eu-west-1 (0 of 4 pods Ready) is completely invisible to every check on the dashboard.",
      explanation:
        "`synthetics-config` shows `probe_locations: ['us-east-1']` only, with a note explaining eu-west-1 was added to the application's deployment regions without a corresponding probe region being added. `storefront-dns-routing-notes` confirms geo-based DNS routing means a US-origin probe always reaches the US deployment - which is genuinely healthy - never the failing eu-west-1 deployment (confirmed at 0 of 4 Ready pods). The synthetic checks have been accurately reporting on the only region they actually test; they were simply never configured to test the region that's currently down.",
    },
    {
      id: "synthetics-service-itself-degraded",
      label: "The third-party synthetics monitoring service itself is degraded and not actually running checks.",
      explanation:
        "There's no indication the synthetics service failed to run checks - the checks are running successfully and reporting green, which is consistent with genuinely healthy results from the one region they're configured to probe, not with a monitoring service failure.",
    },
    {
      id: "health-endpoint-doesnt-reflect-real-status",
      label: "storefront-web's `/health` endpoint doesn't accurately reflect whether the service can actually serve traffic.",
      explanation:
        "The health endpoint being checked isn't shown to be inaccurate - the eu-west-1 deployment is confirmed to have 0 of 4 pods Ready, which a reasonable health check would catch if it were actually being probed there. The gap is that no probe ever reaches eu-west-1 at all, not that the endpoint lies when it is reached.",
    },
    {
      id: "load-balancer-metrics-misconfigured",
      label: "eu-west-1's load balancer metrics are misconfigured and falsely reporting an outage that isn't real.",
      explanation:
        "The regional outage is independently confirmed via the region's own load balancer metrics and directly corroborated by the pod readiness status showing 0 of 4 Ready - there's no reason to doubt this signal; it's the synthetic checks, scoped to a different region entirely, that are failing to reflect it.",
    },
  ],
  correctOptionId: "probe-only-covers-healthy-region",
  resolution: `\`synthetics-config\` shows this check's \`probe_locations\` includes only
\`us-east-1\`, with a note explaining eu-west-1 was added to storefront-web's
actual deployment footprint eight months ago as part of a European
expansion, without anyone updating this synthetic check to add a matching
probe region. \`storefront-dns-routing-notes\` explains why that gap is
invisible on the dashboard: \`storefront.example.com\` uses geo-based DNS
routing, so a probe originating from \`us-east-1\` always resolves to and
tests the \`us-east-1\` deployment - which is genuinely, completely
healthy. It never has a way to reach the \`eu-west-1\` deployment, which is
independently confirmed to have 0 of 4 pods Ready and is the sole source
of the current outage.

The synthetic checks have been telling the truth the entire time - about
the one region they actually test. They were simply never configured to
test the region that's currently down, so a total regional outage
produces a dashboard that's 100% green, for as long as anyone's willing
to trust it without checking where the probes are actually coming from.

The fix is adding a probe location matching every region storefront-web
is actually deployed to, ideally one per DNS-routed region so each is
independently exercised:

\`\`\`yaml
checks:
  - name: storefront-web-uptime-us
    url: https://storefront.example.com/health
    probe_locations: ['us-east-1']
  - name: storefront-web-uptime-eu
    url: https://storefront.example.com/health
    probe_locations: ['eu-west-1']
\`\`\`

Any synthetic check against a geo-routed or multi-region endpoint needs
probe coverage that matches the deployment footprint, not just the
footprint from whenever the check was first set up - otherwise expanding
into a new region quietly creates a blind spot the exact size of that
region.`,
};
