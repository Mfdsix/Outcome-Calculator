import { addCivilDays, getZonedParts } from "@expense-app/shared";
import type { ExpenseDto, PeriodRange } from "@expense-app/shared";

import { APP_TIMEZONE } from "./periods";
import type { Period } from "../types/ui";

export interface ChartBucket {
  /** Civil key: YYYY-MM-DD for day buckets, "YYYY-MM-DDTHH" for hour buckets. */
  key: string;
  /** Short axis label (day of month or 2-digit hour). */
  label: string;
  total: number;
  /** True for the current calendar day/hour (highlighted bar). */
  isCurrent: boolean;
  /** Granularity: "hour" for day view, "day" for week/month. */
  kind: "hour" | "day";
  /**
   * Month-pair second day ("YYYY-MM-DD"). Set only on 2-day pair buckets;
   * drill-down covers [key, endKey]. Absent on orphan singles so a drill
   * never leaks into the neighboring pair.
   */
  endKey?: string;
}

function civilKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Aggregate expenses into per-calendar-day totals (in APP_TIMEZONE) across
 * the given period range. Totals are raw sums as-is: each expense counts
 * once, in full, on its occurredAt day. Allocation type/distribution never
 * affects D/W/M totals. The authoritative period total still comes from
 * the server; these buckets only drive the chart.
 */
export function dailyBuckets(
  period: Period,
  range: PeriodRange,
  expenses: ExpenseDto[],
  now: Date,
): ChartBucket[] {
  const start = getZonedParts(range.from, APP_TIMEZONE);
  const end = getZonedParts(range.to, APP_TIMEZONE);
  const today = getZonedParts(now, APP_TIMEZONE);
  const todayKey = civilKey(today.year, today.month, today.day);

  // Collect civil dates from range start to range end (exclusive).
  const dates: Array<{ year: number; month: number; day: number }> = [];
  let cursor = { year: start.year, month: start.month, day: start.day };
  const endKey = civilKey(end.year, end.month, end.day);
  for (let guard = 0; guard < 62; guard += 1) {
    const key = civilKey(cursor.year, cursor.month, cursor.day);
    if (key >= endKey || (period === "day" && dates.length === 1)) break;
    dates.push(cursor);
    cursor = addCivilDays(cursor, 1);
  }

  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const parts = getZonedParts(new Date(expense.occurredAt), APP_TIMEZONE);
    const key = civilKey(parts.year, parts.month, parts.day);
    totals.set(key, (totals.get(key) ?? 0) + expense.amount);
  }

  return dates.map(({ year, month, day }) => {
    const key = civilKey(year, month, day);
    return {
      key,
      label: String(day),
      total: totals.get(key) ?? 0,
      isCurrent: key === todayKey,
      kind: "day" as const,
    };
  });
}

/**
 * Aggregate expenses into 24 hourly buckets for today (in APP_TIMEZONE).
 * Every expense counts once, in full, at its actual occurrence hour.
 * Labels only render on hours divisible by 3 (00 03 06 09 12 15 18 21).
 */
export function hourlyBuckets(
  expenses: ExpenseDto[],
  now: Date,
): ChartBucket[] {
  const today = getZonedParts(now, APP_TIMEZONE);
  const todayKey = civilKey(today.year, today.month, today.day);
  const currentHour = today.hour;

  const totals = new Array(24).fill(0);
  for (const expense of expenses) {
    const parts = getZonedParts(new Date(expense.occurredAt), APP_TIMEZONE);
    const key = civilKey(parts.year, parts.month, parts.day);
    if (key === todayKey && parts.hour >= 0 && parts.hour < 24) {
      totals[parts.hour] += expense.amount;
    }
  }

  return totals.map((total, hour) => ({
    key: `${todayKey}T${String(hour).padStart(2, "0")}`,
    label: hour % 3 === 0 ? String(hour).padStart(2, "0") : "",
    total,
    isCurrent: hour === currentHour,
    kind: "hour" as const,
  }));
}

