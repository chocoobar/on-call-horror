"use client";

import { useState } from "react";
import type { Scenario } from "@/lib/scenarios/types";
import { markSolved } from "@/lib/progress";
import { Prose } from "./Prose";

export function DiagnosisPanel({ scenario }: { scenario: Scenario }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);

  const submittedOption = scenario.options.find((o) => o.id === submittedId);
  const isCorrect = submittedId === scenario.correctOptionId;

  function submit() {
    if (!selectedId) return;
    setSubmittedId(selectedId);
    if (selectedId === scenario.correctOptionId) {
      markSolved(scenario.id);
      setSolved(true);
    }
  }

  function tryAgain() {
    setSubmittedId(null);
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <h3 className="font-semibold text-dim uppercase text-xs tracking-wide mb-3">
        What&rsquo;s actually wrong &mdash; and how would you fix it?
      </h3>

      <div className="space-y-2">
        {scenario.options.map((opt) => {
          const isSelected = selectedId === opt.id;
          const isSubmittedThis = submittedId === opt.id;
          const showResult = submittedId !== null;

          let ring = "border-border";
          if (showResult && isSubmittedThis) {
            ring = opt.id === scenario.correctOptionId ? "border-easy" : "border-accent";
          } else if (!showResult && isSelected) {
            ring = "border-neutral-400";
          }

          return (
            <button
              key={opt.id}
              disabled={submittedId !== null && isCorrect}
              onClick={() => setSelectedId(opt.id)}
              className={`w-full text-left rounded-md border ${ring} bg-black/30 px-3 py-2.5 text-sm transition-colors hover:border-neutral-400 disabled:hover:border-easy`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {submittedId === null ? (
        <button
          onClick={submit}
          disabled={!selectedId}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
        >
          Submit diagnosis
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className={`rounded-md border px-3 py-2.5 text-sm ${isCorrect ? "border-easy text-easy" : "border-accent text-accent"}`}>
            {isCorrect ? "Correct." : "Not quite."} {submittedOption?.explanation}
          </div>

          {!isCorrect && (
            <button
              onClick={tryAgain}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-black/30 transition-colors"
            >
              Try again
            </button>
          )}

          {isCorrect && (
            <div className="rounded-md border border-border bg-black/30 px-4 py-3">
              <h4 className="text-xs uppercase tracking-wide text-dim mb-2">Resolution</h4>
              <Prose>{scenario.resolution}</Prose>
            </div>
          )}
        </div>
      )}
      {solved && <p className="text-easy text-xs mt-2">Saved to your progress.</p>}
    </div>
  );
}
