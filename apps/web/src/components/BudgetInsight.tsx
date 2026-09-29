import type { BudgetSnapshot } from "@expense-app/shared";

import { formatIDR } from "../lib/currency";

const BAR_CLASS: Record<BudgetSnapshot["status"], string> = {
  UNDER: "bg-emerald-500",
  WARNING: "bg-amber-500",
  OVER: "bg-red-500",
};

export interface BudgetInsightProps {
  snapshot: BudgetSnapshot;
}

/**
 * Budget insight view: usage %, progress bar, spent/budget, remaining or
 * overspent. All numbers unclamped in text; the bar fill is clamped to 100%.
 * Calculation lives in packages/shared — this is purely presentational.
 */
export function BudgetInsight({ snapshot }: BudgetInsightProps) {
  const { spent, budget, remaining, overspent, usagePercent, status } = snapshot;

  const barWidth = Math.min(100, usagePercent);
  const barClass = BAR_CLASS[status];

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3" data-testid="budget-insight">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-widest text-neutral-500">
          Penggunaan
        </span>
        <span data-testid="budget-insight-pct" className="text-lg font-semibold tabular-nums text-neutral-100">
          {usagePercent.toFixed(1)}%
        </span>
      </div>

      <div
        className="mb-3 h-2 w-full overflow-hidden rounded-full bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, usagePercent)}
        aria-label="Progres budget"
        data-testid="budget-insight-bar"
      >
        <div
          className={`h-full rounded-full ${barClass} transition-[width] duration-500`}
          style={{ width: `${barWidth}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="flex items-baseline justify-between text-sm">
        <span className="text-neutral-500">Terpakai</span>
        <span data-testid="budget-insight-spent" className="font-semibold tabular-nums text-neutral-200">
          {formatIDR(spent)}
        </span>
      </div>

      <div className="flex items-baseline justify-between text-sm">
        <span className="text-neutral-500">Budget</span>
        <span className="font-semibold tabular-nums text-neutral-200">
          {formatIDR(budget)}
        </span>
      </div>

      {overspent > 0 ? (
        <div className="mt-2 flex items-baseline justify-between text-sm" data-testid="budget-insight-overspent">
          <span className="text-neutral-500">Lewat</span>
          <span className="font-semibold tabular-nums text-red-300">
            {formatIDR(overspent)}
          </span>
        </div>
      ) : (
        <div className="mt-2 flex items-baseline justify-between text-sm" data-testid="budget-insight-remaining">
          <span className="text-neutral-500">Sisa</span>
          <span className="font-semibold tabular-nums text-neutral-200">
            {formatIDR(remaining)}
          </span>
        </div>
      )}
    </div>
  );
}
