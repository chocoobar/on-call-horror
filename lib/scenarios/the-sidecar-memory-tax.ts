import type { Scenario } from "./types";

export const theSidecarMemoryTax: Scenario = {
  id: "the-sidecar-memory-tax",
  title: "The Sidecar Memory Tax",
  subtitle: "catalog-service gets OOMKilled right after MaxRAMPercentage was 'fixed' to be container-aware",
  difficulty: "easy",
  type: "fix",
  topic: "spring-boot",
  timeMinutes: 15,
  tags: ["java25", "containers", "memory"],
  briefing: `Last week someone replaced "catalog-service"'s hardcoded \`-Xmx\` with the
recommended \`-XX:MaxRAMPercentage=75.0\`, expecting it to finally behave
well inside its container. Instead it now gets OOMKilled *more* often than
before, always within a few minutes of a deploy while the JVM is still
warming up caches and compiling hot paths.`,
  constraints: [],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "catalog-service", namespace: "storefront", labels: { app: "catalog-service" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "catalog-service",
                  image: "registry.internal/catalog-service:5.0.1",
                  env: [{ name: "JAVA_TOOL_OPTIONS", value: "-XX:MaxRAMPercentage=75.0" }],
                  resources: { requests: { memory: "1Gi" }, limits: { memory: "1Gi" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "catalog-service-3f4g5h6i7-j8k9l", namespace: "storefront", labels: { app: "catalog-service" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "catalog-service",
              ready: true,
              restartCount: 5,
              state: { running: {} },
              lastState: { terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-15T08:00:00Z", finishedAt: "2026-09-15T08:03:41Z" } },
            },
          ],
        },
        events: [
          { type: "Warning", reason: "OOMKilling", age: "9m", message: "Memory cgroup out of memory: Killed process (java) total-vm:1210344kB, anon-rss:1046200kB" },
        ],
        logs: {
          "catalog-service": [
            "2026-09-15T08:03:38.110Z INFO  o.s.b.w.embedded.tomcat.TomcatWebServer - Tomcat started on port 8080",
            "2026-09-15T08:03:39.004Z INFO  c.e.catalog.WarmCache - loading full product catalog into local cache, 480000 entries",
          ],
        },
        age: "1d",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "catalog-service-notes", namespace: "storefront" },
        spec: {
          data: {
            "notes.md":
              "`-XX:MaxRAMPercentage=75.0` only bounds the *Java heap* - it says nothing\nabout Metaspace, thread stacks, JIT code cache, or direct/native buffers,\nall of which live outside the heap in the same container. On a 1Gi\nlimit, 75% heap leaves only ~256Mi for everything else, and `WarmCache`\nloads the entire product catalog into a large in-memory structure right\nat startup, on top of whatever Metaspace and thread-stack overhead a\nfreshly started, still-JIT-warming Tomcat process needs.",
          },
        },
        age: "1d",
      },
    ],
  },
  hints: [
    "`kubectl describe pod catalog-service-3f4g5h6i7-j8k9l -n storefront` - the OOM event's `anon-rss` is very close to the full container `limit`, not just the heap portion of it.",
    "`kubectl logs catalog-service-3f4g5h6i7-j8k9l -n storefront` - what is `WarmCache` doing right when the crash happens, and how does that interact with 75% of a 1Gi container already being reserved for heap alone?",
    "`kubectl get configmap catalog-service-notes -n storefront -o yaml` - MaxRAMPercentage governs heap only. What else needs room in the same container?",
  ],
  options: [
    {
      id: "max-ram-percentage-too-high-for-non-heap-needs",
      label:
        "`-XX:MaxRAMPercentage=75.0` on a small 1Gi container only leaves ~256Mi for everything that isn't heap - Metaspace, thread stacks, JIT code cache, and the large in-memory catalog `WarmCache` builds at startup - so a normal startup-time memory spike is enough to push total container memory past the 1Gi limit and trigger an OOMKill, even though the heap itself never overflows.",
      explanation:
        "The OOM event shows `anon-rss:1046200kB`, essentially the entire 1Gi container limit, at the exact moment `WarmCache` is loading 480,000 entries into memory right after startup. `catalog-service-notes` explains why: `MaxRAMPercentage` only bounds heap, leaving a fixed ~25% of the container for Metaspace, thread stacks, JIT code cache, and any large native/direct allocations - and a startup-time cache warm plus a still-JIT-warming process is exactly when non-heap overhead is highest. On a small 1Gi container that headroom is only ~256Mi, which isn't enough.",
    },
    {
      id: "percentage-flag-not-container-aware",
      label: "`-XX:MaxRAMPercentage` doesn't actually detect the container's memory limit correctly.",
      explanation:
        "`MaxRAMPercentage` is specifically the container-aware sizing flag and is working as designed here - the OOM event's RSS figure is consistent with heap being sized correctly at 75% of 1Gi; the problem is that 75% leaves too little room for everything else running in the same container, not that the flag failed to detect the limit.",
    },
    {
      id: "warmcache-should-be-lazy-not-memory-related",
      label: "WarmCache eagerly loading the whole catalog at startup is simply bad design, unrelated to memory sizing.",
      explanation:
        "Eager loading is a real design smell worth revisiting, but the immediate incident is a memory ceiling problem - the OOM event's RSS lines up with the container limit at the exact moment of that eager load, meaning the sizing headroom, not the loading strategy by itself, is what's missing.",
    },
    {
      id: "too-many-replicas-competing-for-node-memory",
      label: "Three replicas on the same node are competing for memory and starving each other.",
      explanation:
        "The container's own `limits.memory: 1Gi` is a hard per-container cgroup ceiling enforced regardless of what else runs on the node - the kill event shows this single container's own RSS hitting its own 1Gi limit, not node-level memory pressure from sibling pods.",
    },
  ],
  correctOptionId: "max-ram-percentage-too-high-for-non-heap-needs",
  resolution: `The OOM kill event's \`anon-rss:1046200kB\` is essentially the entire 1Gi
container limit, and it happens right as \`WarmCache\` is loading the full
480,000-entry product catalog into memory moments after Tomcat starts.
\`catalog-service-notes\` explains the mechanism: \`MaxRAMPercentage\` only
governs the *Java heap* ceiling - it has no concept of Metaspace, thread
stacks, JIT code cache, or any native/direct buffers the process also
needs, all of which share the same container memory budget. At 75% of a
1Gi limit, heap alone can claim up to ~768Mi, leaving only ~256Mi for
everything else - and a freshly started process still JIT-compiling hot
paths, on top of a large eager in-memory cache load, is exactly the
moment non-heap memory use peaks.

The fix is lowering the heap percentage to leave real headroom for
non-heap memory, and giving the container more total room to work with if
the catalog cache is going to keep growing:

\`\`\`yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-XX:MaxRAMPercentage=60.0 -XX:MaxMetaspaceSize=128m"
resources:
  limits:
    memory: 1536Mi
\`\`\`

Sizing heap as a percentage of the container limit is still the right
approach over a hardcoded \`-Xmx\` - it just needs to leave enough of that
budget unclaimed for everything else living in the same cgroup, especially
on small containers where the non-heap overhead is a much bigger fraction
of the total.`,
};
