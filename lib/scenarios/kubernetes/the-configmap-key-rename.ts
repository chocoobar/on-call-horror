import type { Scenario } from "../types";

export const theConfigmapKeyRename: Scenario = {
  id: "the-configmap-key-rename",
  title: "The ConfigMap Key Rename",
  subtitle: "shipping-rates started quoting every US order the international rate, right after a cleanup PR",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "configmap", "deployment"],
  briefing: `A "harmless cleanup" PR renamed some inconsistently-cased keys in
"shipping-rates"'s ConfigMap for consistency (\`Rates_US.json\` to
\`rates-us.json\`, among others) alongside an unrelated small code change,
both reviewed and merged together. Since it deployed, every US order has
been quoted the (much higher) international shipping rate instead.`,
  constraints: [
    "shipping-rates' pods are all Running, Ready, and passing every health check - there's no crash or visible error anywhere in its own status.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "shipping-rates-config", namespace: "shipping" },
        spec: { data: { "rates-us.json": "{\"base\": 4.99}", "rates-intl.json": "{\"base\": 24.99}" } },
        age: "2h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "shipping-rates", namespace: "shipping", labels: { app: "shipping-rates" } },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ name: "shipping-rates", image: "registry.internal/shipping-rates:11.0.0", volumeMounts: [{ name: "config", mountPath: "/etc/rates" }] }], volumes: [{ name: "config", configMap: { name: "shipping-rates-config" } }] } },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "shipping-rates-4c5d6e7f8-g9h0i", namespace: "shipping", labels: { app: "shipping-rates" } },
        status: { phase: "Running", containerStatuses: [{ name: "shipping-rates", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "shipping-rates": [
            "2026-09-15T09:00:00.100Z WARN  rates.Loader - /etc/rates/Rates_US.json not found, US rate table unavailable",
            "2026-09-15T09:00:00.102Z INFO  rates.Loader - falling back to /etc/rates/rates-intl.json for all unmatched regions",
            "2026-09-15T09:00:00.110Z INFO  rates.Loader - loaded 1 rate table",
          ],
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "`kubectl logs shipping-rates-4c5d6e7f8-g9h0i -n shipping` - the app itself explains what it's doing and why, right at startup.",
    "`kubectl get configmap shipping-rates-config -n shipping -o yaml` - check the exact key names, character for character, against what the app's log says it's looking for.",
    "This is a ConfigMap *volume* mount, not a `subPath` - a whole directory of keys becomes files, but the app still needs to ask for the exact filename it expects.",
  ],
  options: [
    {
      id: "app-hardcoded-old-filename-key-renamed",
      label:
        "The cleanup PR renamed the ConfigMap key from `Rates_US.json` to `rates-us.json`, but shipping-rates' own code still looks for the file by its old, hardcoded name - the renamed key mounts fine as `rates-us.json`, but since nothing named `Rates_US.json` exists anymore, the app's own loader falls back to the international rate table for every region it can't find a specific match for, including the US, exactly as its own startup log describes.",
      explanation:
        "The pod's own log is explicit about both halves of the bug: \"Rates_US.json not found\" followed immediately by \"falling back to rates-intl.json for all unmatched regions.\" The ConfigMap's actual key is `rates-us.json` (renamed, lowercase, hyphenated) - the file is there, mounted correctly, just under a name the application's own code was never updated to look for. Because the app treats a missing rate file as \"fall back to international\" rather than erroring, this produced no crash and no visible health-check failure, just silently wrong pricing.",
    },
    {
      id: "configmap-volume-not-mounted",
      label: "The ConfigMap volume isn't actually mounted into the pod at all.",
      explanation:
        "The pod's own log confirms it successfully reads from `/etc/rates/` and does find *some* file there (`rates-intl.json`, which it falls back to) - the mount itself is clearly working; the problem is a specific filename mismatch between what changed in the ConfigMap and what the application code still expects.",
    },
    {
      id: "wrong-configmap-referenced-in-deployment",
      label: "The Deployment's volume references the wrong ConfigMap object entirely.",
      explanation:
        "There's only one `shipping-rates-config` ConfigMap, correctly referenced by name in the Deployment, and it does contain real, valid rate data (just under a renamed key) - the reference itself is correct, it's the application code's hardcoded filename expectation that's now stale relative to the renamed key.",
    },
    {
      id: "us-rate-data-itself-wrong",
      label: "The US rate data in the ConfigMap was accidentally set to the wrong value during the cleanup.",
      explanation:
        "The `rates-us.json` key does contain a correct, reasonable US rate value (`base: 4.99`) - the data itself wasn't corrupted or mis-set. The problem is that the application never actually reads this key at all under its new name, not that the value it contains is wrong.",
    },
  ],
  correctOptionId: "app-hardcoded-old-filename-key-renamed",
  resolution: `The pod's own startup log spells out exactly what happened: it looked for
\`Rates_US.json\`, didn't find it, and fell back to \`rates-intl.json\` for
every unmatched region - which, since it now has no US-specific match at
all, means every region, US included. The ConfigMap does contain valid,
correct rate data - just under the renamed key \`rates-us.json\`, per the
cleanup PR. The application's own code, though, still has the old
filename hardcoded, and was never updated to match the ConfigMap key
rename that shipped in the very same PR (reviewed alongside an unrelated
change, which likely made the connection between "renamed a key" and
"this specific piece of application code reads that key by name" easy to
miss). Because the loader treats a missing region-specific file as "fall
back gracefully" rather than raising an error, this produced clean pods,
passing health checks, and silently wrong pricing instead of any visible
failure.

The fix is updating the application's filename reference to match the
renamed key (or reverting the ConfigMap key rename, if that's faster
under time pressure):

\`\`\`java
// was: private static final String US_RATES_FILE = "Rates_US.json";
private static final String US_RATES_FILE = "rates-us.json";
\`\`\`

then a rebuild, redeploy, and a rollout restart to pick up the corrected
mapping. The deeper lesson: a ConfigMap key rename is never "just a
naming cleanup" if any application code references that key by exact
name - it's a coordinated change across two systems that happen to be
reviewed together but aren't type-checked against each other, and a
silent, non-erroring fallback path (however well-intentioned) is exactly
what let this ship without a single alarm going off.`,
};
