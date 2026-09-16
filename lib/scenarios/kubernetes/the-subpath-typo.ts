import type { Scenario } from "../types";

export const theSubpathTypo: Scenario = {
  id: "the-subpath-typo",
  title: "The subPath Typo",
  subtitle: "feature-gateway is running with zero feature flags configured, and no one changed anything",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "volumes", "configmap"],
  briefing: `"feature-gateway" reads its flag definitions from a mounted file at
startup. After today's otherwise-unremarkable manifest cleanup (renaming
a few labels for consistency, nothing functional intended), it's booting
with every flag defaulting to off - as if the config file it reads is
completely empty.`,
  constraints: [
    "The ConfigMap that's supposed to back this mount is confirmed to still contain the correct, full flag data.",
  ],
  world: {
    resources: [
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "feature-gateway-config", namespace: "platform" },
        spec: { data: { "flags.json": "{\"new-checkout\": true, \"dark-mode\": true, \"beta-search\": false}" } },
        age: "3h",
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "feature-gateway", namespace: "platform", labels: { app: "feature-gateway" } },
        spec: {
          replicas: 2,
          template: {
            spec: {
              containers: [
                {
                  name: "feature-gateway",
                  image: "registry.internal/feature-gateway:1.2.0",
                  volumeMounts: [{ name: "config", mountPath: "/etc/feature-gateway/flags.json", subPath: "flag.json" }],
                },
              ],
              volumes: [{ name: "config", configMap: { name: "feature-gateway-config" } }],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "feature-gateway-3q4r5s6t7-u8v9w", namespace: "platform", labels: { app: "feature-gateway" } },
        status: { phase: "Running", containerStatuses: [{ name: "feature-gateway", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "feature-gateway": [
            "2026-09-15T09:00:01.100Z WARN  gateway.FlagLoader - /etc/feature-gateway/flags.json not found or unreadable, defaulting all flags to false",
            "2026-09-15T09:00:01.102Z INFO  gateway.FlagLoader - loaded 0 flag definitions",
          ],
        },
        age: "3h",
      },
    ],
  },
  hints: [
    "`kubectl logs feature-gateway-3q4r5s6t7-u8v9w -n platform` - the app itself says the file it's looking for isn't found.",
    "`kubectl get deployment feature-gateway -n platform -o yaml` - compare `volumeMounts[].subPath` character-by-character against the actual key name in the ConfigMap's `data`.",
    "A `subPath` mount only exposes the one key whose name it exactly matches - if there's no key with that exact name, the mounted path simply doesn't exist, silently.",
  ],
  options: [
    {
      id: "subpath-key-typo",
      label:
        "The volumeMount's `subPath` is `flag.json` (singular), but the ConfigMap's actual key is `flags.json` (plural) - a subPath mount only exposes the single key whose name matches exactly, so with no matching key, the path `/etc/feature-gateway/flags.json` inside the container simply doesn't exist, and the app's own startup code correctly treats that as \"no config found\" and defaults everything off.",
      explanation:
        "The app's own log is direct: \"flags.json not found or unreadable, defaulting all flags to false.\" The Deployment's `subPath: flag.json` doesn't match the ConfigMap's actual key, `flags.json` - off by one letter. A `subPath` mount doesn't fail loudly on a non-matching key; it just results in nothing being mounted at that path, which the app correctly (if silently, from an operator's perspective) interprets as a missing config file.",
    },
    {
      id: "configmap-not-updated",
      label: "The ConfigMap's flag data itself wasn't updated with today's intended values.",
      explanation:
        "The scenario confirms the ConfigMap still holds the correct, full flag data (`new-checkout`, `dark-mode`, `beta-search` all present with real values) - the ConfigMap's content isn't the problem. The mount path referencing it is what's broken.",
    },
    {
      id: "wrong-configmap-referenced",
      label: "The Deployment's volume references an entirely different, empty ConfigMap.",
      explanation:
        "The volume's `configMap.name` correctly points at `feature-gateway-config`, the same ConfigMap that contains the real flag data - the reference itself is right, it's the `subPath` narrowing which single key gets mounted that's broken.",
    },
    {
      id: "app-json-parsing-bug",
      label: "There's a bug in feature-gateway's JSON parsing that fails silently on valid input.",
      explanation:
        "The app's log says the file itself was \"not found or unreadable\" - it never got as far as attempting to parse any JSON content, because no file exists at the mounted path in the first place. This is a missing-file condition, not a parsing failure.",
    },
  ],
  correctOptionId: "subpath-key-typo",
  resolution: `feature-gateway's own log gives the exact missing path: "flags.json not
found or unreadable." The Deployment's \`volumeMounts[].subPath\` is set to
\`flag.json\` - singular - while the ConfigMap's actual key is \`flags.json\`,
plural, an easy typo to introduce during a "harmless" manifest cleanup.
A \`subPath\` mount is exact-match only: it takes one specific key from the
ConfigMap and projects it at the mount path, and if no key matches that
name, nothing gets mounted there at all - no error, no event, just an
absent file that the app then has to interpret on its own. Here the app
did the responsible thing and defaulted safely to all-flags-off, which
is exactly why this looked like a "successful" deploy with healthy pods
rather than an obvious crash.

The fix is a one-character correction to the subPath:

\`\`\`yaml
volumeMounts:
  - name: config
    mountPath: /etc/feature-gateway/flags.json
    subPath: flags.json   # was: flag.json
\`\`\`

followed by a rollout to pick it up. \`subPath\` typos are a classic
silent-failure trap precisely because both the ConfigMap and the
Deployment individually look completely valid - there's no cross-object
validation checking that a subPath actually matches a real key, so the
mismatch only surfaces once something notices the *application's*
resulting behavior, not the Kubernetes objects themselves.`,
};
