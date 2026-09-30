import { useCallback, useState } from "react";

export type TotalMode = "raw" | "fair";

const STORAGE_KEY = "expense-app.total-mode";
const DEFAULT_MODE: TotalMode = "raw";

function readMode(): TotalMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "fair" || raw === "raw") return raw;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function writeMode(mode: TotalMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable (private mode) — keep in-memory only
  }
}

/**
 * Persisted toggle for Header total display mode (spec §Adv-5 Phase 1).
 * - raw (default): SUM(amount) where occurredAt ∈ [from, to) — cashflow truth.
 * - fair: prorated allocation-aware total, capped at today.
 * Pure + small: state lives here, not in useExpenses, to avoid expanding that hook.
 */
export function useTotalMode(): {
  mode: TotalMode;
  toggle: () => void;
  setMode: (mode: TotalMode) => void;
} {
  const [mode, setModeState] = useState<TotalMode>(readMode);

  const setMode = useCallback((next: TotalMode) => {
    setModeState(next);
    writeMode(next);
  }, []);

  const toggle = useCallback(() => {
    setModeState((current) => {
      const next = current === "raw" ? "fair" : "raw";
      writeMode(next);
      return next;
    });
  }, []);

  return { mode, toggle, setMode };
}
