import { useCallback, useState } from "react";

/**
 * Persisted bar/line chart preference (same pattern as theme state:
 * `expense-app.*` localStorage key, guarded access, static default).
 * DWM charts and the budget period chart each use their own key so the
 * budget card can additionally default to its auto (days-based) mode.
 */

export type ChartMode = "bar" | "line";

function isChartMode(value: unknown): value is ChartMode {
  return value === "bar" || value === "line";
}

function readStored(key: string): ChartMode | null {
  try {
    const stored = localStorage.getItem(key);
    if (isChartMode(stored)) return stored;
  } catch {
    // Storage unavailable (private mode) → caller fallback applies.
  }
  return null;
}

function writeStored(key: string, mode: ChartMode): void {
  try {
    localStorage.setItem(key, mode);
  } catch {
    // Storage unavailable — preference still applies for this session.
  }
}

/**
 * Binary chart-mode preference with a caller-supplied fallback (used on
 * first mount when nothing is stored yet). Toggling flips bar ↔ line and
 * persists the choice.
 */
export function useChartMode(
  storageKey: string,
  fallback: ChartMode,
): [ChartMode, () => void] {
  const [mode, setMode] = useState<ChartMode>(() => readStored(storageKey) ?? fallback);
  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: ChartMode = prev === "bar" ? "line" : "bar";
      writeStored(storageKey, next);
      return next;
    });
  }, [storageKey]);
  return [mode, toggle];
}
