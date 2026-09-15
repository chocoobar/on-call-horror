import type { Scenario } from "./types";

export const theCacheThatForgot: Scenario = {
  id: "the-cache-that-forgot",
  title: "The Cache That Forgot",
  subtitle: "session-service's in-memory cache keeps growing and never seems to hit",
  difficulty: "hard",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 25,
  tags: ["java25", "hashmap", "memory-leak"],
  briefing: `"session-service" keeps a small in-memory cache of active user sessions
to avoid hitting the database on every request. It's been running fine
for months. Over the last two weeks, heap usage has crept up steadily
until pods start getting OOMKilled every couple of days - and cache hit
rate, which used to sit around 90%, has quietly dropped to almost zero
over the same period.`,
  constraints: [
    "Traffic and active user counts haven't meaningfully changed in this window - whatever's growing, it isn't proportional to real usage.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-service", namespace: "sessions", labels: { app: "session-service" } },
        spec: {
          replicas: 3,
          template: {
            spec: {
              containers: [
                {
                  name: "session-service",
                  image: "registry.internal/session-service:6.4.0",
                  env: [{ name: "JAVA_TOOL_OPTIONS", value: "-Xmx1g" }],
                  resources: { limits: { memory: "1536Mi" } },
                },
              ],
            },
          },
        },
        status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "session-service-4c5d6e7f8-g9h0i", namespace: "sessions", labels: { app: "session-service" } },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "session-service",
              ready: true,
              restartCount: 6,
              state: { running: { startedAt: "2026-09-15T02:00:00Z" } },
              lastState: {
                terminated: {
                  reason: "OOMKilled",
                  exitCode: 137,
                  startedAt: "2026-09-13T14:00:00Z",
                  finishedAt: "2026-09-15T01:59:58Z",
                },
              },
            },
          ],
        },
        events: [
          { type: "Warning", reason: "BackOff", age: "5h", message: "Back-off restarting failed container session-service in pod session-service-4c5d6e7f8-g9h0i_sessions" },
        ],
        logs: {
          "session-service": [
            "2026-09-15T09:00:01.204Z DEBUG c.e.sessions.SessionCache - cache size=418302, hit rate (5m)=1.8%",
            "2026-09-15T09:05:01.209Z DEBUG c.e.sessions.SessionCache - cache size=421977, hit rate (5m)=1.6%",
            "2026-09-15T09:10:01.415Z DEBUG c.e.sessions.SessionCache - cache size=425510, hit rate (5m)=1.9%",
          ],
        },
        age: "3w",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "session-service-changelog", namespace: "sessions" },
        spec: {
          data: {
            "CHANGELOG.md":
              "### v6.4.0 (deployed two weeks ago)\n- Added `lastAccessedAt` tracking directly on the session key object, so\n  we can log how stale a cache entry was on eviction. No changes to the\n  cache's max-size or eviction policy.\n",
            "SessionKey.java.excerpt":
              "public final class SessionKey {\n    private final String sessionId;\n    private Instant lastAccessedAt;   // added in v6.4.0, mutated on every read\n\n    public SessionKey(String sessionId) {\n        this.sessionId = sessionId;\n        this.lastAccessedAt = Instant.now();\n    }\n\n    public void touch() {\n        this.lastAccessedAt = Instant.now();\n    }\n\n    @Override\n    public boolean equals(Object o) {\n        if (!(o instanceof SessionKey other)) return false;\n        return sessionId.equals(other.sessionId)\n            && lastAccessedAt.equals(other.lastAccessedAt);\n    }\n\n    @Override\n    public int hashCode() {\n        return Objects.hash(sessionId, lastAccessedAt);\n    }\n}\n",
          },
        },
        age: "2w",
      },
    ],
  },
  hints: [
    "`kubectl get configmap session-service-changelog -n sessions -o yaml` - look at what fields `SessionKey.equals()` and `hashCode()` actually use.",
    "`touch()` mutates `lastAccessedAt` on every read - and `lastAccessedAt` is part of both `equals()` and `hashCode()`. What happens to a `HashMap` entry when a key object's hash code changes after it's already been inserted?",
    "A `HashMap` decides which internal bucket a key lives in based on its `hashCode()` *at insertion time*. If that same key's `hashCode()` returns something different later, looking it up again computes a different bucket - the entry isn't in the bucket the map goes looking for anymore, but it's still sitting in memory, unreachable and un-evictable.",
  ],
  options: [
    {
      id: "mutable-hashcode-key",
      label:
        "`SessionKey.hashCode()` includes `lastAccessedAt`, which is mutated by `touch()` on every read - once a key's hash code changes after it's already stored, the `HashMap` can no longer find it at its original bucket. Every 'read' effectively orphans the existing entry and inserts a fresh one under the new hash, so the cache never actually hits and grows forever with unreachable entries that never get evicted.",
      explanation:
        "`SessionKey.java.excerpt` shows `lastAccessedAt` is part of both `equals()` and `hashCode()`, and `touch()` mutates it on every access - which the v6.4.0 changelog confirms was added two weeks ago, lining up exactly with when the symptoms started. A `HashMap` places a key in a bucket based on its hash code at insertion time; if that same object's hash code changes afterward, a later lookup with an 'equal' key computes a different bucket and finds nothing there, so it's treated as a cache miss and re-inserted as a new entry. The original entry is still referenced by the map's internal bucket array - it's not garbage, it's just permanently unreachable by lookup - so the cache only ever grows, hit rate collapses toward zero, and heap usage climbs until the container gets OOMKilled.",
    },
    {
      id: "cache-max-size-too-high",
      label: "The cache's configured max size is simply too high for the container's memory budget.",
      explanation:
        "The changelog explicitly notes no change to the cache's max-size or eviction policy in this release - and a correctly-functioning bounded cache wouldn't show hit rate collapsing toward zero, only wouldn't-fit-everything eviction pressure. The hit-rate crash is the tell that entries aren't being found at all, not just evicted too eagerly.",
    },
    {
      id: "increased-active-users",
      label: "A recent spike in active users is simply outgrowing the cache's capacity.",
      explanation:
        "Traffic and active user counts haven't materially changed in this window - the cache size and memory usage are growing independent of real usage, which points at something structural in how entries are stored rather than organic growth in the number of sessions to cache.",
    },
    {
      id: "gc-not-collecting-cache",
      label: "The garbage collector isn't collecting evicted cache entries promptly enough.",
      explanation:
        "These entries aren't eligible for garbage collection at all - they're still strongly referenced by the `HashMap`'s internal structure, just unreachable via lookup. No GC algorithm can free memory that's still reachable from a live reference, which is exactly the situation a broken `hashCode()` contract creates.",
    },
  ],
  correctOptionId: "mutable-hashcode-key",
  resolution: `\`SessionKey.java.excerpt\` shows the v6.4.0 change: \`lastAccessedAt\` was
added as a field, mutated by \`touch()\` on every cache read, and folded
into both \`equals()\` and \`hashCode()\`. That's a textbook violation of the
\`HashMap\` contract: a key's hash code is expected to stay constant for as
long as the key is stored in the map. \`HashMap\` uses \`hashCode()\` *at
insertion time* to pick a bucket; every future lookup recomputes
\`hashCode()\` on the lookup key and goes straight to whatever bucket that
now produces. Once \`touch()\` changes \`lastAccessedAt\` on an existing key,
that key's hash code changes too - so the very next lookup for "the same"
session computes a different bucket, finds nothing there, and the cache
logic treats it as a miss and inserts a brand-new entry.

The original entry doesn't disappear - it's still sitting in the map's
internal array, still strongly referenced, just permanently unreachable
through \`get()\` ever again. Every read effectively creates a new,
orphaned copy instead of finding the existing one: hit rate craters toward
zero (matching the logs exactly - 1.6-1.9%), the cache's reported size
grows without bound (also matching the logs), and heap usage climbs until
the container gets OOMKilled - which lines up with \`restartCount: 6\` and
the two-week-old \`lastState.terminated\` timing right after the v6.4.0
deploy.

The fix is keeping mutable, access-tracking state out of \`equals()\`/
\`hashCode()\` entirely - only the immutable identity (\`sessionId\`) belongs
there:

\`\`\`java
@Override
public boolean equals(Object o) {
    if (!(o instanceof SessionKey other)) return false;
    return sessionId.equals(other.sessionId);
}

@Override
public int hashCode() {
    return sessionId.hashCode();
}
\`\`\`

\`lastAccessedAt\` can still be tracked and mutated freely - it just can't
be part of what determines where the object lives inside a hash-based
collection. Once the key's hash code is stable for its entire lifetime in
the map, lookups find their entries again, hit rate recovers, and the
cache stops growing without bound.`,
};
