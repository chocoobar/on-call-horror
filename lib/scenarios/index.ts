import type { Scenario } from "./types";
import { stuckAt3am } from "./stuck-at-3am";
import { zombiePods } from "./zombie-pods";
import { driftInTheDark } from "./drift-in-the-dark";
import { lockedOut } from "./locked-out";
import { helmGoneWrong } from "./helm-gone-wrong";
import { hookThatWouldntDie } from "./hook-that-wouldnt-die";
import { silentFailure } from "./silent-failure";
import { sigtermNeverArrived } from "./sigterm-never-arrived";
import { virtualThreadsRealProblems } from "./virtual-threads-real-problems";
import { heapThatWasntTheProblem } from "./heap-that-wasnt-the-problem";
import { noDataKnowProblem } from "./no-data-know-problem";
import { alertThatNeverFired } from "./alert-that-never-fired";
import { tooManySeries } from "./too-many-series";
import { whereDidTheLogsGo } from "./where-did-the-logs-go";
import { blockedAtTheBorder } from "./blocked-at-the-border";
import { theIngressThatWasnt } from "./the-ingress-that-wasnt";
import { theFiveSecondDelay } from "./the-five-second-delay";
import { theSandboxThatWasnt } from "./the-sandbox-that-wasnt";
import { eightToTwentyFive } from "./eight-to-twenty-five";
import { theCacheThatForgot } from "./the-cache-that-forgot";

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
  sigtermNeverArrived,
  virtualThreadsRealProblems,
  heapThatWasntTheProblem,
  noDataKnowProblem,
  alertThatNeverFired,
  tooManySeries,
  whereDidTheLogsGo,
  blockedAtTheBorder,
  theIngressThatWasnt,
  theFiveSecondDelay,
  theSandboxThatWasnt,
  eightToTwentyFive,
  theCacheThatForgot,
].sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.id.localeCompare(b.id));

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
