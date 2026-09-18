import { z } from "zod";

import { amountSchema } from "./validation";
import { addCivilDays, getZonedParts, zonedWallTimeToUtc } from "./periods";

/**
 * Budget (feature plan §1–§2): exactly ONE active budget per user, flat daily
 * without rollover, soft warnings. History = past budgets (isActive=false),
 * never deleted — "Pakai lagi" copies type+amount and smart-shifts the dates.
 */

export type BudgetType = "full" | "daily";

export const budgetTypeSchema = z.enum(["full", "daily"]);

/** Soft-warning threshold (plan §2): spent ≥ 80% of cap → "warning". */
export const BUDGET_WARN_PCT = 80;

/** Status ladder for the active budget card (plan §2). */
export type BudgetStatus = "ok" | "warning" | "over";

/**
 * Hard cap on budget length (plan §2): one year of days, inclusive.
 * 366 days = 367 distinct dates from start.
 */
export const BUDGET_MAX_DAYS = 366;

/** Civil date string YYYY-MM-DD that is a REAL calendar date (no 2026-02-30). */
export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    const utc = new Date(Date.UTC(year, month - 1, day));
    return (
      utc.getUTCFullYear() === year &&
      utc.getUTCMonth() === month - 1 &&
      utc.getUTCDate() === day
    );
  }, "Invalid date.");

export const createBudgetSchema = z
  .object({
    type: budgetTypeSchema,
    amount: amountSchema,
    startDate: civilDateSchema,
    endDate: civilDateSchema,
  })
  .refine(
    (data) => data.startDate <= data.endDate,
    "startDate must be on or before endDate.",
  )
  .refine(
    (data) => {
      // Inclusive length in days: diff of civil dates + 1 (UTC-safe: pure
      // calendar math, no timezone involved).
      const [y1, m1, d1] = data.startDate.split("-").map(Number) as [number, number, number];
      const [y2, m2, d2] = data.endDate.split("-").map(Number) as [number, number, number];
      const startMs = Date.UTC(y1, m1 - 1, d1);
      const endMs = Date.UTC(y2, m2 - 1, d2);
      return (endMs - startMs) / 86_400_000 + 1 <= BUDGET_MAX_DAYS;
    },
    `Budget range must not exceed ${BUDGET_MAX_DAYS} days.`,
  );

export interface CreateBudgetPayload {
  type: BudgetType;
  amount: number;
  /** Inclusive, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive, YYYY-MM-DD. */
  endDate: string;
}

/** One row of the history list (spent computed live over its own range). */
export interface BudgetHistoryItem {
  id: string;
  type: BudgetType;
  amount: number;
  startDate: string;
  endDate: string;
  spent: number;
  status: BudgetStatus;
  /** Epoch ms of creation — the history list is sorted desc by this. */
  createdAt: string;
}

/** GET /api/budgets/active response — null when no budget is active. */
export interface BudgetActiveResponse {
  budget: {
    id: string;
    type: BudgetType;
    amount: number;
    startDate: string;
    endDate: string;
    /** Spent inside the budget range (live from expenses). */
    spent: number;
    /** Spent on TODAY (Jakarta) only — the daily-type headline. */
    todaySpent: number;
    remaining: number;
    status: BudgetStatus;
    /** 0–100 (integer), can exceed 100 when over. */
    progressPct: number;
  } | null;
}

/** Cap semantics: full = for the whole range; daily = per day. */
export function budgetCapForToday(budget: {
  type: BudgetType;
  amount: number;
}): number {
  return budget.amount; // full: whole cap; daily: today's cap (same number)
}

/** Status ladder: over → warning (≥80%) → ok. */
export function budgetStatus(spent: number, cap: number): BudgetStatus {
  if (cap <= 0) return "ok";
  if (spent > cap) return "over";
  if (spent * 100 >= cap * BUDGET_WARN_PCT) return "warning";
  return "ok";
}

