import { addCivilDays } from "./periods";
import { formatCivilDate, inclusiveDayCount, parseCivilDate } from "./budget";
import type { BudgetType } from "./budget";

/**
 * Daily recovery planner (Insight menu): when the budget is in the red —
 * CUMULATIVE, `spent` across the whole running range vs `cap × elapsed days`
 * — how much must be saved per day, and for how many days, to get back to
 * break-even (+0) by the horizon?
 *
 * Semantics: a daily cap resets every day, so an accumulated overrun is never
 * absorbed automatically. Closing `deficit` over N upcoming days means
 * spending at most `cap − ceil(deficit / N)₍₁₀₀₀₎` on each of those days
 * (future days keep adding `cap` of allowance, hence the same formula).
 *
 * Pure, no fetch: same input → same output (`todayKey` is injected).
 */

/** Savings are rounded UP to this step (Rp1.000), matching `full-recover`. */
export const RECOVERY_ROUNDING = 1_000;

export interface RecoveryOption {
  /** Days after today that this plan covers (clamped to ≥ 1). */
  days: number;
  /** Required daily saving, rounded up to RECOVERY_ROUNDING. */
  savingsPerDay: number;
  /** Daily spend target: `cap − savingsPerDay`, floored at 0. */
  targetPerDay: number;
  /**
   * false when `savingsPerDay > cap` — i.e. even spending NOTHING for `days`
   * cannot offset the deficit (see `minDaysToBreakEven`).
   */
  reachable: boolean;
  /** Civil date (YYYY-MM-DD) the break-even lands on. */
  endDate: string;
}

export interface RecoveryPlan {
  /** false unless: daily budget, cap > 0, today inside the range, behind. */
  available: boolean;
  /** Today's civil date (YYYY-MM-DD) — needed to date each horizon. */
  todayKey: string;
  /** The budget's last civil date (YYYY-MM-DD). */
  endDate: string;
  /** Per-day cap (the number the user typed). */
  dailyCap: number;
  /** Days from the start date through today (inclusive). */
  elapsedDays: number;
  /** Cumulative spend for those elapsed days. */
  spentToDate: number;
  /** What the elapsed days were allowed to cost: `cap × elapsedDays`. */
  allowanceToDate: number;
  /** `spentToDate − allowanceToDate`; > 0 when the plan is available. */
  deficit: number;
  /** Days AFTER today through the budget's end date (clamped ≥ 0). */
  daysLeft: number;
  /** Days of zero spending needed to offset the deficit. */
  minDaysToBreakEven: number;
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Numbers for ONE horizon: how much to save per day, the resulting daily
 * target, and the date break-even lands on. `days` is clamped to ≥ 1.
 */
export function recoveryOption(input: {
  todayKey: string;
  days: number;
  deficit: number;
  dailyCap: number;
}): RecoveryOption {
  const days = Math.max(1, Math.round(input.days));
  const savingsPerDay = roundUpTo(input.deficit / days, RECOVERY_ROUNDING);
  return {
    days,
    savingsPerDay,
    targetPerDay: Math.max(0, input.dailyCap - savingsPerDay),
    reachable: savingsPerDay <= input.dailyCap,
    endDate: formatCivilDate(addCivilDays(parseCivilDate(input.todayKey), days)),
  };
}

/**
 * Build the fixed facts of a recovery plan for a DAILY budget.
 *
 * `full` budgets return `available: false` — they have no per-day reset, and
 * the pace-based `full-recover` insight already covers them.
 */
export function recoveryPlan(input: {
  type: BudgetType;
  amount: number;
  startDate: string;
  endDate: string;
  /** Today's civil date (YYYY-MM-DD) inside the range. */
  todayKey: string;
  /**
   * Cumulative spend from `startDate` through `todayKey` (the same figure the
   * budget screen's period position uses). NOT "today only".
   */
  spentToDate: number;
}): RecoveryPlan {
  const { type, amount, startDate, endDate, todayKey, spentToDate } = input;

  const empty: RecoveryPlan = {
    available: false,
    todayKey,
    endDate,
    dailyCap: amount,
    elapsedDays: 0,
    spentToDate,
    allowanceToDate: 0,
    deficit: 0,
    daysLeft: 0,
    minDaysToBreakEven: 0,
  };

  if (type !== "daily" || amount <= 0) return empty;
  // Outside the range: nothing to plan against.
  if (todayKey < startDate || todayKey > endDate) return empty;

  const elapsedDays = inclusiveDayCount(startDate, todayKey);
  const allowanceToDate = amount * elapsedDays;
  const deficit = spentToDate - allowanceToDate;
  if (deficit <= 0) return empty;

  return {
    available: true,
    todayKey,
    endDate,
    dailyCap: amount,
    elapsedDays,
    spentToDate,
    allowanceToDate,
    deficit,
    daysLeft: Math.max(0, inclusiveDayCount(todayKey, endDate) - 1),
    minDaysToBreakEven: Math.max(1, Math.ceil(deficit / amount)),
  };
}
