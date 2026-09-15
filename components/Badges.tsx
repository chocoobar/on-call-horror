import type { Difficulty, ScenarioType } from "@/lib/scenarios/types";

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  easy: "border-easy text-easy",
  medium: "border-medium text-medium",
  hard: "border-hard text-hard",
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs bg-panel ${DIFFICULTY_STYLES[difficulty]}`}>
      {difficulty[0].toUpperCase() + difficulty.slice(1)}
    </span>
  );
}

export function TypeBadge({ type }: { type: ScenarioType }) {
  return (
    <span className="inline-block rounded-full border border-accent text-accent px-2.5 py-0.5 text-xs bg-panel">
      {type[0].toUpperCase() + type.slice(1)}
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-dim text-xs mr-2">#{children}</span>;
}