/** Integer progress percent, clamped to ≥0; over-budget may exceed 100. */
export function budgetProgressPct(spent: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.max(0, Math.round((spent / cap) * 100));
}

// ---------------------------------------------------------------------------
// Civil-date helpers (pure, Asia/Jakarta semantics, unit-testable — plan §4)
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" → { year, month, day }. Caller has validated format. */
export function parseCivilDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

/** Format civil parts → "YYYY-MM-DD". */
export function formatCivilDate(parts: { year: number; month: number; day: number }): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Today's civil date in `timeZone` (plan: Asia/Jakarta semantics everywhere). */
export function civilToday(timeZone: string, now: Date = new Date()): { year: number; month: number; day: number } {
  return getZonedParts(now, timeZone);
}

/** Inclusive day count between two civil dates (same format YYYY-MM-DD). */
export function inclusiveDayCount(startDate: string, endDate: string): number {
  const a = parseCivilDate(startDate);
  const b = parseCivilDate(endDate);
  const startMs = Date.UTC(a.year, a.month - 1, a.day);
  const endMs = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

/**
 * Add months to a civil date, CLAMPING the day (29 Feb → 28 Feb in a
 * non-leap year; 31 Jan → 28/30 Feb). Returns a new civil date.
 */
export function addCivilMonthsClamped(
  parts: { year: number; month: number; day: number },
  months: number,
): { year: number; month: number; day: number } {
  const targetYear = parts.year + Math.floor((parts.month - 1 + months) / 12);
  const targetMonth = (((parts.month - 1 + months) % 12) + 12) % 12 + 1;
  // Day 0 of the next month = last day of the target month.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return { year: targetYear, month: targetMonth, day: Math.min(parts.day, lastDay) };
}

/**
 * "Full month" detection (plan §3): starts on day 1 AND ends on the last
 * day of the same calendar month.
 */
export function isFullMonthRange(startDate: string, endDate: string): boolean {
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);
  if (start.day !== 1) return false;
  const lastDay = new Date(Date.UTC(end.year, end.month, 0)).getUTCDate();
  return start.month === end.month && start.year === end.year && end.day === lastDay;
}

export interface SuggestedCopyDates {
  startDate: string;
  endDate: string;
}

/**
 * Smart-shift dates for "Pakai lagi" (plan §3, locked revision):
 * - Full-month budget (1st → last day of month M) → the CURRENT month
 *   (1st → last day of this month), regardless of how far into the month
 *   we already are (user can still edit the dates in the form).
 * - Otherwise → keep the inclusive length N and shift so it starts today:
 *   today → today + N - 1.
 *
 * Pure except for `now`; pass a fixed `now` in tests.
 */
export function suggestCopyDates(
  budget: { startDate: string; endDate: string },
  timeZone: string,
  now: Date = new Date(),
): SuggestedCopyDates {
  if (isFullMonthRange(budget.startDate, budget.endDate)) {
    const today = civilToday(timeZone, now);
    const monthStart = { year: today.year, month: today.month, day: 1 };
    const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
    return {
      startDate: formatCivilDate(monthStart),
      endDate: formatCivilDate({ year: today.year, month: today.month, day: lastDay }),
    };
  }

  const days = inclusiveDayCount(budget.startDate, budget.endDate);
  const today = civilToday(timeZone, now);
  const end = addCivilDays(today, Math.max(0, days - 1));
  return {
    startDate: formatCivilDate(today),
    endDate: formatCivilDate(end),
  };
}

/**
 * UTC instants for a half-open expense filter [start 00:00, end+1 00:00) in
 * `timeZone`. Used by the API to aggregate "spent" for a budget range.
 */
export function budgetRangeToUtc(
  startDate: string,
  endDate: string,
  timeZone: string,
): { from: Date; to: Date } {
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);
  const dayAfter = addCivilDays(end, 1);
  return {
    from: zonedWallTimeToUtc(timeZone, start),
    to: zonedWallTimeToUtc(timeZone, dayAfter),
  };
}
