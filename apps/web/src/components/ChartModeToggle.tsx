import type { ChartMode } from "../lib/chartMode";

export interface ChartModeToggleProps {
  /** Currently shown mode — the button displays the icon of the other mode. */
  mode: ChartMode;
  onToggle: () => void;
  testid: string;
}

function BarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.5 13.5h11" />
      <path d="M4.5 13.5V9" />
      <path d="M8 13.5V4.5" />
      <path d="M11.5 13.5V7" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.5 12l3.5-4.5 2.5 2.5 4.5-6" />
      <circle cx="13" cy="4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Compact bar ↔ line chart toggle (icon-only). Shows the icon of the mode
 * switching TO, with a tooltip + pressed state for clarity.
 */
export function ChartModeToggle({ mode, onToggle, testid }: ChartModeToggleProps) {
  const line = mode === "line";
  const label = line ? "Ubah ke grafik batang" : "Ubah ke grafik garis";
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={line}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-neutral-300 active:bg-neutral-800"
    >
      {line ? <BarIcon /> : <LineIcon />}
    </button>
  );
}
