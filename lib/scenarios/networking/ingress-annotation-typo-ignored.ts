import type { Scenario } from "../types";

export const ingressAnnotationTypoIgnored: Scenario = {
  id: "ingress-annotation-typo-ignored",
  title: "The Annotation Nobody Noticed Was Ignored",
  subtitle: "the config review approved a longer timeout. production never got it.",
  difficulty: "easy",
  type: "fix",
  topic: "networking",
  timeMinutes: 10,
  tags: ["ingress", "annotations", "nginx"],
  briefing: `A teammate added an annotation to "media-transcoder"'s Ingress last week to
raise its proxy read timeout from the default 60 seconds to 300, for a new
long-running transcode-status endpoint. The PR was approved and merged.
Transcode-status calls are still timing out at almost exactly 60 seconds,
as if the change was never applied at all.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "media-transcoder", namespace: "media", labels: { app: "media-transcoder" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "9d",
      },
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: "media-transcoder",
          namespace: "media",
          annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "nginx.ingress.kubernetes.io/proxy-read-timout": "300",
          },
        },
        spec: {
          rules: [{ host: "media.example.com", http: { paths: [{ path: "/transcode-status", pathType: "Prefix", backend: { service: { name: "media-transcoder", port: { number: 80 } } } }] } }],
        },
        age: "6d",
        events: [
          { type: "Warning", reason: "UpstreamTimeout", age: "8m", message: "upstream timed out (110: Connection timed out) while reading response header from upstream, upstream timeout: 60s" },
        ],
      },
    ],
  },
  hints: [
    "`kubectl get ingress media-transcoder -n media -o yaml` and read the annotation key character by character - not just its value.",
    "nginx ingress controller annotations are exact string matches - an unrecognized annotation key is silently ignored, not rejected with an error.",
    "Compare the annotation's key against the documented annotation name (`nginx.ingress.kubernetes.io/proxy-read-timeout`) letter for letter.",
  ],
  options: [
    {
      id: "annotation-key-typo-timout",
      label:
        "The annotation is spelled `nginx.ingress.kubernetes.io/proxy-read-timout` - missing the 'e' in 'timeout' - which the ingress controller doesn't recognize as any known annotation, so it's silently ignored entirely and the controller falls back to its 60-second default, exactly matching the still-failing behavior.",
      explanation:
        "Reading the annotation key character by character shows `proxy-read-timout`, not the correct `proxy-read-timeout` - a one-letter typo. The nginx ingress controller doesn't validate or error on unrecognized annotation keys; it simply doesn't act on them, which is why the merged PR had zero effect and the Ingress's own event log still shows the default 60-second timeout being hit.",
    },
    {
      id: "ingress-controller-not-reloaded",
      label: "The ingress controller needs a manual restart to pick up new annotations, and nobody restarted it.",
      explanation:
        "nginx ingress controllers watch for annotation changes and reload their configuration automatically, without needing a manual restart - and even if a reload were somehow delayed, six days is far more than enough time for it to have taken effect by any reasonable margin.",
    },
    {
      id: "wrong-ingress-object-edited",
      label: "The change was made to a different, unused Ingress object instead of this one.",
      explanation:
        "The annotation (albeit misspelled) is present directly on `media-transcoder`'s actual Ingress object, in the same namespace serving the real traffic - the change did land on the correct resource, it just isn't a key the ingress controller recognizes.",
    },
    {
      id: "media-transcoder-app-level-timeout",
      label: "media-transcoder's own application has a hardcoded 60-second internal timeout.",
      explanation:
        "The failure is confirmed at the ingress layer - the Ingress's own `UpstreamTimeout` event explicitly states the ingress controller itself gave up waiting for a response at 60 seconds, which is the nginx ingress controller's own default, not an application-level timeout.",
    },
  ],
  correctOptionId: "annotation-key-typo-timout",
  resolution: `The annotation on \`media-transcoder\`'s Ingress reads
\`nginx.ingress.kubernetes.io/proxy-read-timout\` - missing the 'e' in
"timeout". The nginx ingress controller only acts on annotation keys it
specifically recognizes; anything else, including a near-miss typo like
this one, is silently ignored with no warning or error surfaced anywhere.
The controller falls back to its default 60-second \`proxy-read-timeout\`,
which is exactly what its own \`UpstreamTimeout\` event confirms is still
being hit, six days after the "fix" was merged and deployed.

The fix is correcting the key itself:

\`\`\`yaml
metadata:
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
\`\`\`

Because nginx ingress controller annotations fail silently on a typo
rather than erroring the resource, it's worth verifying a timeout (or
any other annotation-driven behavior) change actually took effect by
testing the real behavior after deploy - a merged PR and code review
approval confirm the *intent* landed, not that the annotation key itself
was spelled correctly enough for the controller to ever act on it.`,
};
