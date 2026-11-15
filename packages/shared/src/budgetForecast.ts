import { addCivilDays } from "./periods";
import { inclusiveDayCount } from "./budget";
import type { BudgetType } from "./budget";
import type { BudgetSeriesDay } from "./budgetDashboard";

/**
 * Forecast (plan §2.1): derived, client-side, never persisted.
 *
 * `budgetForecast` works on the ACTIVE budget series, which
 * `buildDashboardData` already zero-fills and clamps to today — so
 * `elapsedDays === days.length` (except the guard when today is before the
 * start date, which yields an empty series → unavailable).
 *
 * `historicalForecast` works on the FULL series of a finished budget
 * (start → end, no clamp) and compares the pace of the first half of the
 * period against what actually happened.
 */

export interface ForecastInput {
  type: BudgetType;
  amount: number;
  /** Inclusive civil dates YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** Zero-filled day series (output of buildDashboardData). */
  days: BudgetSeriesDay[];
  /** Today's spend (Jakarta) — from the active budget DTO. */
  todaySpent: number;
  /** Injectable clock for tests. */
  now: Date;
  timeZone: string;
}

export interface BudgetForecast {
  /** false while elapsedDays < 1 (period has not started). */
  available: boolean;
  /** spent / elapsedDays (integer IDR). */
  avgPerDay: number;
  elapsedDays: number;
  /** Days AFTER today, clamped ≥ 0. */
  remainingDays: number;
  /** FULL only: spent + avgPerDay × remainingDays. DAILY: null. */
  projectedTotal: number | null;
  /** FULL only: amount − projectedTotal (>0 under, <0 over). DAILY: null. */
  projectedDelta: number | null;
  /**
   * FULL: (amount − spent) / remainingDays, null when remainingDays = 0.
   * DAILY: amount − todaySpent (what is left of today's cap).
   */
  allowedPerDay: number | null;
  /** DAILY only: number of days whose daily delta is negative. FULL: null. */
  overDays: number | null;
  /** Total inclusive days in the range (for "N dari M hari"). */
  totalDays: number;
}

function sumTotals(days: BudgetSeriesDay[]): number {
  return days.reduce((sum, day) => sum + day.total, 0);
}

/**
 * Project the active budget's outcome from the elapsed pace.
 *
 * - available = false when the range has not started (no elapsed day yet).
 * - remainingDays = totalDays − elapsedDays (today excluded, clamped ≥ 0).
 * - FULL: projectedTotal = spent + avgPerDay × remainingDays.
 * - DAILY: caps reset every day, so there is no meaningful nominal
 *   projection (projectedTotal/projectedDelta stay null); overDays counts
 *   the days that already exceeded the daily cap.
 */
export function budgetForecast(input: ForecastInput): BudgetForecast {
  const totalDays = inclusiveDayCount(input.startDate, input.endDate);
  const elapsedDays = Math.min(Math.max(input.days.length, 0), totalDays);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const spent = sumTotals(input.days);

  if (elapsedDays < 1) {
    return {
      available: false,
      avgPerDay: 0,
      elapsedDays: 0,
      remainingDays,
      projectedTotal: null,
      projectedDelta: null,
      allowedPerDay: null,
      overDays: null,
      totalDays,
    };
  }

  const avgPerDay = Math.round(spent / elapsedDays);

  if (input.type === "daily") {
    return {
      available: true,
      avgPerDay,
      elapsedDays,
      remainingDays,
      projectedTotal: null,
      projectedDelta: null,
      allowedPerDay: input.amount - input.todaySpent,
      overDays: input.days.filter((day) => day.total > input.amount).length,
      totalDays,
    };
  }

  const projectedTotal = spent + avgPerDay * remainingDays;

  return {
    available: true,
    avgPerDay,
    elapsedDays,
    remainingDays,
    projectedTotal,
    projectedDelta: input.amount - projectedTotal,
    allowedPerDay:
      remainingDays > 0
        ? Math.max(0, Math.round((input.amount - spent) / remainingDays))
        : null,
    overDays: null,
    totalDays,
  };
}

export interface HistoricalForecastInput {
  type: BudgetType;
  amount: number;
  startDate: string;
  endDate: string;
  /** FULL series of the finished range (start → end). */
  days: BudgetSeriesDay[];
  timeZone: string;
  now: Date;
}

