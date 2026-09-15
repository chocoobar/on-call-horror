import type { Scenario } from "./types";
import { stuckAt3am } from "./stuck-at-3am";
import { zombiePods } from "./zombie-pods";
import { driftInTheDark } from "./drift-in-the-dark";
import { lockedOut } from "./locked-out";
import { helmGoneWrong } from "./helm-gone-wrong";
import { hookThatWouldntDie } from "./hook-that-wouldnt-die";
import { silentFailure } from "./silent-failure";

export * from "./types";

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

export const scenarios: Scenario[] = [
  stuckAt3am,
  zombiePods,
  driftInTheDark,
  lockedOut,
  helmGoneWrong,
  hookThatWouldntDie,
  silentFailure,
].sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.id.localeCompare(b.id));

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
