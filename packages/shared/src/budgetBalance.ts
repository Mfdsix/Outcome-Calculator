import { civilToday, formatCivilDate, inclusiveDayCount } from "./budget";
import type { BudgetType } from "./budget";
import { budgetStatus, BUDGET_WARN_PCT } from "./budget";

export interface BudgetBalance {
  /** Cumulative fair line (jalur wajar) at today: amount × (dayIndex / totalDays). */
  fair: number;
  /** Spent minus fair: > 0 = boros (minus), < 0 = hemat (surplus). */
  dev: number;
  /** ±10% threshold (of cap) below which we say "di jalur wajar". */
  threshold: number;
  /** Days strictly after today (for recovery math). */
  daysLeft: number;
  /** Total inclusive days in the budget range. */
  totalDays: number;
  /** 1-based civil day index of today within range. */
  dayIndex: number;
  /** Remaining amount — cap - spent. */
  remaining: number;
  /** Whether the budget period is fully past today. */
  finished: boolean;
  /** Whether the budget has not started yet. */
  upcoming: boolean;
}

/** Pace deviation threshold as a percent of the (full/daily) budget cap. */
export const BALANCE_DEVIATION_PCT = 10;

/**
 * Pure budget-pace + balance derivation (spec plan §3: Budget aktif fokus).
 * Works for BOTH "full" (cumulative jalur wajar) and "daily" (per-day cap):
 *   - full: fair = round(amount × dayIndex / totalDays)
 *   - daily: fair = amount × dayIndex  (sum of daily caps through today)
 *
 * Returns a neutral object when the period is finished or not yet started —
 * the caller decides what to display.
 */
export function budgetBalance(
  budget: {
    type: BudgetType;
    amount: number;
    startDate: string;
    endDate: string;
    spent: number;
  },
  todayKey: string,
  timeZone: string,
): BudgetBalance {
  const todayParts = civilToday(timeZone, new Date());

  const totalDays = inclusiveDayCount(budget.startDate, budget.endDate);
  const remaining = budget.amount - budget.spent;

  const finished = todayKey > budget.endDate;
  const upcoming = todayKey < budget.startDate;

  if (finished) {
    return {
      fair: budget.amount,
      dev: budget.spent - budget.amount,
      threshold: Math.round((budget.amount * BALANCE_DEVIATION_PCT) / 100),
      daysLeft: 0,
      totalDays,
      dayIndex: totalDays,
      remaining,
      finished: true,
      upcoming: false,
    };
  }

  if (upcoming) {
    return {
      fair: 0,
      dev: 0,
      threshold: Math.round((budget.amount * BALANCE_DEVIATION_PCT) / 100),
      daysLeft: totalDays,
      totalDays,
      dayIndex: 0,
      remaining,
      finished: false,
      upcoming: true,
    };
  }

  // todayKey is within [startDate, endDate].
  const dayIndex = inclusiveDayCount(budget.startDate, todayKey);
  const daysLeft = totalDays - dayIndex; // days strictly after today

  const fair =
    budget.type === "full"
      ? Math.round((budget.amount * dayIndex) / totalDays)
      : budget.amount * dayIndex;

  const threshold = Math.round((budget.amount * BALANCE_DEVIATION_PCT) / 100);

  return {
    fair,
    dev: budget.spent - fair,
    threshold,
    daysLeft,
    totalDays,
    dayIndex,
    remaining,
    finished: false,
    upcoming: false,
  };
}
