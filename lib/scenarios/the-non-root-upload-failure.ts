import type { Scenario } from "./types";

export const theNonRootUploadFailure: Scenario = {
  id: "the-non-root-upload-failure",
  title: "The Non-Root Upload Failure",
  subtitle: "document-service's uploads have failed intermittently since the security hardening pass",
  difficulty: "medium",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 20,
  tags: ["java25", "security-context", "filesystem"],
  briefing: `A cluster-wide security hardening pass added \`runAsNonRoot: true\` to every
Deployment last week. Since then, "document-service" fails roughly one in
five file uploads with a generic 500 error - never the same upload twice,
no obvious pattern by file size or type.`,
  constraints: [
    "Every other endpoint on document-service (listing documents, downloading, metadata) works perfectly - only uploads are affected, and only some of the time.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "document-service", namespace: "documents", labels: { app: "document-service" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              securityContext: { runAsNonRoot: true, runAsUser: 1000 },
              containers: [{ name: "document-service", image: "registry.internal/document-service:5.5.0" }],
            },
          },
        },
        status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "document-service-3p4q5r6s7-t8u9v", namespace: "documents", labels: { app: "document-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "document-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "document-service": [
            "2026-09-15T13:00:01.204Z INFO  c.e.documents.UploadController - handling upload for contract-4471.pdf",
            "2026-09-15T13:00:01.311Z ERROR c.e.documents.UploadController - failed to write temp file for contract-4471.pdf",
            "java.io.FileNotFoundException: /usr/local/tomcat/work/Tomcat/localhost/ROOT/upload_a1b2c3.tmp (Permission denied)",
            "    at java.base/java.io.FileOutputStream.open0(Native Method)",
          ],
        },
        age: "7d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "document-service-notes", namespace: "documents" },
        spec: {
          data: {
            "notes.md":
              "The base image's Tomcat work directory (`/usr/local/tomcat/work`) was\ncreated and owned by root at image build time, from before this image\never ran as a non-root user. `runAsNonRoot`/`runAsUser: 1000` only\nchanges which user the *container process* runs as - it doesn't\nretroactively change ownership of files or directories already baked\ninto the image's filesystem layers.\n\nMost requests are served entirely in memory and never touch this\ndirectory, which is why only uploads (which briefly buffer to a temp\nfile on disk here) are affected, and why it's intermittent - it depends\non which pod handles a given request and whether that pod's specific\nfilesystem layer caching behaves consistently, but the underlying\nownership problem is the same on every pod.\n",
          },
        },
        age: "7d",
      },
    ],
  },
  hints: [
    "`kubectl logs document-service-3p4q5r6s7-t8u9v -n documents` - read the exception's exact message and path.",
    "`kubectl get deployment document-service -n documents -o yaml` - `securityContext.runAsUser: 1000` changes who the process runs *as*. Does it do anything to fix up ownership of directories the image already has baked in?",
    "`kubectl get configmap document-service-notes -n documents -o yaml` - who owns `/usr/local/tomcat/work` in the image, and why would that only affect uploads specifically?",
  ],
  options: [
    {
      id: "temp-directory-owned-by-root",
      label:
        "Tomcat's work directory was created owned by root when the base image was built, long before this image ever ran as a non-root user - `runAsNonRoot`/`runAsUser: 1000` changes which user the process runs as, but does nothing to change ownership of files already baked into the image, so the now-non-root process gets a permission denied trying to write its upload temp files there.",
      explanation:
        "The exception is explicit: `Permission denied` writing to `/usr/local/tomcat/work/.../upload_a1b2c3.tmp`. `document-service-notes` confirms that directory is root-owned from image build time, and that switching the *process*'s user via `runAsUser` has no effect on filesystem ownership already set in the image layers - those are two entirely separate things. It also explains the specific symptom pattern: most requests never touch disk at all and are unaffected, while uploads specifically need to write a temp file to that one root-owned directory, which is exactly where and only where the new non-root user gets rejected.",
    },
    {
      id: "upload-size-limit",
      label: "Some uploaded files exceed a configured max upload size.",
      explanation:
        "The failure isn't correlated with file size or type at all, and the actual exception is a filesystem permission error, not a size-limit rejection (which would typically be a distinct \"payload too large\" response, not a generic FileNotFoundException on a temp file write).",
    },
    {
      id: "disk-full",
      label: "The pod's ephemeral storage is full, so temp file writes fail.",
      explanation:
        "The exception is specifically `Permission denied`, not `No space left on device` - a full disk produces a different, distinct I/O error. This is an ownership/permissions problem, not a capacity problem.",
    },
    {
      id: "concurrent-upload-race-condition",
      label: "Concurrent uploads to the same temp filename are racing and overwriting each other.",
      explanation:
        "The temp filename includes a random component (`upload_a1b2c3.tmp`), making a collision between concurrent uploads extremely unlikely, and the actual failure reported is a permission error on file creation, not a corruption or overwrite symptom a race condition would typically produce.",
    },
  ],
  correctOptionId: "temp-directory-owned-by-root",
  resolution: `The exception says precisely what's wrong: \`Permission denied\` writing to
\`/usr/local/tomcat/work/Tomcat/localhost/ROOT/upload_a1b2c3.tmp\`.
\`document-service-notes\` explains the root cause (pun very much intended)
- that directory was created owned by \`root\` when the base image was
built, well before this image was ever expected to run as anything but
root. Adding \`runAsNonRoot: true\` / \`runAsUser: 1000\` to the Deployment's
\`securityContext\` changes which user ID the *container process* runs as
at runtime - it has no effect whatsoever on the ownership of files and
directories that were already baked into the image's filesystem layers
during the build. The now-non-root process hits a directory it doesn't
have write permission to, every time it needs to use it.

Most of document-service's endpoints never touch this directory at all
(handled entirely in memory), which is exactly why only uploads are
affected - and it looks maddeningly intermittent because it depends on
routing to a pod and hitting the code path that needs that specific
directory, even though the underlying ownership problem is identical and
constant on every single pod.

The fix belongs in the image build, fixing ownership at build time to
match the user the container will actually run as:

\`\`\`dockerfile
RUN mkdir -p /usr/local/tomcat/work && \\
    chown -R 1000:1000 /usr/local/tomcat/work
USER 1000
\`\`\`

Any security hardening pass that adds \`runAsNonRoot\`/\`runAsUser\` cluster-wide
needs to be paired with an audit of each image's own filesystem
permissions - the security context controls who the process *is*, not
who already owns what's sitting on disk inside the image.`,
};
