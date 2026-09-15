"use client";

import { useState } from "react";
import { Prose } from "./Prose";

export function HintPanel({ hints }: { hints: string[] }) {
  const [revealed, setRevealed] = useState(0);

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-dim uppercase text-xs tracking-wide">Hints</h3>
        {revealed < hints.length && (
          <button
            onClick={() => setRevealed((r) => r + 1)}
            className="text-xs border border-border rounded px-2 py-1 text-accent hover:bg-black/30 transition-colors"
          >
            Reveal hint {revealed + 1} of {hints.length}
          </button>
        )}
      </div>
      {revealed === 0 ? (
        <p className="text-dim text-sm mt-2">Stuck? Reveal hints one at a time.</p>
      ) : (
        <ol className="mt-3 space-y-2 list-decimal list-inside text-sm text-neutral-200">
          {hints.slice(0, revealed).map((h, i) => (
            <li key={i} className="pl-1">
              <Prose className="inline">{h}</Prose>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
