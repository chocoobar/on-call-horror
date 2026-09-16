import type { Scenario } from "./types";
import { allScenarios } from "./generated";

export * from "./types";

/**
 * Scenario files live under `lib/scenarios/<topic>/*.ts` - one folder per
 * `Topic["id"]` from `lib/topics.ts`. `allScenarios` (and this file's import
 * list) is generated from that folder structure by
 * `scripts/generate-scenario-index.mjs` - see `lib/scenarios/generated.ts`.
 * To add a scenario, drop a new file in the right topic folder and run
 * `npm run generate:scenarios` (or `dev`/`build`, which do it automatically).
 */
const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

export const scenarios: Scenario[] = [...allScenarios].sort(
  (a, b) => (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.id.localeCompare(b.id)
);

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