/**
 * Sparse per-day aggregation for the W/M summary list — only days that
 * actually have expenses appear (no zero rows). Raw sums as-is per occurredAt
 * day; allocation never affects D/W/M totals.
 * In APP_TIMEZONE; newest-first to match day-summary & drill ordering.
 * Pure; safe to unit-test.
 *
 * When `range` is given, only days inside the half-open [from, to) window
 * are returned, so browse selection + Enter-drill keys stay within the
 * rendered chart buckets.
 */
export function groupExpensesByDay(
  expenses: ExpenseDto[],
  range?: PeriodRange,
): Array<{ key: string; total: number }> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const parts = getZonedParts(new Date(expense.occurredAt), APP_TIMEZONE);
    const key = civilKey(parts.year, parts.month, parts.day);
    totals.set(key, (totals.get(key) ?? 0) + expense.amount);
  }
  const rows = Array.from(totals.entries())
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.key.localeCompare(a.key));
  if (!range) return rows;
  const fromParts = getZonedParts(range.from, APP_TIMEZONE);
  const toParts = getZonedParts(range.to, APP_TIMEZONE);
  const fromKey = civilKey(fromParts.year, fromParts.month, fromParts.day);
  const toKey = civilKey(toParts.year, toParts.month, toParts.day);
  return rows.filter((row) => row.key >= fromKey && row.key < toKey);
}

/**
 * Aggregate expenses into 2-day buckets for the month view
 * (in APP_TIMEZONE). Pairs are anchored at the range END — […, d3+d4, d1+d2,
 * today+yesterday] — so today is always paired and any orphan single (odd
 * window length, e.g. the 31-day last-30 window) lands on the oldest,
 * least-visible day. A 30-day window renders ~15 candles instead of 30
 * slivers. Raw sums as-is per pair; allocation never affects D/W/M totals.
 *
 * Key = first day civil key ("YYYY-MM-DD"), label = first day number,
 * isCurrent = today falls inside the pair. Pure; safe to unit-test.
 */
export function twoDayBuckets(
  range: PeriodRange,
  expenses: ExpenseDto[],
  now: Date,
): ChartBucket[] {
  const start = getZonedParts(range.from, APP_TIMEZONE);
  const end = getZonedParts(range.to, APP_TIMEZONE);
  const today = getZonedParts(now, APP_TIMEZONE);
  const todayKey = civilKey(today.year, today.month, today.day);

  // Collect civil dates from range start to range end (exclusive).
  const dates: Array<{ year: number; month: number; day: number }> = [];
  let cursor = { year: start.year, month: start.month, day: start.day };
  const endKey = civilKey(end.year, end.month, end.day);
  for (let guard = 0; guard < 62; guard += 1) {
    const key = civilKey(cursor.year, cursor.month, cursor.day);
    if (key >= endKey) break;
    dates.push(cursor);
    cursor = addCivilDays(cursor, 1);
  }

  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const parts = getZonedParts(new Date(expense.occurredAt), APP_TIMEZONE);
    const key = civilKey(parts.year, parts.month, parts.day);
    totals.set(key, (totals.get(key) ?? 0) + expense.amount);
  }

  const toKey = (d: { year: number; month: number; day: number }): string =>
    civilKey(d.year, d.month, d.day);

  // Chunk from the end (newest first), then restore ascending order.
  const pairs: ChartBucket[] = [];
  let index = dates.length;
  while (index > 0) {
    if (index >= 2) {
      const first = dates[index - 2]!;
      const second = dates[index - 1]!;
      const firstKey = toKey(first);
      const secondKey = toKey(second);
      pairs.unshift({
        key: firstKey,
        label: String(first.day),
        total: (totals.get(firstKey) ?? 0) + (totals.get(secondKey) ?? 0),
        isCurrent: firstKey === todayKey || secondKey === todayKey,
        kind: "day" as const,
        endKey: secondKey,
      });
      index -= 2;
    } else {
      const only = dates[0]!;
      const onlyKey = toKey(only);
      pairs.unshift({
        key: onlyKey,
        label: String(only.day),
        total: totals.get(onlyKey) ?? 0,
        isCurrent: onlyKey === todayKey,
        kind: "day" as const,
      });
      index -= 1;
    }
  }
  return pairs;
}
