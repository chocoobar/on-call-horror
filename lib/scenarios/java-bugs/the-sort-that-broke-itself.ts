import type { Scenario } from "../types";

export const theSortThatBrokeItself: Scenario = {
  id: "the-sort-that-broke-itself",
  title: "The Sort That Broke Itself",
  subtitle: "the leaderboard sort occasionally throws instead of just sorting, and only on the biggest tournament of the day",
  difficulty: "medium",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 20,
  tags: ["java25", "comparator", "sorting"],
  briefing: `The tournament leaderboard sorts players by a custom ranking score. It
works fine for small tournaments, but the flagship daily tournament -
with several thousand entrants - occasionally throws an
IllegalArgumentException ("Comparison method violates its general
contract!") instead of returning a sorted leaderboard at all.`,
  constraints: [
    "Every individual player's score value used by the comparator is confirmed correct and stable during the sort - no score changes mid-sort.",
  ],
  world: {
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "leaderboard-service", namespace: "tournaments", labels: { app: "leaderboard-service" } },
        spec: { replicas: 2 },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "leaderboard-service-7z8a9b0c1-d2e3f", namespace: "tournaments", labels: { app: "leaderboard-service" } },
        status: { phase: "Running", containerStatuses: [{ name: "leaderboard-service", ready: true, restartCount: 0, state: { running: {} } }] },
        logs: {
          "leaderboard-service": [
            "2026-09-15T20:00:12.114Z ERROR c.e.tournaments.LeaderboardSorter - java.lang.IllegalArgumentException: Comparing method violates its general contract!",
            "    at java.base/java.util.TimSort.mergeHi(TimSort.java:906)",
            "    at java.base/java.util.TimSort.sort(TimSort.java:220)",
            "    at app//com.example.tournaments.LeaderboardSorter.rank(LeaderboardSorter.java:11)",
          ],
        },
        age: "6mo",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "leaderboard-sorter-notes", namespace: "tournaments" },
        spec: {
          data: {
            "LeaderboardSorter.java.excerpt":
              "public void rank(List<Player> players) {\n    players.sort((a, b) -> {\n        // intended: higher score first; uses subtraction as a shortcut\n        // instead of an explicit comparison\n        return (int) (b.score() - a.score());\n    });\n}\n",
          },
        },
        age: "6mo",
      },
    ],
  },
  hints: [
    "`kubectl logs leaderboard-service-7z8a9b0c1-d2e3f -n tournaments` - `TimSort` itself is what's throwing, not application code directly. It only throws this specific exception when it detects the comparator's results are logically inconsistent.",
    "`kubectl get configmap leaderboard-sorter-notes -n tournaments -o yaml` - the comparator computes `b.score() - a.score()` and casts to `int`. What are `score()`'s actual numeric bounds, and what happens to a subtraction near the edges of `int`'s range?",
    "TimSort (used by `List.sort`/`Collections.sort` since Java 7) actively validates that a comparator behaves consistently - transitively and symmetrically - across many elements, and throws rather than silently producing a wrong-but-plausible-looking order if it detects a violation, which only tends to show up with enough elements for the right combination of values to appear.",
  ],
  options: [
    {
      id: "subtraction-based-comparator-overflow-or-inconsistency",
      label:
        "The comparator computes `(int) (b.score() - a.score())` as a shortcut for comparison instead of using an explicit comparison method - if `score()` values are large enough (or of opposite sign) that their difference can overflow `int`'s range, or even without overflow, subtraction-based comparators can produce results that aren't perfectly transitive across all value combinations, which TimSort actively detects and rejects with `IllegalArgumentException` once a large enough dataset happens to trigger it, rather than silently producing an incorrect sort order.",
      explanation:
        "The stack trace shows the exception is thrown from inside the JDK's own `TimSort` implementation, specifically because it actively validates comparator consistency and refuses to proceed once it detects a violation - not a bug in `TimSort` itself, but TimSort correctly catching a broken comparator. `LeaderboardSorter.java.excerpt` shows exactly the well-known anti-pattern that causes this: `(int) (b.score() - a.score())` as a comparator, rather than `Integer.compare(...)`/`Long.compare(...)` or explicit comparisons. Subtraction-based comparators can silently overflow for large or widely-separated values, producing a wrapped result with the wrong sign - inconsistent with what a correct comparison should return - and are only exposed by TimSort's validation once a data set large and varied enough (like the flagship tournament's thousands of entrants) happens to exercise the inconsistency, which is exactly why smaller tournaments never trigger it.",
    },
    {
      id: "players-list-modified-during-sort",
      label: "The `players` list is being concurrently modified by another thread while the sort is running.",
      explanation:
        "Concurrent modification during a `sort()` call typically throws `ConcurrentModificationException`, not `IllegalArgumentException: Comparing method violates its general contract!` - this specific exception message is TimSort's own dedicated check for comparator *logical* consistency, unrelated to concurrent structural changes to the list.",
    },
    {
      id: "score-values-null-for-some-players",
      label: "Some players have a null `score()` value that isn't being handled.",
      explanation:
        "A null score reaching a primitive-returning `score()` method (or unboxing) would throw a `NullPointerException`, not `IllegalArgumentException: Comparing method violates its general contract!` - the reported exception is specifically TimSort's comparator-consistency check, not a null-handling failure.",
    },
    {
      id: "timsort-bug-in-this-jdk-version",
      label: "This is a known bug in the JDK's `TimSort` implementation for large lists.",
      explanation:
        "`TimSort` throwing this specific exception is documented, intentional, defensive behavior - it's designed to detect exactly this class of broken comparator and fail loudly rather than silently mis-sort, not a bug in the sorting algorithm itself.",
    },
  ],
  correctOptionId: "subtraction-based-comparator-overflow-or-inconsistency",
  resolution: `The exception - \`IllegalArgumentException: Comparing method violates its
general contract!\` - is thrown directly from inside the JDK's own
\`TimSort\` implementation, which actively validates that a comparator
behaves consistently (transitively and symmetrically) as it sorts, and
throws rather than silently producing an incorrect order once it detects
a violation. \`LeaderboardSorter.java.excerpt\` shows the classic cause:
\`(int) (b.score() - a.score())\` used as a comparator shortcut instead of
an explicit, safe comparison. Subtraction as a substitute for comparison
is a well-known trap - for large enough or oppositely-signed score
values, the subtraction can overflow \`int\`'s range and silently wrap to
a value with the wrong sign, meaning the comparator can report \`a < b\`,
\`b < a\`, and effectively contradict itself depending on which two
players happen to be compared. TimSort's internal consistency checks are
only exercised thoroughly enough to catch this with a large, varied
enough data set - which is exactly why only the flagship tournament,
with thousands of entrants and a wide spread of scores, ever triggers
it, while small tournaments' comparator calls never combine the right
values to expose the inconsistency.

The fix is using a safe, purpose-built comparison method instead of
subtraction:

\`\`\`java
public void rank(List<Player> players) {
    players.sort(Comparator.comparingLong(Player::score).reversed());
}
\`\`\`

\`Comparator.comparingLong\`/\`comparingInt\`/\`comparingDouble\` (and
\`Long.compare\`/\`Integer.compare\` directly) are guaranteed correct and
overflow-safe. The general rule: never use subtraction as a shortcut for
comparison logic - it's a subtle, data-dependent source of comparator
inconsistency that can pass small-scale testing cleanly and only fail
under real, large-scale data, exactly the conditions production traffic
eventually provides.`,
};
