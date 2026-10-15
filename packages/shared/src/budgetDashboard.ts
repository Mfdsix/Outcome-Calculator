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

// ---------------------------------------------------------------------------
// Win streak (plan §5: "Winstreak")
// ---------------------------------------------------------------------------

/** A run of consecutive win days (delta >= 0) — always ends at today. */
export interface WinRun {
  /** Inclusive start date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end date (YYYY-MM-DD). Always the last index in the run. */
  endDate: string;
  /** Number of days in the run. */
  count: number;
  /** Total saved = Σ delta across the run. */
  saving: number;
  /** Index of the end day within the series. */
  endIndex: number;
}

/** Win-streak computation result. All fields are null when there's nothing
 * to show (no active budget, today over budget with no prior wins, etc.). */
export interface WinStreakResult {
  /** Current run ending today — may be a single day (count 1). live=true
   * because today is still in progress and the run can break intraday. */
  current: WinRun | null;
  /** Longest run in history, regardless of whether it touches today. */
  longest: WinRun | null;
  /** Run with the largest cumulative saving (Σ delta), regardless of length. */
  biggestSaving: WinRun | null;
}

/**
 * Compute win streaks from a daily-delta series.
 *
 * A "win" is a day with delta >= 0 (spent ≤ cap). Runs of wins are maximal
 * consecutive sequences of win days; an over day (delta < 0) breaks a run.
 *
 * - current: the run ending today (may be 1 day when today is the only win).
 *   live=true is conveyed by the caller via `todayKey`; this function only
 *   returns the run shape, and the caller tags it live.
 * - longest: the longest run anywhere in the series.
 * - biggestSaving: the run with the largest Σ delta (saving).
 *
 * Only meaningful for daily budgets (the series is DailyDelta[]). For
 * full budgets the caller should not invoke this (days lack delta).
 */
export function computeWinStreaks(
  days: DailyDelta[],
  todayKey: string,
): WinStreakResult {
  if (days.length === 0) return { current: null, longest: null, biggestSaving: null };

  // Build all maximal runs of consecutive win days.
  const runs: WinRun[] = [];
  let runStart: number | null = null;
  let runSum = 0;

  for (let i = 0; i < days.length; i++) {
    const delta = days[i]?.delta;
    if (delta === undefined) continue;
    if (delta >= 0) {
      if (runStart === null) {
        runStart = i;
        runSum = 0;
      }
      runSum += delta;
    } else {
      if (runStart !== null) {
        const endIndex = i - 1;
        const start = days[runStart]!;
        const end = days[endIndex]!;
        runs.push({
          startDate: start.date,
          endDate: end.date,
          count: endIndex - runStart + 1,
          saving: runSum,
          endIndex,
        });
        runStart = null;
        runSum = 0;
      }
    }
  }
  // Close any trailing run that reaches the end of the series.
  if (runStart !== null) {
    const endIndex = days.length - 1;
    const start = days[runStart]!;
    const end = days[endIndex]!;
    runs.push({
      startDate: start.date,
      endDate: end.date,
      count: endIndex - runStart + 1,
      saving: runSum,
      endIndex,
    });
  }

  if (runs.length === 0) return { current: null, longest: null, biggestSaving: null };

  // Current = run whose endIndex is the last day AND that last day is today.
  const lastDay = days[days.length - 1];
  let current: WinRun | null = null;
  if (lastDay && lastDay.date === todayKey) {
    for (const run of runs) {
      if (run.endIndex === days.length - 1) {
        current = run;
        break;
      }
    }
  }

  // Longest run (ties → first/longest found).
  let longest = runs[0]!;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]!.count > longest.count) longest = runs[i]!;
  }

  // Biggest saving run (Σ delta).
  let biggestSaving = runs[0]!;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]!.saving > biggestSaving.saving) biggestSaving = runs[i]!;
  }

  return { current, longest, biggestSaving };
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
