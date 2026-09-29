/**
 * Insight ticker visibility preference.
 * Persisted in localStorage under `expense-app.insight-ticker-visible`
 * (default `true`), following the same private-mode-safe pattern as theme.ts.
 * No cross-tab sync needed — lazy read-once in React state.
 */

const TICKER_KEY = "expense-app.insight-ticker-visible";

const FALSY_VALUES = new Set(["false", "0", "off"]);

function isFalsy(value: unknown): value is string {
  return typeof value === "string";
}

export function loadTickerVisible(): boolean {
  try {
    const stored = localStorage.getItem(TICKER_KEY);
    if (isFalsy(stored) && FALSY_VALUES.has(stored)) return false;
  } catch {
    // Storage unavailable (private mode) → default.
  }
  return true;
}

export function saveTickerVisible(visible: boolean): void {
  try {
    localStorage.setItem(TICKER_KEY, visible ? "true" : "false");
  } catch {
    // Ignore — preference still applies for this session.
  }
}
