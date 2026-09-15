import type { Scenario } from "./types";

export const theExpiredPullSecret: Scenario = {
  id: "the-expired-pull-secret",
  title: "The Expired Pull Secret",
  subtitle: "a routine redeploy of search-indexer can't even get its image",
  difficulty: "easy",
  type: "fix",
  topic: "kubernetes",
  timeMinutes: 15,
  tags: ["kubernetes", "registry", "secrets"],
  briefing: `A routine redeploy of "search-indexer" - no code changes, just picking up
this week's base image patch - has left every new pod stuck instead of
running. The previous pods, still up from before the redeploy, are fine.
Nobody touched the registry or credentials on purpose.`,
  constraints: [
    "The image tag being pulled is confirmed to exist in the registry - this isn't a typo'd or missing tag.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "search-indexer", namespace: "search", labels: { app: "search-indexer" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              imagePullSecrets: [{ name: "internal-registry-creds" }],
              containers: [{ name: "search-indexer", image: "registry.internal/search-indexer:2026.09.15" }],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 1, availableReplicas: 2 },
        age: "18mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "search-indexer-9k0l1m2n3-o4p5q", namespace: "search", labels: { app: "search-indexer" } },
        status: { phase: "Pending", containerStatuses: [{ name: "search-indexer", ready: false, restartCount: 0, state: { waiting: { reason: "ImagePullBackOff" } } }] },
        events: [
          { type: "Warning", reason: "Failed", age: "3m", message: "Failed to pull image \"registry.internal/search-indexer:2026.09.15\": rpc error: code = Unknown desc = failed to authorize: 401 Unauthorized: authentication token has expired" },
          { type: "Warning", reason: "BackOff", age: "50s", message: "Back-off pulling image \"registry.internal/search-indexer:2026.09.15\"" },
        ],
        age: "4m",
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "internal-registry-creds", namespace: "search", annotations: { "creds.internal/rotated-at": "2026-03-01T00:00:00Z", "creds.internal/expires-at": "2026-09-01T00:00:00Z" } },
        spec: { type: "kubernetes.io/dockerconfigjson" },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl describe pod search-indexer-9k0l1m2n3-o4p5q -n search` - the `Failed` event names the exact HTTP status and reason for the pull failure.",
    "`401 Unauthorized: authentication token has expired` is about the credential used to pull, not the image itself.",
    "`kubectl get secret internal-registry-creds -n search -o yaml` - check its annotations for when it was rotated and when it expires, relative to today's date.",
  ],
  options: [
    {
      id: "expired-pull-secret",
      label:
        "The `internal-registry-creds` Secret's registry token expired on 2026-09-01, two weeks ago - existing pods that already pulled their image before then keep running fine (the kubelet doesn't re-check auth for a running container), but any new pod created since, including this redeploy, fails to pull with a 401 because the credential Kubernetes has on file for the registry is no longer valid.",
      explanation:
        "The event's exact text - \"401 Unauthorized: authentication token has expired\" - is an authentication failure, not a missing-image error. `internal-registry-creds`'s own annotations show `expires-at: 2026-09-01T00:00:00Z`, two weeks before today. The already-running pods are unaffected because their images were pulled successfully before expiry and don't need to re-authenticate to keep running - only *new* pull attempts, like this redeploy's, hit the now-expired credential.",
    },
    {
      id: "image-tag-does-not-exist",
      label: "The image tag `2026.09.15` was never actually pushed to the registry.",
      explanation:
        "The scenario states the tag is confirmed to exist, and more tellingly, the failure is an explicit `401 Unauthorized` authentication error - a genuinely missing tag would produce a 404 or \"not found\" style error instead, after authentication had already succeeded.",
    },
    {
      id: "wrong-secret-name-referenced",
      label: "The Deployment references an `imagePullSecrets` name that doesn't match any existing Secret.",
      explanation:
        "If the referenced Secret didn't exist at all, the error would be about a missing/unknown secret, not a 401 with \"authentication token has expired\" - the Secret is found and used, its contained credential is simply no longer valid.",
    },
    {
      id: "registry-outage",
      label: "The internal container registry is having an outage.",
      explanation:
        "A registry outage would typically show as a connection timeout or 5xx server error, not a specific 401 Unauthorized citing an expired authentication token - this is a credential problem, not an availability problem, and the registry is clearly responding to requests.",
    },
  ],
  correctOptionId: "expired-pull-secret",
  resolution: `The event text is explicit: \`401 Unauthorized: authentication token has
expired\`. \`internal-registry-creds\`'s own annotations confirm it -
\`expires-at: 2026-09-01T00:00:00Z\`, two weeks before today. The pods that
were already running pulled their image successfully before that date and
have no reason to re-authenticate just to keep running; it's only new
pull attempts - this redeploy's fresh pods - that hit the registry with a
credential it no longer accepts.

There's no live fix available from this read-only console, but the real
remediation is straightforward: generate a fresh registry credential and
update the Secret (most teams script this, since dockerconfigjson tokens
are usually rotated automatically well before expiry):

\`\`\`bash
kubectl create secret docker-registry internal-registry-creds \\
  --docker-server=registry.internal \\
  --docker-username=<svc-account> \\
  --docker-password=<fresh-token> \\
  -n search --dry-run=client -o yaml | kubectl apply -f -
\`\`\`

then retrigger the rollout so the pending pods retry the pull with valid
credentials. Longer term, this points at a gap in whatever rotates
\`internal-registry-creds\` automatically - it should never have been
allowed to sit two weeks past expiry before anyone noticed, and an
expiry-monitoring alert on registry credential Secrets would have caught
this well before a routine redeploy tripped over it.`,
};
