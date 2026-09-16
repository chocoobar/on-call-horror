import type { Scenario } from "../types";

export const theInitContainerRace: Scenario = {
  id: "the-init-container-race",
  title: "The Init Container Race",
  subtitle: "billing-worker starts fine about half the time, and fails with a missing file the other half",
  difficulty: "medium",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 20,
  tags: ["kubernetes", "init-containers", "startup"],
  briefing: `"billing-worker" was recently given two init containers - one to fetch a
signing key from a secrets vault into a shared volume, another to warm a
local cache from that same volume. Roughly half the time pods start fine.
The other half, the main container crashes immediately complaining the
signing key file doesn't exist yet.`,
  constraints: [
    "Both init containers are confirmed to individually succeed every single time they run - neither one ever errors out or times out on its own.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "billing-worker", namespace: "billing", labels: { app: "billing-worker" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              initContainers: [
                { name: "warm-cache", image: "registry.internal/cache-warmer:1.0.0", volumeMounts: [{ name: "shared", mountPath: "/shared" }] },
                { name: "fetch-signing-key", image: "registry.internal/vault-fetcher:2.0.0", volumeMounts: [{ name: "shared", mountPath: "/shared" }] },
              ],
              containers: [{ name: "billing-worker", image: "registry.internal/billing-worker:9.9.0", volumeMounts: [{ name: "shared", mountPath: "/shared" }] }],
              volumes: [{ name: "shared", emptyDir: {} }],
            },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 3, availableReplicas: 1 },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "billing-worker-6u7v8w9x0-y1z2a", namespace: "billing", labels: { app: "billing-worker" } },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "billing-worker", ready: false, restartCount: 3, state: { waiting: { reason: "CrashLoopBackOff" } } }],
          initContainerStatuses: [
            { name: "warm-cache", ready: true, state: { terminated: { reason: "Completed", exitCode: 0 } } },
            { name: "fetch-signing-key", ready: true, state: { terminated: { reason: "Completed", exitCode: 0 } } },
          ],
        },
        logs: { "billing-worker": ["2026-09-15T09:00:00.100Z FATAL key.Loader - /shared/signing.key: no such file or directory"] },
        age: "2d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "billing-worker-init-order-notes", namespace: "billing" },
        spec: {
          data: {
            "notes.md":
              "Init containers run strictly in the order listed in `initContainers[]`,\none at a time, each waiting for the previous to finish. This Deployment\nlists `warm-cache` first and `fetch-signing-key` second - but `warm-cache`\nactually reads and indexes whatever files already exist in /shared at\nthe time *it* runs, expecting the signing key to already be there from a\nprevious version of this manifest where fetch order was reversed. Both\ncontainers individually succeed regardless of order (warm-cache doesn't\nerror if the key file is absent, it just doesn't index it), but only one\norder actually leaves the key present in time for the main container.\n",
          },
        },
        age: "2d",
      },
    ],
  },
  hints: [
    "`kubectl get pod billing-worker-6u7v8w9x0-y1z2a -n billing -o yaml` - check `initContainerStatuses` order and both exit codes closely. Do they both actually succeed?",
    "Init containers don't run in parallel - they run strictly in the order listed in `initContainers[]`. Which one runs first here, and does that order make sense for what each one needs?",
    "`warm-cache` succeeding doesn't necessarily mean it did everything the main container needs - it might just mean it didn't error on an empty input.",
  ],
  options: [
    {
      id: "init-containers-in-wrong-order",
      label:
        "billing-worker's init containers are listed in the wrong order - `warm-cache` runs first and expects the signing key to already be in /shared to index it, but `fetch-signing-key` (which actually creates that file) runs second - `warm-cache` doesn't error when the key is missing, it just silently skips indexing it, so both init containers report success either way, but only when the key genuinely lands before the main container starts does billing-worker actually find it, which happens inconsistently depending on unrelated timing.",
      explanation:
        "Both init containers show `Completed, exitCode: 0` - genuinely succeeding every time, exactly as the scenario's own constraint states, which is why this doesn't look like a straightforward init container failure. `billing-worker-init-order-notes` explains the real bug: init containers run strictly in listed order, and this manifest has `warm-cache` before `fetch-signing-key`, backwards from what `warm-cache` actually expects (the signing key already present). Since `warm-cache` tolerates the key's absence without erroring, the ordering bug never surfaces as an init container failure - it only surfaces later, intermittently, as the main container failing to find a file that init `fetch-signing-key` does eventually create, just one step too late relative to when warm-cache needed it.",
    },
    {
      id: "vault-fetcher-intermittent-failure",
      label: "fetch-signing-key intermittently fails to actually write the key file, despite reporting success.",
      explanation:
        "The scenario explicitly confirms both init containers succeed every single time they run, with no evidence of a silent write failure - the actual problem is the relative *order* the two containers run in, not the reliability of either one individually.",
    },
    {
      id: "emptydir-not-shared-correctly",
      label: "The `shared` emptyDir volume isn't actually being shared between the init containers and the main container.",
      explanation:
        "All three containers mount the same `shared` volume name at the same path, and emptyDir volumes are shared correctly across every container (init and main) in a pod by design - there's no indication the volume itself is misconfigured or not actually shared, just that a file expected to exist by the time the main container starts sometimes isn't there yet.",
    },
    {
      id: "main-container-race-condition-with-itself",
      label: "billing-worker's own startup code has a race condition reading the file too early.",
      explanation:
        "Init containers are guaranteed to fully complete, one after another in order, before the main container starts at all - there's no race between the main container's startup and any init container by Kubernetes' own execution model. The inconsistency comes from which init container runs first relative to what each one needs, not from timing within the main container itself.",
    },
  ],
  correctOptionId: "init-containers-in-wrong-order",
  resolution: `Both init containers genuinely succeed every time - \`Completed, exitCode:
0\` for both, which is exactly why this doesn't present as an obvious
init-container failure. \`billing-worker-init-order-notes\` explains the
real bug: init containers run strictly in the order listed in
\`initContainers[]\`, and this manifest lists \`warm-cache\` before
\`fetch-signing-key\`. But \`warm-cache\` expects the signing key to already
be present in \`/shared\` so it can index it - a leftover assumption from
an earlier version of the manifest where the order was reversed.
\`fetch-signing-key\`, which actually creates that file, now runs *second*.
Since \`warm-cache\` doesn't error when the key is absent (it just skips
indexing it silently), neither init container ever reports a failure -
the bug only ever surfaces downstream, as the main container
intermittently finding the key file already there (lucky timing from a
previous pod incarnation's leftover state on a reused node, or simple
inconsistency in how the failure was being investigated) or not.

The fix is simply reordering the init containers to match their actual
dependency:

\`\`\`yaml
initContainers:
  - name: fetch-signing-key
    image: registry.internal/vault-fetcher:2.0.0
    volumeMounts: [{ name: shared, mountPath: /shared }]
  - name: warm-cache
    image: registry.internal/cache-warmer:1.0.0
    volumeMounts: [{ name: shared, mountPath: /shared }]
\`\`\`

This is a good argument for making \`warm-cache\` fail loudly (non-zero
exit) if a file it expects to index is missing, rather than silently
skipping it - a hard failure at the init-container stage, tied directly
to a real dependency, would have surfaced this bug immediately and
consistently instead of as a confusing, intermittent main-container
crash days after the ordering bug was introduced.`,
};
