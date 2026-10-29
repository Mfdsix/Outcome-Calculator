import type { BudgetForecast, BudgetType } from "@expense-app/shared";
import { formatIDR } from "@expense-app/shared";

export interface ForecastBarProps {
  type: BudgetType;
  amount: number;
  forecast: BudgetForecast;
}

/**
 * Layer 2b (wireframe §5b) — compact projection between TodayCard and the
 * period card. Solid numbers are actual, this bar is always the projection:
 *
 * - FULL: projected total + signed delta, then remaining days × allowance.
 * - DAILY: average per day + today's cap and over-day count. Daily caps reset
 *   every day, so there is deliberately no nominal projection.
 *
 * Hidden entirely before the first elapsed day (`available: false`).
 */
export function ForecastBar({ type, amount, forecast }: ForecastBarProps) {
  if (!forecast.available) return null;

  if (type === "full") {
    const delta = forecast.projectedDelta ?? 0;
    const over = delta < 0;
    return (
      <div
        data-testid="budget-forecast"
        className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3"
      >
        <p className="text-[10px] uppercase tracking-widest text-neutral-500">Proyeksi</p>
        <p className="mt-0.5 flex items-baseline gap-2">
          <span
            data-testid="budget-forecast-total"
            className={`text-lg font-semibold tabular-nums ${over ? "text-red-300" : "text-emerald-300"}`}
          >
            {formatIDR(forecast.projectedTotal ?? 0)}
          </span>
          <span
            data-testid="budget-forecast-delta"
            className={`text-xs tabular-nums ${over ? "text-red-400" : "text-emerald-400"}`}
          >
            ({over ? `over ${formatIDR(-delta)}` : `under ${formatIDR(delta)}`})
          </span>
        </p>
        {forecast.allowedPerDay !== null && (
          <p
            data-testid="budget-forecast-allowed"
            className="mt-0.5 text-xs text-neutral-500"
          >
            sisa {forecast.remainingDays} hari · boleh {formatIDR(forecast.allowedPerDay)}/hari
          </p>
        )}
      </div>
    );
  }

  const overDays = forecast.overDays ?? 0;
  return (
    <div
      data-testid="budget-forecast"
      className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3"
    >
      <p className="text-[10px] uppercase tracking-widest text-neutral-500">Proyeksi</p>
      <p data-testid="budget-forecast-avg" className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-100">
        Rata-rata {formatIDR(forecast.avgPerDay)}
        <span className="text-xs font-normal text-neutral-500">/hari</span>
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">
        dari cap {formatIDR(amount)} ·{" "}
        <span data-testid="budget-forecast-days-over" className={overDays > 0 ? "text-red-400" : "text-emerald-400"}>
          {overDays} dari {forecast.elapsedDays} hari over
        </span>
      </p>
    </div>
  );
}
