import type { BudgetSeriesDay, BudgetType } from "@expense-app/shared";

import { formatIDR } from "../lib/currency";

export interface BudgetPeriodChartProps {
  days: BudgetSeriesDay[];
  type: BudgetType;
}

/** At/above this many days the bars auto-transform into an up-down line chart. */
export const PERIOD_CHART_LINE_MIN_DAYS = 14;

function formatShortDate(date: string): string {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return date;
  const [, month, day] = parts;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${day} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
}

function ChartFooter({ first }: { first: string }) {
  return (
    <div className="mt-1 flex justify-between px-1 text-[9px] font-medium text-neutral-500">
      <span>{formatShortDate(first)}</span>
      <span>Hari Ini</span>
    </div>
  );
}

/**
 * Diverging bar chart for the period position (mock §C).
 *
 * Daily: delta = cap − total per day; bars diverge from the zero-line —
 * green up (under budget) / red down (over budget). Container height
 * split 50/50 around the zero-line.
 * Full: fallback single-direction green bars (total only, upper half).
 *
 * When the period covers >= PERIOD_CHART_LINE_MIN_DAYS days the bars
 * auto-transform into an up-down SVG line chart (same zero-line semantics,
 * per-segment emerald/red coloring) so long periods stay readable without
 * horizontal scrolling.
 */
export function BudgetPeriodChart({ days, type }: BudgetPeriodChartProps) {
  if (days.length === 0) {
    return null;
  }

  const isDaily = type === "daily";

  if (isDaily) {
    const deltas = days as Array<{ date: string; total: number; delta: number }>;
    if (deltas.length >= PERIOD_CHART_LINE_MIN_DAYS) {
      return <DailyLineChart deltas={deltas} />;
    }
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
        <ChartFooter first={deltas[0]?.date ?? ""} />
      </div>
    );
  }

  const totals = days.map((d) => d.total);
  if (totals.length >= PERIOD_CHART_LINE_MIN_DAYS) {
    return <FullLineChart days={days} maxTotal={Math.max(...totals, 1)} />;
  }
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
      <ChartFooter first={days[0]?.date ?? ""} />
    </div>
  );
}

const LINE_W = 100;
const LINE_H = 48;
const LINE_MID = LINE_H / 2;
const LINE_AMP = LINE_H / 2 - 2;

/** Up-down line chart of daily deltas around the zero-line. */
function DailyLineChart({ deltas }: { deltas: Array<{ date: string; total: number; delta: number }> }) {
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d.delta)), 1);
  const x = (i: number): number => (deltas.length === 1 ? LINE_W / 2 : (i / (deltas.length - 1)) * LINE_W);
  const y = (delta: number): number => LINE_MID - (delta / maxAbs) * LINE_AMP;

  return (
    <div className="relative py-2" data-testid="budget-period-chart" role="img" aria-label="Grafik garis harian periode budget">
      <svg
        viewBox={`0 0 ${LINE_W} ${LINE_H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        data-testid="budget-period-line"
      >
        {/* Zero line */}
        <line x1="0" y1={LINE_MID} x2={LINE_W} y2={LINE_MID} strokeWidth="0.5" className="stroke-neutral-700" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
        {/* Per-segment line: emerald above zero, red below */}
        {deltas.slice(0, -1).map((day, i) => {
          const next = deltas[i + 1]!;
          const avg = (day.delta + next.delta) / 2;
          return (
            <line
              key={day.date}
              x1={x(i)}
              y1={y(day.delta)}
              x2={x(i + 1)}
              y2={y(next.delta)}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              className={avg >= 0 ? "stroke-emerald-500" : "stroke-red-500"}
            />
          );
        })}
        {/* Points */}
        {deltas.map((day, i) => (
          <circle
            key={day.date}
            cx={x(i)}
            cy={y(day.delta)}
            r="1.4"
            data-testid={`budget-period-point-${day.date}`}
            className={day.delta >= 0 ? "fill-emerald-400" : "fill-red-400"}
          >
            <title>
              {day.delta > 0
                ? `${day.date}: +${formatIDR(day.delta)} di bawah budget`
                : day.delta < 0
                  ? `${day.date}: ${formatIDR(-day.delta)} di atas budget`
                  : `${day.date}: pas budget`}
            </title>
          </circle>
        ))}
      </svg>
      <ChartFooter first={deltas[0]?.date ?? ""} />
    </div>
  );
}

/** Line chart of daily totals (full budgets — no daily allowance). */
function FullLineChart({ days, maxTotal }: { days: BudgetSeriesDay[]; maxTotal: number }) {
  const x = (i: number): number => (days.length === 1 ? LINE_W / 2 : (i / (days.length - 1)) * LINE_W);
  const y = (total: number): number => LINE_H - 2 - (total / maxTotal) * (LINE_H - 4);

  return (
    <div className="relative py-2" data-testid="budget-period-chart" role="img" aria-label="Grafik garis total harian periode budget">
      <svg
        viewBox={`0 0 ${LINE_W} ${LINE_H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        data-testid="budget-period-line"
      >
        {days.slice(0, -1).map((day, i) => {
          const next = days[i + 1]!;
          return (
            <line
              key={day.date}
              x1={x(i)}
              y1={y(day.total)}
              x2={x(i + 1)}
              y2={y(next.total)}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              className="stroke-emerald-500"
            />
          );
        })}
        {days.map((day, i) => (
          <circle key={day.date} cx={x(i)} cy={y(day.total)} r="1.4" data-testid={`budget-period-point-${day.date}`} className="fill-emerald-400">
            <title>{`${day.date}: ${formatIDR(day.total)}`}</title>
          </circle>
        ))}
      </svg>
      <ChartFooter first={days[0]?.date ?? ""} />
    </div>
  );
}
