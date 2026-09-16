import type { Scenario } from "../types";

export const theMultipartSizeLimit: Scenario = {
  id: "the-multipart-size-limit",
  title: "The Multipart Size Limit",
  subtitle: "claims-intake-api rejects a chunk of legitimate photo uploads with a vague 500, no explanation",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 10,
  tags: ["java25", "spring-boot", "file-upload"],
  briefing: `"claims-intake-api" lets customers attach photos to insurance claims.
Since a marketing push encouraged higher-resolution photos, a growing
share of uploads fail with a generic 500 and no useful message to the
customer - always for the larger files, never the smaller ones.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "claims-intake-api", namespace: "insurance", labels: { app: "claims-intake-api" } },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "claims-intake-api", image: "registry.internal/claims-intake-api:1.5.0" }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "claims-intake-api-4f5g6h7i8-j9k0l", namespace: "insurance", labels: { app: "claims-intake-api" } },
        status: { phase: "Running", containerStatuses: [{ name: "claims-intake-api", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "claims-intake-api": [
            "2026-09-15T11:20:01.114Z WARN  o.a.tomcat.util.http.fileupload.impl.FileSizeLimitExceededException - The field 'photo' exceeds its maximum permitted size of 1048576 bytes.",
            "2026-09-15T11:20:01.116Z ERROR o.s.web.multipart.MaxUploadSizeExceededException - Maximum upload size exceeded",
            "2026-09-15T11:20:01.118Z ERROR c.e.insurance.ClaimsController - unhandled exception, returning generic 500",
          ],
        },
        age: "3d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "claims-intake-api-notes", namespace: "insurance" },
        spec: {
          data: {
            "application.yaml.excerpt":
              "spring:\n  servlet:\n    multipart:\n      max-file-size: 1MB   # Spring Boot's own default\n      max-request-size: 1MB\n",
            "notes.md":
              "1MB is Spring Boot's built-in default for both `max-file-size` and\n`max-request-size` when nothing is explicitly configured - it was never\nintentionally set for this service. Modern phone camera photos routinely\nexceed 3-5MB. `ClaimsController` has no `@ExceptionHandler` for\n`MaxUploadSizeExceededException`, so it falls through to the generic\nunhandled-exception path instead of a clear, actionable 413.",
          },
        },
        age: "3d",
      },
    ],
  },
  hints: [
    "`kubectl logs claims-intake-api-4f5g6h7i8-j9k0l -n insurance` - `FileSizeLimitExceededException` names the exact limit being hit: 1,048,576 bytes. Where does that number come from?",
    "`kubectl get configmap claims-intake-api-notes -n insurance -o yaml` - is `max-file-size` intentionally configured, or is this Spring Boot's own built-in default?",
    "A generic 500 instead of a clear 413 is a separate, smaller problem on top of the real one - is there an `@ExceptionHandler` anywhere for upload-size-exceeded errors?",
  ],
  options: [
    {
      id: "default-1mb-multipart-limit-too-small",
      label:
        "`spring.servlet.multipart.max-file-size` and `max-request-size` are both left at Spring Boot's built-in 1MB default, never intentionally configured for this service - and modern camera photos routinely exceed that, so every upload larger than 1MB throws `MaxUploadSizeExceededException`, which `ClaimsController` has no handler for and lets fall through to an unhelpful generic 500 instead of a clear, actionable error.",
      explanation:
        "The log shows the exact limit being hit: `exceeds its maximum permitted size of 1048576 bytes` - precisely 1MB, immediately followed by `MaxUploadSizeExceededException`. `claims-intake-api-notes` confirms `max-file-size: 1MB` is Spring Boot's own unmodified default, never deliberately set for a service that's supposed to accept photo uploads, and that there's no exception handler for this specific case, which is why customers see a generic 500 instead of a size-limit message.",
    },
    {
      id: "storage-backend-quota-exceeded",
      label: "The storage backend claims-intake-api uploads photos to has hit its quota.",
      explanation:
        "The failure happens entirely inside multipart parsing, before the request body is even fully read or handed off to any storage call - `FileSizeLimitExceededException` is thrown by the multipart upload handler itself, not by any downstream storage integration.",
    },
    {
      id: "network-timeout-on-large-uploads",
      label: "Larger file uploads are simply timing out over a slow network connection.",
      explanation:
        "The error is an explicit, immediate size-limit rejection (`exceeds its maximum permitted size`), not a timeout - there's no indication of a slow or stalled transfer, just files larger than a specific configured byte limit being rejected outright.",
    },
    {
      id: "claimscontroller-validation-bug",
      label: "ClaimsController has a validation bug specific to image file types.",
      explanation:
        "The rejection happens at the multipart parsing layer before any controller-level validation logic runs at all - `ClaimsController`'s only role here is failing to handle the resulting exception gracefully, not causing the rejection itself.",
    },
  ],
  correctOptionId: "default-1mb-multipart-limit-too-small",
  resolution: `The log names the exact number being enforced: \`exceeds its maximum
permitted size of 1048576 bytes\` - exactly 1MB - immediately followed by
Spring's own \`MaxUploadSizeExceededException\`. \`claims-intake-api-notes\`
confirms that 1MB isn't a deliberate business decision for this service at
all; it's simply Spring Boot's unmodified built-in default for
\`max-file-size\` and \`max-request-size\`, left untouched since the service
was scaffolded. Modern phone camera photos routinely land in the 3-5MB
range, so any upload above that quiet 1MB ceiling fails outright.

The second, smaller problem compounds the first: \`ClaimsController\` has
no \`@ExceptionHandler\` for \`MaxUploadSizeExceededException\`, so instead
of a clear, actionable 413 Payload Too Large, the exception falls through
to a generic unhandled-exception path and returns an unhelpful 500 -
leaving customers with no idea their photo was simply too big.

Both are worth fixing together:

\`\`\`yaml
spring:
  servlet:
    multipart:
      max-file-size: 10MB
      max-request-size: 12MB
\`\`\`

\`\`\`java
@ExceptionHandler(MaxUploadSizeExceededException.class)
public ResponseEntity<ErrorResponse> handleTooLarge(MaxUploadSizeExceededException ex) {
    return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
        .body(new ErrorResponse("photo exceeds the 10MB upload limit"));
}
\`\`\`

Spring Boot's multipart defaults are conservative on purpose - any service
that accepts real-world file uploads (photos, documents, attachments)
needs to explicitly size that limit for what its actual users will send,
and needs a real error handler so a limit being hit produces a useful
message instead of a bare 500.`,
};
