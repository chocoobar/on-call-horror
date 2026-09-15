"use client";

import { useEffect, useRef, useState } from "react";
import type { ScenarioWorld } from "@/lib/scenarios/types";
import { runCommand } from "@/lib/terminal/run";

interface HistoryEntry {
  kind: "input" | "output" | "error";
  lines: string[];
}

export function Terminal({ world, scenarioId }: { world: ScenarioWorld; scenarioId: string }) {
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      kind: "output",
      lines: [
        `Connected to mock cluster for scenario "${scenarioId}".`,
        "Read-only investigation console - kubectl get/describe/logs and argocd app get/diff are available.",
        "Type 'help' to see the full command list.",
      ],
    },
  ]);
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history]);

  function focusInput() {
    inputRef.current?.focus();
  }

  function submit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    setCmdHistory((h) => [...h, trimmed]);
    setHistoryIdx(null);

    if (trimmed === "clear") {
      setHistory([]);
      return;
    }

    const result = runCommand(trimmed, world);
    setHistory((h) => [
      ...h,
      { kind: "input", lines: [trimmed] },
      { kind: result.isError ? "error" : "output", lines: result.lines.length ? result.lines : [""] },
    ]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      submit(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const nextIdx = historyIdx === null ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setInput(cmdHistory[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === null) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx >= cmdHistory.length) {
        setHistoryIdx(null);
        setInput("");
      } else {
        setHistoryIdx(nextIdx);
        setInput(cmdHistory[nextIdx]);
      }
    }
  }

  return (
    <div
      className="rounded-lg border border-border bg-black/60 font-mono text-sm overflow-hidden flex flex-col h-[420px]"
      onClick={focusInput}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-panel shrink-0">
        <span className="w-3 h-3 rounded-full bg-hard/70" />
        <span className="w-3 h-3 rounded-full bg-medium/70" />
        <span className="w-3 h-3 rounded-full bg-easy/70" />
        <span className="ml-3 text-dim text-xs">oncall@investigation: ~</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-1">
        {history.map((entry, i) => (
          <div key={i}>
            {entry.kind === "input" ? (
              <div className="text-easy">
                <span className="text-dim">$ </span>
                {entry.lines[0]}
              </div>
            ) : (
              <pre
                className={`whitespace-pre-wrap break-words leading-snug ${
                  entry.kind === "error" ? "text-accent" : "text-neutral-200"
                }`}
              >
                {entry.lines.join("\n")}
              </pre>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center px-3 py-2 border-t border-border shrink-0">
        <span className="text-dim mr-2">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none text-neutral-100 caret-accent"
          placeholder="kubectl get application ..."
        />
      </div>
    </div>
  );
}
