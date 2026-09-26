import type { BudgetInsightStatus } from "@expense-app/shared";

export type GraphMode = "spending" | "budget";

const MODES: Array<{ value: GraphMode; label: string }> = [
  { value: "spending", label: "Pengeluaran" },
  { value: "budget", label: "Budget" },
];

const STATUS_LABEL: Record<BudgetInsightStatus, string> = {
  UNDER: "Aman",
  WARNING: "Hampir habis",
  OVER: "Lewat batas",
};

export { STATUS_LABEL };

export interface GraphModeToggleProps {
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
}

/**
 * Segmented control [Pengeluaran][Budget] — only rendered when an active
 * budget exists. Uses aria-pressed on the active segment (plan §5).
 */
export function GraphModeToggle({ mode, onModeChange }: GraphModeToggleProps) {
  return (
    <nav className="mb-3 flex items-center justify-center gap-1" data-testid="graph-mode-toggle">
      {MODES.map(({ value, label }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            data-testid={`graph-mode-${value}`}
            onClick={() => onModeChange(value)}
            className={`min-h-8 min-w-20 rounded-lg border px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500 ${
              active
                ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
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
