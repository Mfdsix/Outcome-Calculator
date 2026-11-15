import { useMemo } from "react";

import type { BudgetHistoryItem, BudgetSeriesDay, BudgetStatus } from "@expense-app/shared";
import {
  budgetCapTotal,
  budgetProgressPct,
  dailySpendStats,
  formatDateShort,
  formatIDR,
  historicalForecast,
  inclusiveDayCount,
} from "@expense-app/shared";

import { BudgetPeriodChart } from "./BudgetPeriodChart";
import { ShimmerCard } from "./Shimmer";
import { APP_TIMEZONE } from "../lib/periods";

export interface BudgetPastCardProps {
  budget: BudgetHistoryItem;
  /**
   * Zero-filled day series for the WHOLE range (deltas already applied for
   * daily), or null while not loaded. Computed once by BudgetScreen and shared
   * with the day-history list below the card.
   */
  days: BudgetSeriesDay[] | null;
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
 * head (finished badge + final status + spent/cap + progress), the full
 * period chart, per-day insights, the historical forecast reflection, and
 * "Pakai lagi". No edit/delete: only the active budget can be changed.
 *
 * Daily budgets compare their range TOTAL against the range cap
 * (amount × days) — the per-day amount alone is not a total and produced
 * nonsense like "Rp2.500.000 / Rp70.000 · lewat Rp2.300.000".
 */
export function BudgetPastCard({
  budget,
  days,
  seriesLoading,
  seriesError,
  onUseAgain,
  onRetry,
}: BudgetPastCardProps) {
  const chip = STATUS_CHIP[budget.status];
  const isDaily = budget.type === "daily";
  const capTotal = budgetCapTotal(budget);
  const progressPct = budgetProgressPct(budget.spent, capTotal);
  const remaining = capTotal - budget.spent;
  const rangeDays = inclusiveDayCount(budget.startDate, budget.endDate);

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

  const stats = useMemo(
    () =>
      days === null
        ? null
        : dailySpendStats({ days, amount: budget.amount, type: budget.type }),
    [days, budget.amount, budget.type],
  );

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
        <span className="text-sm text-neutral-500"> / {formatIDR(capTotal)}</span>
      </p>
      {isDaily && (
        <p data-testid="budget-past-cap-caption" className="mt-0.5 text-[11px] text-neutral-500">
          {formatIDR(budget.amount)}/hari × {rangeDays} hari
        </p>
      )}

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
        {/* Real percentage (may exceed 100) — the bar itself stays clamped. */}
        <span className="tabular-nums">{progressPct}%</span>
      </div>

      {seriesLoading && days === null ? (
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

      {stats !== null && (
        <PastStatsGrid stats={stats} isDaily={isDaily} testid="budget-past-stats" />
      )}

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

/** One labelled figure inside the past-card insight grid. */
function PastStat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: string;
  tone?: string;
  testid: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</p>
      <p data-testid={testid} className={`truncate text-sm font-medium tabular-nums ${tone ?? "text-neutral-200"}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Insight grid (§6): daily average, days over the cap, and the most extreme
 * days. Best/worst come from `dailySpendStats` and skip no-spend days, so
 * "paling hemat" never just means "hari tanpa pengeluaran".
 */
function PastStatsGrid({
  stats,
  isDaily,
  testid,
}: {
  stats: ReturnType<typeof dailySpendStats>;
  isDaily: boolean;
  testid: string;
}) {
  const best = stats.bestDay;
  const worst = stats.worstDay;

  return (
    <div
      data-testid={testid}
      className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2"
    >
      <PastStat
        label="Rata-rata harian"
        value={formatIDR(stats.avgPerDay)}
        testid="budget-past-stat-avg"
      />
      {isDaily ? (
        <PastStat
          label="Hari lewat cap"
          value={`${stats.overDays ?? 0} dari ${stats.totalDays}`}
          tone={stats.overDays !== null && stats.overDays > 0 ? "text-red-300" : "text-emerald-300"}
          testid="budget-past-stat-overdays"
        />
      ) : (
        <PastStat
          label="Hari tanpa pengeluaran"
          value={`${stats.zeroDays} dari ${stats.totalDays}`}
          testid="budget-past-stat-zerodays"
        />
      )}
      {best !== null && (
        <PastStat
          label="Paling hemat"
          value={`${shortDate(best.date)} · +${formatIDR(best.delta)}`}
          tone="text-emerald-300"
          testid="budget-past-stat-best"
        />
      )}
      {worst !== null && (
        <PastStat
          label="Paling boros"
          value={`${shortDate(worst.date)} · −${formatIDR(-worst.delta)}`}
          tone="text-red-300"
          testid="budget-past-stat-worst"
        />
      )}
      {isDaily && stats.zeroDays > 0 && (
        <PastStat
          label="Hari tanpa pengeluaran"
          value={`${stats.zeroDays} dari ${stats.totalDays}`}
          testid="budget-past-stat-zerodays"
        />
      )}
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
