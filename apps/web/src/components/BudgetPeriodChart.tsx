import type { BudgetSeriesDay, BudgetType } from "@expense-app/shared";

import { formatIDR } from "../lib/currency";

export interface BudgetPeriodChartProps {
  days: BudgetSeriesDay[];
  type: BudgetType;
}

function formatShortDate(date: string): string {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return date;
  const [, month, day] = parts;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${day} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
}

/**
 * Diverging bar chart for the period position (mock §C).
 *
 * Daily: delta = cap − total per day; bars diverge from the zero-line —
 * green up (under budget) / red down (over budget). Each column is split
 * 50/50 around the zero-line (upper half + lower half), so over-budget
 * days genuinely grow downward instead of stacking on top.
 * Full: fallback single-direction bars (total only, upper half).
 *
 * Container is horizontally scrollable via overflow-x-auto for long periods
 * (30+ days); each bar is fixed w-3.5 so bars never collapse on narrow
 * screens. Per-bar value labels are intentionally omitted (noisy at 30
 * bars) — exact values live in the day history + title tooltip.
 */
export function BudgetPeriodChart({ days, type }: BudgetPeriodChartProps) {
  if (days.length === 0) {
    return null;
  }

  const isDaily = type === "daily";

  if (isDaily) {
    const deltas = days as Array<{ date: string; total: number; delta: number }>;
    const maxAbs = Math.max(...deltas.map((d) => Math.abs(d.delta)), 1);

    return (
      <div className="relative py-2" data-testid="budget-period-chart" role="img" aria-label="Grafik harian periode budget">
        <div className="relative h-24 w-full">
          {/* Zero line */}
          <div className="absolute inset-x-0 top-1/2 z-0 h-px bg-neutral-700/60" />
          {/* Bars */}
          <div className="relative z-10 flex h-full items-stretch justify-between gap-1 overflow-x-auto px-1">
            {deltas.map((day) => {
              const heightPct = (Math.abs(day.delta) / maxAbs) * 100;
              const isUnder = day.delta > 0;
              const isOver = day.delta < 0;
              const label =
                isUnder
                  ? `${day.date}: +${formatIDR(day.delta)} di bawah budget`
                  : isOver
                    ? `${day.date}: ${formatIDR(-day.delta)} di atas budget`
                    : `${day.date}: pas budget`;

              return (
                <div
                  key={day.date}
                  title={label}
                  className="flex h-full w-3.5 shrink-0 flex-col justify-center"
                >
                  <div className="flex h-1/2 items-end pb-[1px]">
                    {isUnder && (
                      <div
                        data-testid={`budget-period-bar-${day.date}`}
                        aria-label={label}
                        className="w-full rounded-t-sm bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.3)]"
                        style={{ height: `${heightPct}%` }}
                      />
                    )}
                  </div>
                  <div className="flex h-1/2 items-start pt-[1px]">
                    {isOver && (
                      <div
                        data-testid={`budget-period-bar-${day.date}`}
                        aria-label={label}
                        className="w-full rounded-b-sm bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                        style={{ height: `${heightPct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-1 flex justify-between px-1 text-[9px] font-medium text-neutral-500">
          <span>{formatShortDate(deltas[0]?.date ?? "")}</span>
          <span>Hari Ini</span>
        </div>
      </div>
    );
  }

  const totals = days.map((d) => d.total);
  const maxTotal = Math.max(...totals, 1);

  return (
    <div className="relative py-2" data-testid="budget-period-chart" role="img" aria-label="Grafik total harian periode budget">
      <div className="relative h-24 w-full">
        <div className="absolute inset-x-0 top-1/2 z-0 h-px bg-neutral-700/60" />
        <div className="relative z-10 flex h-full items-stretch justify-between gap-1 overflow-x-auto px-1">
          {days.map((day) => {
            const heightPct = (day.total / maxTotal) * 100;
            const label = `${day.date}: ${formatIDR(day.total)}`;
            return (
              <div
                key={day.date}
                title={label}
                className="flex h-full w-3.5 shrink-0 flex-col justify-center"
              >
                <div className="flex h-1/2 items-end pb-[1px]">
                  {day.total > 0 && (
                    <div
                      data-testid={`budget-period-bar-${day.date}`}
                      aria-label={label}
                      className="w-full rounded-t-sm bg-emerald-500"
                      style={{ height: `${heightPct}%` }}
                    />
                  )}
                </div>
                <div className="flex h-1/2 items-start pt-[1px]" />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between px-1 text-[9px] font-medium text-neutral-500">
        <span>{formatShortDate(days[0]?.date ?? "")}</span>
        <span>Hari Ini</span>
      </div>
    </div>
  );
}
