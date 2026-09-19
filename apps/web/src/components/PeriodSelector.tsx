import type { Period } from "../types/ui";

export interface PeriodSelectorProps {
  /** Highlighted (special) period, or null in calculator mode. */
  highlight: Period | null;
  /** Tap a non-highlighted period to open history for it. */
  onOpen: (period: Period) => void;
  /** Tap the highlighted green period — returns home (drill→summary→calculator). */
  onActiveTap: () => void;
  /** Visual-only offline treatment for W/M (plan §5): dimmed, still tappable
   * so the tap can surface the "needs internet" hint. */
  disabledVisual?: Array<Period>;
}

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "day", label: "D" },
  { value: "week", label: "W" },
  { value: "month", label: "M" },
];

/**
 * D / W / M switcher (plan §1). Labels are always D/W/M (never a glyph).
 * From the calculator, any tap (active or not) opens history for that period.
 * From history, tapping the highlighted green period returns home; tapping a
 * non-highlighted period switches the range and stays in history.
 */
export function PeriodSelector({ highlight, onOpen, onActiveTap, disabledVisual = [] }: PeriodSelectorProps) {
  const active = highlight ?? "day";
  return (
    <nav className="flex items-center justify-center gap-2 pb-3" data-testid="period-selector">
      {PERIODS.map(({ value, label }) => {
        const highlighted = highlight === value && highlight !== null;
        const dimmed = !highlighted && disabledVisual.includes(value);
        const ariaCurrent = highlighted ? "true" : undefined;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={highlighted}
            aria-current={ariaCurrent}
            aria-label={highlighted ? `Kembali ke kalkulator dari ${label}` : `Pilih ${label}`}
            data-testid={`period-${value}`}
            onClick={() => (highlighted ? onActiveTap() : onOpen(value))}
            className={`min-h-11 min-w-14 rounded-lg border px-3 text-sm font-semibold transition-colors ${
              highlighted
                ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
                : dimmed
                  ? "border-neutral-800/70 bg-neutral-900/40 text-neutral-600"
                  : value === active
                    ? "border-neutral-500 bg-neutral-800 text-neutral-50"
                    : "border-neutral-800 bg-neutral-900/60 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
