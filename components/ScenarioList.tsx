"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Scenario, Difficulty } from "@/lib/scenarios/types";
import { TypeBadge, Tag } from "@/components/Badges";
import { isSolved } from "@/lib/progress";

const GROUPS: Difficulty[] = ["easy", "medium", "hard"];

export function ScenarioList({ scenarios }: { scenarios: Scenario[] }) {
  const [solved, setSolved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const s of scenarios) map[s.id] = isSolved(s.id);
    setSolved(map);
  }, [scenarios]);

  if (scenarios.length === 0) {
    return <p className="text-dim text-sm">No scenarios in this topic yet - check back soon.</p>;
  }

  return (
    <>
      {GROUPS.map((difficulty) => {
        const group = scenarios.filter((s) => s.difficulty === difficulty);
        if (group.length === 0) return null;
        return (
          <section key={difficulty} className="mb-10">
            <h2 className="text-lg font-semibold border-b border-border pb-2 mb-3">
              <span className={difficulty === "easy" ? "text-easy" : difficulty === "medium" ? "text-medium" : "text-hard"}>
                {difficulty[0].toUpperCase() + difficulty.slice(1)}
              </span>
            </h2>
            <div className="divide-y divide-border">
              {group.map((s) => (
                <Link
                  key={s.id}
                  href={`/scenario/${s.id}`}
                  className="flex items-center gap-4 py-3 px-2 -mx-2 rounded hover:bg-panel transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold flex items-center gap-2">
                      {solved[s.id] && <span className="text-easy">✓</span>}
                      &ldquo;{s.title}&rdquo;
                    </div>
                    <div className="text-dim text-sm">{s.subtitle}</div>
                    <div className="mt-1">
                      {s.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <TypeBadge type={s.type} />
                    <span className="text-dim text-xs">{s.timeMinutes} m</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
