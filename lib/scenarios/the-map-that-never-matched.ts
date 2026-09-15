import type { Scenario } from "./types";

export const theMapThatNeverMatched: Scenario = {
  id: "the-map-that-never-matched",
  title: "The Map That Never Matched",
  subtitle: "deduplicating warehouse bin locations before a physical count somehow finds zero duplicates, ever",
  difficulty: "easy",
  type: "fix",
  topic: "java-bugs",
  timeMinutes: 12,
  tags: ["java25", "equals-hashcode", "hashset"],
  briefing: `Ahead of the quarterly physical inventory count, a dedup pass is supposed
to flag bin locations that appear more than once in the scan list - a
sign someone mislabeled a shelf. The dedup check has never once flagged
anything, even on test data deliberately built to contain three obvious
duplicate entries.`,
  constraints: [
    "The test data used to verify this contains genuinely duplicate `BinLocation` values - confirmed by manually comparing their field values side by side.",
  ],
  world: {
    resources: [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "bin-dedup-check", namespace: "warehouse", labels: { app: "bin-dedup-check" } },
        spec: { completions: 1 },
        status: { succeeded: 1 },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "bin-dedup-check-28901650-c3d4e", namespace: "warehouse", labels: { app: "bin-dedup-check" } },
        status: { phase: "Succeeded", containerStatuses: [{ name: "bin-dedup-check", ready: false, restartCount: 0, state: { terminated: { reason: "Completed", exitCode: 0 } } }] },
        logs: {
          "bin-dedup-check": [
            "2026-09-15T10:00:02.114Z DEBUG c.e.warehouse.BinDedup - scanning 3 records, 2 are equals()-equal per manual check: BinLocation(aisle=A, shelf=12)",
            "2026-09-15T10:00:02.116Z INFO  c.e.warehouse.BinDedup - dedup complete: 0 duplicates found, seen-set size=3",
          ],
        },
        age: "2h",
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "bin-dedup-notes", namespace: "warehouse" },
        spec: {
          data: {
            "BinLocation.java.excerpt":
              "public class BinLocation {\n    private final String aisle;\n    private final int shelf;\n\n    public BinLocation(String aisle, int shelf) {\n        this.aisle = aisle;\n        this.shelf = shelf;\n    }\n\n    @Override\n    public boolean equals(Object o) {\n        if (!(o instanceof BinLocation other)) return false;\n        return aisle.equals(other.aisle) && shelf == other.shelf;\n    }\n\n    // note: no hashCode() override anywhere in this class - uses the\n    // default Object.hashCode() (identity-based) instead\n}\n",
          },
        },
        age: "2h",
      },
    ],
  },
  hints: [
    "`kubectl logs bin-dedup-check-28901650-c3d4e -n warehouse` - manual comparison confirms two entries are genuinely `equals()`-equal, but the dedup `HashSet` (seen-set) still ends up with all 3 entries. Something isn't matching that should.",
    "`kubectl get configmap bin-dedup-notes -n warehouse -o yaml` - `BinLocation` overrides `equals()`. Does it also override `hashCode()`?",
    "`HashSet` uses `hashCode()` first, to decide which internal bucket to even look in, before it ever calls `equals()` to compare candidates within that bucket - two objects that are `equals()`-equal but land in different buckets (because their `hashCode()`s differ) will never be compared against each other at all.",
  ],
  options: [
    {
      id: "equals-overridden-without-hashcode",
      label:
        "`BinLocation` overrides `equals()` but never overrides `hashCode()`, so it still uses `Object`'s default, identity-based `hashCode()` - two distinct `BinLocation` objects with identical `aisle`/`shelf` values (and therefore `equals()`-equal) almost always get different, effectively-random hash codes, land in different internal `HashSet` buckets, and are never even compared with `equals()` against each other, so the `HashSet` treats them as distinct entries despite genuinely being equal.",
      explanation:
        "The debug log confirms two of the three scanned records are genuinely `equals()`-equal by manual check, yet the dedup pass reports `0 duplicates found` with all `3` entries surviving into the seen-set. `BinLocation.java.excerpt` shows `equals()` is overridden, but there's no `hashCode()` override anywhere in the class - it still inherits `Object`'s default identity-based `hashCode()`, which is effectively unique per object instance regardless of field values. `HashSet` uses `hashCode()` to choose which bucket to search first, and only calls `equals()` against candidates already in that same bucket - two `equals()`-equal `BinLocation` objects with different (identity-based) hash codes almost certainly land in different buckets and are never compared to each other at all, so the `HashSet` adds both as if they were unrelated, distinct entries.",
    },
    {
      id: "scan-data-not-actually-duplicated",
      label: "The test scan data doesn't actually contain genuine duplicates, despite appearing to.",
      explanation:
        "The debug log explicitly confirms, via independent manual comparison, that two of the three records are genuinely `equals()`-equal - the test data is verified correct; it's the dedup mechanism itself that fails to recognize the duplication.",
    },
    {
      id: "bindedup-using-list-instead-of-set",
      label: "`BinDedup`'s scanning logic is using a `List` instead of a `Set`, so nothing is ever actually deduplicated.",
      explanation:
        "The log explicitly refers to a 'seen-set' with `size=3`, consistent with a `Set`-based dedup approach being used but simply failing to recognize two of its members as equal - this isn't a case of dedup logic being entirely absent, it's a case of a `Set` genuinely failing to detect equal elements due to a broken `equals()`/`hashCode()` contract.",
    },
    {
      id: "aisle-field-has-trailing-whitespace",
      label: "The `aisle` field values contain inconsistent trailing whitespace that `equals()` doesn't account for.",
      explanation:
        "The debug log's manual check already confirms these two records are genuinely `equals()`-equal as-is - if whitespace differences were present and meaningful, `equals()` itself (using `String.equals()`, which is whitespace-sensitive) would have already correctly reported them as unequal, not equal.",
    },
  ],
  correctOptionId: "equals-overridden-without-hashcode",
  resolution: `The debug log confirms, via independent manual comparison, that two of
the three scanned records really are \`equals()\`-equal - yet the dedup
pass reports zero duplicates, with all three surviving into the
seen-set. \`BinLocation.java.excerpt\` shows exactly why: \`equals()\` is
overridden to compare \`aisle\` and \`shelf\` by value, but \`hashCode()\` is
never overridden at all, so \`BinLocation\` still uses \`Object\`'s default
implementation - which is based on object identity (roughly, memory
address), completely independent of any field value. This breaks the
fundamental contract Java requires between the two methods: any two
objects that are \`equals()\`-equal *must* also return the same
\`hashCode()\`. \`HashSet\` (and \`HashMap\`) rely on that contract for
correctness - they use \`hashCode()\` first to pick which internal bucket
to search, and only call \`equals()\` to compare against whatever
candidates already happen to be in that same bucket. Two \`BinLocation\`
objects that are genuinely \`equals()\`-equal but have different
(identity-based) hash codes will almost always land in different
buckets and are simply never compared against each other at all - the
\`HashSet\` has no way of ever discovering they're equal.

The fix is overriding \`hashCode()\` consistently with \`equals()\`,
deriving it from the same fields:

\`\`\`java
@Override
public int hashCode() {
    return Objects.hash(aisle, shelf);   // same fields equals() compares
}
\`\`\`

The general rule: \`equals()\` and \`hashCode()\` must always be overridden
together, using the same set of fields - overriding one without the
other breaks the equals/hashCode contract and silently corrupts the
behavior of every hash-based collection (`HashSet`, `HashMap`,
`HashTable`) the object is ever used in, usually with no exception or
error to reveal it.`,
};
