import { useMemo } from "react";

import type { BudgetDayPoint, BudgetHistoryItem, BudgetStatus } from "@expense-app/shared";
import {
  budgetProgressPct,
  dailyDeltas,
  fillDaySeries,
  formatDateShort,
  formatIDR,
  historicalForecast,
} from "@expense-app/shared";

import { BudgetPeriodChart } from "./BudgetPeriodChart";
import { ShimmerCard } from "./Shimmer";
import { APP_TIMEZONE } from "../lib/periods";

export interface BudgetPastCardProps {
  budget: BudgetHistoryItem;
  /** Sparse series (full range) or null while not loaded. */
  series: BudgetDayPoint[] | null;
  seriesLoading: boolean;
  seriesError: string | null;
  onUseAgain: () => void;
  onRetry: () => void;
}

const STATUS_CHIP: Record<BudgetStatus, { label: string; className: string }> = {
  ok: { label: "Aman", className: "text-emerald-300 border-emerald-800 bg-emerald-950/40" },
  warning: { label: "Hampir habis", className: "text-amber-300 border-amber-800 bg-amber-950/40" },
  over: { label: "Lewat batas", className: "text-red-300 border-red-800 bg-red-950/40" },
};

function shortDate(date: string): string {
  return formatDateShort(new Date(`${date}T12:00:00+07:00`), APP_TIMEZONE);
}

/**
 * Layer 3 (wireframe §6) — one compact card for a focused past budget:
 * head (finished badge + final status + spent/amount + progress), the full
 * period chart, the historical forecast reflection, and "Pakai lagi".
 * No edit/delete: only the active budget can be changed.
 */
export function BudgetPastCard({
  budget,
  series,
  seriesLoading,
  seriesError,
  onUseAgain,
  onRetry,
}: BudgetPastCardProps) {
  const chip = STATUS_CHIP[budget.status];
  const progressPct = budgetProgressPct(budget.spent, budget.amount);
  const remaining = budget.amount - budget.spent;

  const days = useMemo(
    () =>
      series === null
        ? null
        : dailyDeltas(
            fillDaySeries(series, budget.startDate, budget.endDate),
            budget.amount,
            budget.type,
          ),
    [series, budget.startDate, budget.endDate, budget.amount, budget.type],
  );

  const reflected = useMemo(() => {
    if (days === null) return null;
    return historicalForecast({
      type: budget.type,
      amount: budget.amount,
      startDate: budget.startDate,
      endDate: budget.endDate,
      days,
      timeZone: APP_TIMEZONE,
      now: new Date(),
    });
  }, [days, budget.type, budget.amount, budget.startDate, budget.endDate]);

  return (
    <div
      data-testid="budget-past-card"
      className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          Selesai · {shortDate(budget.startDate)} – {shortDate(budget.endDate)}
        </span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chip.className}`}>
          {chip.label}
        </span>
      </div>

      <p className="mt-1 font-light tabular-nums text-neutral-50">
        <span data-testid="budget-past-spent" className="text-2xl">
          {formatIDR(budget.spent)}
        </span>
        <span className="text-sm text-neutral-500"> / {formatIDR(budget.amount)}</span>
      </p>

      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, progressPct)}
        aria-label="Progres budget selesai"
      >
        <div
          className="h-full rounded-full bg-neutral-600"
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-neutral-500">
        <span data-testid="budget-past-remaining">
          {remaining >= 0
            ? `tersisa ${formatIDR(remaining)} dari cap`
            : `lewat ${formatIDR(-remaining)} dari cap`}
        </span>
        <span className="tabular-nums">{Math.min(100, progressPct)}%</span>
      </div>

      {seriesLoading && series === null ? (
        <ShimmerCard testid="budget-past-loading" label="Memuat riwayat budget" className="mt-3 h-32 w-full" />
      ) : seriesError !== null ? (
        <div
          data-testid="budget-past-error"
          className="mt-3 rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300"
        >
          <p>Gagal memuat riwayat budget.</p>
          <button
            type="button"
            data-testid="budget-past-retry"
            onClick={onRetry}
            className="mt-2 rounded-lg border border-red-800 px-2.5 py-1 text-xs font-semibold text-red-200 active:bg-red-950"
          >
            Coba lagi
          </button>
        </div>
      ) : days !== null ? (
        <div className="mt-2">
          <BudgetPeriodChart days={days} type={budget.type} />
        </div>
      ) : null}

      {reflected !== null && reflected.available && (
        <HistoricalForecastRow reflected={reflected} amount={budget.amount} />
      )}
      {reflected !== null && !reflected.available && budget.type === "daily" && days !== null && (
        <p
          data-testid="budget-past-forecast"
          className="mt-2 rounded-lg bg-neutral-800/40 px-3 py-2 text-xs text-neutral-400"
        >
          {days.filter((day) => day.total <= budget.amount).length} dari {days.length} hari under cap
        </p>
      )}

      <button
        type="button"
        data-testid="budget-past-use-again"
        onClick={onUseAgain}
        className="mt-3 w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
      >
        Pakai lagi →
      </button>
    </div>
  );
}

/** Layer 6b (wireframe §6b) — "PREDIKSI WAKTU ITU" reflection row. */
function HistoricalForecastRow({
  reflected,
  amount,
}: {
  reflected: ReturnType<typeof historicalForecast>;
  amount: number;
}) {
  const projectedTotal = reflected.projectedTotal ?? 0;
  const predictedDelta = amount - projectedTotal;
  const actualDelta = amount - reflected.actualTotal;
  const predicted = predictedDelta >= 0 ? "under" : "over";
  const actual = actualDelta >= 0 ? "under" : "over";

  let predLine: string;
  let actualLine: string;
  if (reflected.tone === "close") {
    predLine = "prediksi meleset tipis";
    actualLine = "realita hampir tepat.";
  } else if (reflected.tone === "better") {
    predLine = `diprediksi ${predicted} ${formatIDR(Math.abs(predictedDelta))}`;
    actualLine =
      actual === "under"
        ? `ternyata under ${formatIDR(Math.abs(actualDelta))}. ${
            predicted === "over" ? "Mantap." : "Konsisten."
          }`
        : `ternyata over ${formatIDR(Math.abs(actualDelta))}, tapi lebih hemat.`;
  } else {
    predLine = `diprediksi ${predicted} ${formatIDR(Math.abs(predictedDelta))}`;
    actualLine =
      predicted === "under"
        ? `ternyata over ${formatIDR(Math.abs(actualDelta))}. Next time.`
        : `realita over ${formatIDR(Math.abs(actualDelta))}. Meleset ${formatIDR(Math.abs(reflected.surprise ?? 0))}.`;
  }

  const toneClass =
    reflected.tone === "better"
      ? "text-emerald-300"
      : reflected.tone === "worse"
        ? "text-red-300"
        : "text-neutral-300";

  return (
    <div
      data-testid="budget-past-forecast"
      className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2"
    >
      <p className="text-[10px] uppercase tracking-widest text-neutral-500">Prediksi waktu itu</p>
      <p className={`mt-0.5 text-xs leading-relaxed ${toneClass}`}>
        <span data-testid="budget-past-forecast-pred">Paruh periode: {predLine}</span>
        {" — "}
        <span data-testid="budget-past-forecast-actual">{actualLine}</span>
      </p>
    </div>
  );
}
