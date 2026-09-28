import { addCivilDays } from "./periods";
import {
  inclusiveDayCount,
  formatCivilDate,
  civilToday,
} from "./budget";
import type { BudgetType, BudgetStatus } from "./budget";
import type { BudgetDayPoint } from "./types";

export interface FilledSeriesDay {
  date: string;
  total: number;
}

export interface DailyDelta {
  date: string;
  total: number;
  /** cap − total for THIS day; > 0 = under, < 0 = over. Only for daily budgets. */
  delta: number;
}

export type BudgetSeriesDay = FilledSeriesDay | DailyDelta;

export interface PeriodPosition {
  /** Cumulative amount spent from startDate through today (clamped to range). */
  spent: number;
  /** Cumulative allowance through today: amount × elapsedDays (daily) or amount (full). */
  allowance: number;
  /** Signed position: allowance − spent. > 0 = under budget, < 0 = behind. */
  position: number;
  /** For Full: remaining = amount − spent. For Daily: remaining = today's cap − todaySpent. */
  remaining: number;
  /** Progress: spent / (amount × elapsedDays) for daily; spent / amount for full. */
  progressPct: number;
  /** Status ladder: over → warning → ok. */
  status: BudgetStatus;
  /** Days from startDate through today (inclusive). */
  elapsedDays: number;
  /** Total inclusive days in the budget range. */
  totalDays: number;
  /** Streak of consecutive days ending today on the same side of delta (≥2 to display). */
  streak: { count: number; under: boolean; active: boolean } | null;
}

export interface BudgetDashboardData {
  /** Full day-by-day series (zero-filled) from startDate to today (or endDate). */
  days: BudgetSeriesDay[];
  /** Today's spending — from the active budget DTO (already computed by server). */
  todaySpent: number;
  /** The active budget amount (cap). */
  amount: number;
  type: BudgetType;
  startDate: string;
  endDate: string;
  /** Total inclusive days in [startDate, endDate] (for the full-type pace line). */
  totalRangeDays: number;
  periodPosition: PeriodPosition;
}

/** Streak threshold: only display when ≥ 2 consecutive days align. */
export const STREAK_MIN_DAYS = 2;

/**
 * Zero-fill a sparse day series from startDate to endKey (inclusive).
 * Days with no server data get total 0.
 */
export function fillDaySeries(
  sparse: BudgetDayPoint[],
  startDate: string,
  endDate: string,
): FilledSeriesDay[] {
  const totalDays = inclusiveDayCount(startDate, endDate);
  const byDate = new Map(sparse.map((d) => [d.date, d.total]));
  const days: FilledSeriesDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addCivilDays(parseDate(startDate), i);
    const key = formatCivilDate(date);
    days.push({ date: key, total: byDate.get(key) ?? 0 });
  }
  return days;
}

/** Parse "YYYY-MM-DD" → CivilDate. */
function parseDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

/**
 * Compute per-day deltas for DAILY budgets: delta = cap − total per day.
 * Returns the same day entries (no-op for full budgets — no daily allowance).
 */
export function dailyDeltas(
  days: FilledSeriesDay[],
  cap: number,
  type: BudgetType,
): BudgetSeriesDay[] {
  if (type === "full") {
    return days;
  }
  return days.map((day) => ({
    date: day.date,
    total: day.total,
    delta: cap - day.total,
  }));
}

/**
 * Compute the cumulative period position and streak from a day series.
 *
 * For DAILY: allowance = amount × elapsedDays, spent = Σ(totals), progress =
 * spent / allowance, remaining = allowance − spent.
 * For FULL: spent = Σ(totals) (whole range), progress = spent / amount,
 * remaining = amount − spent (daily delta is not meaningful — not computed).
 *
 * Streak: longest run from today backward where each day's delta has the same
 * sign. For full budgets, streak is null (no daily cap to compare against).
 */
