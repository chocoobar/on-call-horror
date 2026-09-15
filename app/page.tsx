"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { scenarios, type Difficulty } from "@/lib/scenarios";
import { TypeBadge, Tag } from "@/components/Badges";
import { isSolved, solvedCount } from "@/lib/progress";

const GROUPS: Difficulty[] = ["easy", "medium", "hard"];

export default function CatalogPage() {
  const [solved, setSolved] = useState<Record<string, boolean>>({});
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const s of scenarios) map[s.id] = isSolved(s.id);
    setSolved(map);
    setTotal(solvedCount());
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-10">
      <header className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight" style={{ textShadow: "0 0 18px #7a1f1f" }}>
          On-Call Horror
        </h1>
        <p className="text-dim mt-2">
          Real ArgoCD &amp; Kubernetes incidents. Investigate a mocked cluster in your browser, deduce the root
          cause, no infra required.
        </p>
        <p className="text-dim text-sm mt-3">
          {total} / {scenarios.length} solved
        </p>
      </header>

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

      <footer className="text-center text-dim text-sm mt-12 pt-6 border-t border-border">
        No sign-up, no servers, no real Kubernetes cluster - every scenario is a mocked kubectl/argocd console
        running entirely in your browser.
      </footer>
    </main>
  );
}
