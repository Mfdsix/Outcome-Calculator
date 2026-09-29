import type { BudgetType, BudgetActiveResponse, ExpenseDto, PeriodRange } from "@expense-app/shared";
import {
  addCivilDays,
  getZonedParts,
  parseCivilDate,
  zonedWallTimeToUtc,
} from "@expense-app/shared";

export type BudgetInsightStatus = "UNDER" | "WARNING" | "OVER";

export interface BudgetSnapshot {
  /** Spent within the intersection of the period and the budget range */
  spent: number;
  /** Total budget amount for the intersection (daily: amount × days; full: amount) */
  budget: number;
  /** remaining = max(budget - spent, 0) */
  remaining: number;
  /** overspent = max(spent - budget, 0) */
  overspent: number;
  /** usagePercent = spent / budget * 100, unclamped (e.g. 126.785) */
  usagePercent: number;
  /** UNDER <80%, WARNING 80–100%, OVER >100% */
  status: BudgetInsightStatus;
  /** Calendar days in the period∩budget intersection */
  applicableDays: number;
  /** True when the budget range does not overlap the period at all */
  hasOverlap: boolean;
}

export interface ActiveBudgetLike {
  type: BudgetType;
  amount: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/**
 * Spend calculation seam. TODO(allocation): delegate to allocation engine
 * so WEEKLY/MONTHLY recurring expenses can spread across days.
 *
 * TODAY: raw sum of amounts whose occurredAt falls within [from, to).
 */
function effectiveSpending(expenses: ExpenseDto[], from: Date, to: Date): number {
  let total = 0;
  for (const expense of expenses) {
    const occurredAt = new Date(expense.occurredAt);
    if (occurredAt >= from && occurredAt < to) {
      total += expense.amount;
    }
  }
  return total;
}

/**
 * Count calendar days in the intersection of two half-open ranges [periodFrom, periodTo)
 * and [budgetStart, budgetEnd+1day) in `tz`. Returns 0 when ranges don't overlap.
 */
function overlapDays(
  periodFrom: Date,
  periodTo: Date,
  budgetStart: string,
  budgetEnd: string,
  tz: string,
): number {
  const budgetStartParts = parseCivilDate(budgetStart);
  const budgetEndParts = parseCivilDate(budgetEnd);

  // Budget range: [start 00:00, end+1 00:00) in tz
  const budgetFrom = zonedWallTimeToUtc(tz, budgetStartParts);
  const dayAfterEnd = addCivilDays(budgetEndParts, 1);
  const budgetTo = zonedWallTimeToUtc(tz, dayAfterEnd);

  // No overlap
  if (periodFrom >= budgetTo || periodTo <= budgetFrom) return 0;

  // Count calendar days in the overlap
  const overlapFrom = periodFrom > budgetFrom ? periodFrom : budgetFrom;
  const overlapTo = periodTo < budgetTo ? periodTo : budgetTo;

  const fromParts = getZonedParts(overlapFrom, tz);
  const toParts = getZonedParts(overlapTo, tz);

  // Count civil days from overlapFrom to overlapTo (exclusive)
  let count = 0;
  let cursor = { year: fromParts.year, month: fromParts.month, day: fromParts.day };
  const endKey = `${toParts.year}-${String(toParts.month).padStart(2, "0")}-${String(toParts.day).padStart(2, "0")}`;
  for (let guard = 0; guard < 366; guard++) {
    const key = `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(cursor.day).padStart(2, "0")}`;
    if (key >= endKey) break;
    count++;
    cursor = addCivilDays(cursor, 1);
  }

  return count;
}

/**
 * Build a BudgetSnapshot for the given D/W/M period range against the active budget.
 * Returns { hasOverlap: false } when the budget range does not intersect the period.
 *
 * spent is derived from periodExpenses (already fetched), NOT from the server's
 * budget.active.spent (which covers the whole budget range or today-only).
 */
export function buildBudgetSnapshot(
  active: ActiveBudgetLike,
  periodRange: PeriodRange,
  periodExpenses: ExpenseDto[],
  tz: string,
): BudgetSnapshot | { hasOverlap: false } {
  const periodFrom = periodRange.from;
  const periodTo = periodRange.to;

  // Budget range as UTC instants
  const budgetStartParts = parseCivilDate(active.startDate);
  const budgetEndParts = parseCivilDate(active.endDate);
  const budgetFrom = zonedWallTimeToUtc(tz, budgetStartParts);
  const dayAfterEnd = addCivilDays(budgetEndParts, 1);
  const budgetTo = zonedWallTimeToUtc(tz, dayAfterEnd);

  // No overlap check
  if (periodFrom >= budgetTo || periodTo <= budgetFrom) {
    return { hasOverlap: false };
  }

  // Spending: filter periodExpenses to the budget∩period intersection, then raw sum
  const intersectionFrom = periodFrom > budgetFrom ? periodFrom : budgetFrom;
  const intersectionTo = periodTo < budgetTo ? periodTo : budgetTo;
  const spent = effectiveSpending(periodExpenses, intersectionFrom, intersectionTo);

  const applicableDays = overlapDays(periodFrom, periodTo, active.startDate, active.endDate, tz);

  let budget: number;
  if (active.type === "daily") {
    budget = active.amount * applicableDays;
  } else {
    budget = active.amount; // full: whole pool
  }

  if (budget <= 0) {
    return {
      spent,
      budget,
      remaining: 0,
      overspent: 0,
      usagePercent: 0,
      status: "UNDER",
      applicableDays,
      hasOverlap: true,
    };
  }

  const remaining = Math.max(budget - spent, 0);
  const overspent = Math.max(spent - budget, 0);
  const usagePercent = (spent / budget) * 100;

  let status: BudgetInsightStatus;
  if (usagePercent > 100) {
    status = "OVER";
  } else if (usagePercent >= 80) {
    status = "WARNING";
  } else {
    status = "UNDER";
  }

  return {
    spent,
    budget,
    remaining,
    overspent,
    usagePercent,
    status,
    applicableDays,
    hasOverlap: true,
  };
}
