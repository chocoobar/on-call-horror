import type { Scenario } from "../types";

export const theSerializationTimeBomb: Scenario = {
  id: "the-serialization-time-bomb",
  title: "The Serialization Time Bomb",
  subtitle: "half the cluster can't read the other half's cached sessions, mid-rollout",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "serialization", "rolling-deploy"],
  briefing: `A routine rolling deploy of "session-service" added one new field to a
session object cached in a shared, cluster-wide cache. Halfway through
the rollout, with old and new pods running side by side as normal, users
started getting logged out at random - exactly the users whose session
was last touched by a pod running the other version from whichever pod
they hit next.`,
  constraints: [
    "The new field itself is simple and correctly implemented - the problem isn't what was added, it's a side effect of adding anything at all to this particular class.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "session-service", namespace: "sessions", labels: { app: "session-service" } },
        spec: { replicas: 6 },
        status: { readyReplicas: 6, updatedReplicas: 3, availableReplicas: 6 },
        age: "10m",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "session-service-0y1z2a3b4-c5d6e", namespace: "sessions", labels: { app: "session-service", version: "new" } },
        status: { phase: "Running", containerStatuses: [{ name: "session-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "session-service": [
            "2026-09-15T09:00:01.114Z ERROR c.e.sessions.SessionCache - failed to deserialize cached session for user 88213",
            "java.io.InvalidClassException: com.example.sessions.UserSession; local class incompatible: stream classdesc serialVersionUID = 4821093873213456789, local class serialVersionUID = -2091837465123987654",
          ],
        },
        age: "10m",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "session-service-notes", namespace: "sessions" },
        spec: {
          data: {
            "UserSession.java.excerpt":
              "public class UserSession implements Serializable {\n    // no explicit serialVersionUID declared - relies on the compiler's\n    // computed default, which is derived from the class's structure\n    // (fields, methods, interfaces) at compile time\n    private String userId;\n    private Instant loginTime;\n    private String lastKnownRegion;   // <-- field added in this release\n}\n",
          },
        },
        age: "10m",
      },
    ],
  },
  hints: [
    "`kubectl logs session-service-0y1z2a3b4-c5d6e -n sessions` - `InvalidClassException` with two different `serialVersionUID` values is very specific. What determines that value when a class doesn't declare one explicitly?",
    "`kubectl get configmap session-service-notes -n sessions -o yaml` - is there an explicit `serialVersionUID` field on this class at all?",
    "A rolling deploy runs old and new versions of a class side by side, by design, for its entire duration - what happens when each version computes a *different* implicit serialVersionUID for what's nominally 'the same' class, and they need to deserialize each other's cached objects?",
  ],
  options: [
    {
      id: "no-explicit-serialversionuid-computed-default-changed",
      label:
        "`UserSession` has no explicit `serialVersionUID`, so the JVM computes one automatically from the class's exact structure at compile time - adding a field changed that structure, which changed the computed UID, so the old and new pods' versions of the class now have two genuinely different UIDs; any pod deserializing a session that was cached by a pod running the other version rejects it outright as an incompatible class, exactly during the window where old and new pods are required to coexist by any rolling deploy.",
      explanation:
        "The exception is explicit about the mechanism: two different \`serialVersionUID\` values, one from the \"stream\" (whichever pod cached this session) and one from the \"local class\" (whichever pod is trying to read it now). \`UserSession.java.excerpt\` confirms there's no explicit \`serialVersionUID\` declared - which means the compiler computes one automatically, deterministically, from the class's structure (fields, methods, and more) at compile time. Adding \`lastKnownRegion\` changed that structure, which changed the computed UID between the old and new builds. A rolling deploy runs both versions concurrently by design; any session cached by one version and read by the other now fails deserialization completely, for the entire rollout window, until every pod is on the same version again.",
    },
    {
      id: "shared-cache-network-partition",
      label: "A network partition to the shared cache is causing intermittent read failures.",
      explanation:
        "The failure is a specific, deterministic `InvalidClassException` naming two different UIDs - a network partition would produce connection or timeout errors instead, not a class-compatibility exception that requires a successful read to even occur before the deserialization step fails.",
    },
    {
      id: "new-field-not-nullable",
      label: "The new `lastKnownRegion` field isn't properly nullable, causing deserialization to fail on old data missing it.",
      explanation:
        "The exception occurs before any field-level population is attempted - `InvalidClassException` for a UID mismatch is thrown by the deserialization mechanism itself refusing to even begin reading the object, entirely independent of what any individual field's nullability constraints are.",
    },
    {
      id: "cache-eviction-policy-too-aggressive",
      label: "The cache's eviction policy is too aggressive and evicting sessions too early.",
      explanation:
        "An evicted session would simply be absent from the cache (a cache miss, handled gracefully), not present but fail with an explicit class-incompatibility exception - the session data is clearly still there and being read, it's just being rejected by the deserialization mechanism.",
    },
  ],
  correctOptionId: "no-explicit-serialversionuid-computed-default-changed",
  resolution: `The exception spells out the mechanism precisely: an
\`InvalidClassException\` citing two different \`serialVersionUID\` values -
one from the serialized data ("stream classdesc"), one from the class
currently loaded ("local class"). \`UserSession.java.excerpt\` confirms
there's no explicit \`serialVersionUID\` field declared on the class,
which means the JVM computes one automatically and deterministically
from the class's exact structure (its fields, methods, interfaces, and
more) at compile time - a specification detail most engineers only
discover the hard way. Adding \`lastKnownRegion\` changed that structure,
which changed the computed UID between the pre-deploy and post-deploy
builds, even though nothing about the class's actual *behavior* changed
in any meaningful way. A rolling deploy necessarily runs both versions
side by side for its entire duration - any session cached in the shared
cache by a pod on one version and read by a pod on the other now fails
deserialization outright, because Java's serialization mechanism treats
a UID mismatch as "this might not even be the same class anymore" and
refuses to guess.

The fix is declaring an explicit, stable \`serialVersionUID\` that doesn't
change just because a field was added:

\`\`\`java
public class UserSession implements Serializable {
    private static final long serialVersionUID = 1L;   // stable, explicit,
                                                          // never auto-recomputed
    private String userId;
    private Instant loginTime;
    private String lastKnownRegion;
}
\`\`\`

With an explicit, unchanging UID, adding a new field (as long as it's
handled reasonably on the read side, e.g. defaulting to \`null\` when
absent from older serialized data) no longer breaks compatibility between
versions during a rollout. Any class implementing \`Serializable\` that's
ever cached, persisted, or sent across a version boundary - which
includes essentially anything shared across pods during a rolling
deploy - should declare an explicit \`serialVersionUID\` from the start,
specifically to avoid this exact failure mode.`,
};