export function periodPosition(
  days: BudgetSeriesDay[],
  amount: number,
  type: BudgetType,
  todaySpent: number,
  timeZone: string,
  nowISO: string,
): PeriodPosition {
  // Days from startDate through today (inclusive). buildDashboardData always
  // clamps the series end to today, so today should be the last entry; guard
  // anyway (upcoming budgets / empty series) to never crash or misattribute.
  const todayKey = formatCivilDate(civilToday(timeZone, new Date(nowISO)));
  const foundIndex = days.findIndex((d) => d.date === todayKey);
  const dayIndex = foundIndex < 0 ? days.length - 1 : foundIndex;
  const elapsedDays = dayIndex < 0 ? 0 : dayIndex + 1;

  const spent = days.reduce((sum, d) => sum + d.total, 0);
  const allowance = type === "daily" ? amount * elapsedDays : amount;
  const remaining = Math.max(0, allowance - spent);
  const progressPct = allowance > 0 ? Math.round((spent / allowance) * 100) : 0;
  const status = computeStatus(spent, allowance, amount, type, todaySpent);

  const streak =
    type === "daily" && dayIndex >= 0
      ? computeStreak(days as DailyDelta[], dayIndex, amount)
      : null;

  return {
    spent,
    allowance,
    position: allowance - spent,
    remaining,
    progressPct,
    status,
    elapsedDays,
    totalDays: days.length,
    streak,
  };
}

function computeStatus(
  spent: number,
  allowance: number,
  amount: number,
  type: BudgetType,
  todaySpent: number,
): BudgetStatus {
  if (type === "daily") {
    return todaySpent > amount
      ? "over"
      : todaySpent * 100 >= amount * 80
        ? "warning"
        : "ok";
  }
  // Full: cumulative pace against the whole cap.
  if (spent > amount) return "over";
  if (spent * 100 >= amount * 80) return "warning";
  return "ok";
}

/**
 * Streak from today backward: consecutive days with the same deviation sign.
 * Returns null if < STREAK_MIN_DAYS or if today isn't found in the series.
 */
function computeStreak(
  days: DailyDelta[],
  todayIndex: number,
  cap: number,
): { count: number; under: boolean; active: boolean } | null {
  if (todayIndex < 0) return null;

  const todayEntry = days[todayIndex];
  if (!todayEntry) return null;
  const todayDelta = todayEntry.delta;
  const todayIsUnder = todayDelta >= 0; // delta >= 0 means under or on track
  let count = 0;

  for (let i = todayIndex; i >= 0; i--) {
    const entry = days[i];
    if (!entry) break;
    const delta = entry.delta;
    const isUnder = delta >= 0;
    if (isUnder === todayIsUnder) {
      count++;
    } else {
      break;
    }
  }

  if (count < STREAK_MIN_DAYS) return null;

  return {
    count,
    under: todayIsUnder,
    active: todayDelta === cap, // today exactly on track → "on track" feel
  };
}

/**
 * Build the full dashboard data from a sparse server series + the active budget
 * snapshot. Zero-fills, computes deltas, and derives period position.
 */
export function buildDashboardData(
  budget: {
    type: BudgetType;
    amount: number;
    startDate: string;
    endDate: string;
    todaySpent: number;
  },
  sparseDays: BudgetDayPoint[],
  nowISO: string,
  timeZone: string,
): BudgetDashboardData {
  const todayKey = formatCivilDate(civilToday(timeZone, new Date(nowISO)));
  // Clamp end to today so we never show future days.
  const endKey = todayKey <= budget.endDate ? todayKey : budget.endDate;
  const daysRaw = fillDaySeries(sparseDays, budget.startDate, endKey);
  const days = dailyDeltas(daysRaw, budget.amount, budget.type) as BudgetSeriesDay[];

  return {
    days,
    todaySpent: budget.todaySpent,
    amount: budget.amount,
    type: budget.type,
    startDate: budget.startDate,
    endDate: budget.endDate,
    totalRangeDays: inclusiveDayCount(budget.startDate, budget.endDate),
    periodPosition: periodPosition(days, budget.amount, budget.type, budget.todaySpent, timeZone, nowISO),
  };
}
