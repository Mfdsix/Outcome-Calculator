import type { TotalMode } from "../hooks/useTotalMode";

export interface TotalToggleProps {
  mode: TotalMode;
  onToggle: () => void;
  /** When true, show a small loading indicator instead of the label. */
  loading: boolean;
}

/**
 * Raw / Fair total toggle — a compact pill pair that sits in the Header
 * trailing cluster (spec §Adv-5 Phase 1). Switching mode only changes the
 * number shown in the Header totalLabel; chart, summary, budget and insight
 * totals remain raw.
 *
 * Styled to match PeriodSelector pill conventions (emerald active).
 */
export function TotalToggle({ mode, onToggle, loading }: TotalToggleProps) {
  const rawActive = mode === "raw";
  return (
    <div
      data-testid="total-toggle"
      className="flex items-center gap-0.5 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/60 text-xs font-semibold"
      role="radiogroup"
      aria-label="Total"
    >
      <button
        type="button"
        data-testid="total-toggle-raw"
        role="radio"
        aria-checked={rawActive}
        aria-pressed={rawActive}
        onClick={() => {
          if (!rawActive) onToggle();
        }}
        className={`px-2.5 py-1 outline-none transition-colors ${
          rawActive
            ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
            : "border-transparent text-neutral-400 hover:text-neutral-200"
        }`}
      >
        Raw
      </button>
      <button
        type="button"
        data-testid="total-toggle-fair"
        role="radio"
        aria-checked={!rawActive}
        aria-pressed={!rawActive}
        onClick={() => {
          if (rawActive) onToggle();
        }}
        className={`px-2.5 py-1 outline-none transition-colors ${
          !rawActive
            ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
            : "border-neutral-800 border-l text-neutral-400 hover:text-neutral-200"
        }`}
      >
        {loading && !rawActive ? "…" : "Fair"}
      </button>
    </div>
  );
}
