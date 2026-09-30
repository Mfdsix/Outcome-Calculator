import { useCallback, useState } from "react";

export type TotalMode = "raw" | "fair";

const DEFAULT_STORAGE_KEY = "expense-app.total-mode";
const DEFAULT_MODE: TotalMode = "raw";

function readMode(storageKey: string): TotalMode {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === "fair" || raw === "raw") return raw;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function writeMode(storageKey: string, mode: TotalMode): void {
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    // storage unavailable (private mode) — keep in-memory only
  }
}

/**
 * Persisted toggle for total display mode.
 * - raw (default): SUM(amount) where occurredAt ∈ [from, to) — cashflow truth.
 * - fair: prorated allocation-aware total, capped at today.
 *
 * The storage key is parameterised so the Header and Budget "Today" toggle
 * can keep independent persisted modes (plan §Adv-5 Phase 2).
 */
export function useTotalMode(storageKey: string = DEFAULT_STORAGE_KEY): {
  mode: TotalMode;
  toggle: () => void;
  setMode: (mode: TotalMode) => void;
} {
  const [mode, setModeState] = useState<TotalMode>(() => readMode(storageKey));

  const setMode = useCallback(
    (next: TotalMode) => {
      setModeState(next);
      writeMode(storageKey, next);
    },
    [storageKey],
  );

  const toggle = useCallback(() => {
    setModeState((current) => {
      const next = current === "raw" ? "fair" : "raw";
      writeMode(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return { mode, toggle, setMode };
}
