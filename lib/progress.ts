"use client";

const KEY = "oncallhorror:progress:v1";

interface ProgressState {
  solved: Record<string, string>; // scenarioId -> ISO timestamp first solved
}

function read(): ProgressState {
  if (typeof window === "undefined") return { solved: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { solved: {} };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.solved ? parsed : { solved: {} };
  } catch {
    return { solved: {} };
  }
}

function write(state: ProgressState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) - progress just won't persist
  }
}

export function isSolved(scenarioId: string): boolean {
  return Boolean(read().solved[scenarioId]);
}

export function markSolved(scenarioId: string): void {
  const state = read();
  if (!state.solved[scenarioId]) {
    state.solved[scenarioId] = new Date().toISOString();
    write(state);
  }
}

export function solvedCount(): number {
  return Object.keys(read().solved).length;
}

export function solvedIds(): string[] {
  return Object.keys(read().solved);
}