export interface HistoricalForecast {
  /** false for daily budgets or ranges shorter than 2 days. */
  available: boolean;
  /** First-half pace × totalDays. */
  projectedTotal: number | null;
  /** Σ totals of the full range. */
  actualTotal: number;
  /**
   * actualTotal − projectedTotal. Negative = reality spent less than the
   * first-half pace predicted ("better").
   */
  surprise: number | null;
  /** close = |surprise| < 10% of amount. */
  tone: "better" | "worse" | "close";
}

/**
 * Compare the first-half pace of a finished budget against reality.
 *
 * Daily budgets intentionally return `available: false`: a daily cap resets
 * every day, so "predicted total at mid-period" carries no meaning — the
 * UI shows a "N dari M hari under cap" summary instead.
 */
export function historicalForecast(input: HistoricalForecastInput): HistoricalForecast {
  const totalDays = inclusiveDayCount(input.startDate, input.endDate);
  const actualTotal = sumTotals(input.days);

  if (input.type === "daily" || totalDays < 2 || input.days.length < 2) {
    return { available: false, projectedTotal: null, actualTotal, surprise: null, tone: "close" };
  }

  const halfDays = Math.ceil(totalDays / 2);
  const firstHalf = input.days.slice(0, halfDays);
  const firstHalfTotal = sumTotals(firstHalf);
  const projectedTotal = Math.round((firstHalfTotal / halfDays) * totalDays);
  const surprise = actualTotal - projectedTotal;
  const closeThreshold = input.amount * 0.1;

  const tone: HistoricalForecast["tone"] =
    Math.abs(surprise) < closeThreshold ? "close" : surprise < 0 ? "better" : "worse";

  return { available: true, projectedTotal, actualTotal, surprise, tone };
}

/** Civil date `offset` days after `date` (helper for chart projections). */
export function addDaysToCivil(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = addCivilDays({ year, month, day }, offset);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${shifted.year}-${pad(shifted.month)}-${pad(shifted.day)}`;
}

/** The most extreme day of a finished period (best/worst vs the daily cap). */
export interface DailyHighlight {
  date: string;
  /** Spend on that day. */
  total: number;
  /** cap − total; > 0 under the cap, < 0 over it. */
  delta: number;
}

export interface DailySpendStats {
  /** Days in the series (zero-filled range). */
  totalDays: number;
  /** Σ of every day's total. */
  spent: number;
  /** Rata-rata kalender: round(spent / totalDays). */
  avgPerDay: number;
  /** Days with no spending at all. */
  zeroDays: number;
  /** DAILY only: days whose spend exceeded the cap. FULL: null. */
  overDays: number | null;
  /** DAILY only: spending days that stayed at/under the cap. FULL: null. */
  underDays: number | null;
  /**
   * DAILY only: the day with the largest positive delta (most under cap).
   * Days with no spending are EXCLUDED — they would always win and tell the
   * user nothing (`zeroDays` reports them separately). null when no day
   * landed under the cap. FULL: null.
   */
  bestDay: DailyHighlight | null;
  /** DAILY only: the day with the largest negative delta. FULL: null. */
  worstDay: DailyHighlight | null;
}

/**
 * Per-day stats for a finished budget period (past card insights).
 *
 * `days` must be the zero-filled series for the WHOLE range. Ties keep the
 * EARLIEST date (the series is chronological), so the result is deterministic.
 */
export function dailySpendStats(input: {
  days: Array<{ date: string; total: number }>;
  amount: number;
  type: BudgetType;
}): DailySpendStats {
  const { days, amount, type } = input;
  const totalDays = days.length;
  const spent = sumTotals(days);
  const avgPerDay = totalDays > 0 ? Math.round(spent / totalDays) : 0;

  let zeroDays = 0;
  let overDays = 0;
  let underDays = 0;
  let bestDay: DailyHighlight | null = null;
  let worstDay: DailyHighlight | null = null;

  for (const day of days) {
    if (day.total === 0) {
      zeroDays += 1;
      continue;
    }
    if (type !== "daily") continue;

    const delta = amount - day.total;
    if (delta < 0) {
      overDays += 1;
      if (worstDay === null || delta < worstDay.delta) {
        worstDay = { date: day.date, total: day.total, delta };
      }
    } else {
      underDays += 1;
      if (delta > 0 && (bestDay === null || delta > bestDay.delta)) {
        bestDay = { date: day.date, total: day.total, delta };
      }
    }
  }

  const isDaily = type === "daily";
  return {
    totalDays,
    spent,
    avgPerDay,
    zeroDays,
    overDays: isDaily ? overDays : null,
    underDays: isDaily ? underDays : null,
    bestDay: isDaily ? bestDay : null,
    worstDay: isDaily ? worstDay : null,
  };
}
