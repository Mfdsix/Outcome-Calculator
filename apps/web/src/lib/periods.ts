import {
  dayRange,
  last30DaysRange,
  last7DaysRange,
  monthRange,
  toIsoWithOffset,
  weekRange,
} from "@expense-app/shared";
import type { PeriodRange } from "@expense-app/shared";

import type { Period } from "../types/ui";
import { IS_TAURI } from "./tauri";

/** Browser-safe default; aggregation authority remains the server (spec §5). */
export const APP_TIMEZONE = "Asia/Jakarta";

export const PERIOD_LABEL: Record<Period, string> = {
  day: "Today",
  week: "This Week",
  month: "This Month",
};

/** Civil YYYY-MM-DD string from `now` in `tz` (en-CA numeric format). */
export function toIsoDateOnly(now: Date = new Date(), tz = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(now);
}

/**
 * Calendar periods (Tauri migration plan §9): W = Monday→next Monday,
 * M = first day of the month → first day of the next month. All half-open
 * [from, to) in Asia/Jakarta. Exported for tests.
 */
export function calendarPeriodRange(period: Period, now: Date = new Date()): PeriodRange {
  switch (period) {
    case "day":
      return dayRange(now, APP_TIMEZONE);
    case "week":
      return weekRange(now, APP_TIMEZONE);
    case "month":
      return monthRange(now, APP_TIMEZONE);
  }
}

/** Half-open [from, to) ISO range for the period containing `now`. */
export function currentPeriodRange(period: Period, now: Date = new Date()): PeriodRange {
  // Web spec §5 uses rolling windows for W/M; the native app follows the
  // Tauri plan §9 calendar semantics. Day is the calendar day in both.
  if (IS_TAURI) return calendarPeriodRange(period, now);
  switch (period) {
    case "day":
      return dayRange(now, APP_TIMEZONE);
    case "week":
      return last7DaysRange(now, APP_TIMEZONE);
    case "month":
      return last30DaysRange(now, APP_TIMEZONE);
  }
}

/** Query-string pair for the API: from/to with explicit +07:00 offsets. */
export function periodQuery(period: Period, now: Date = new Date()): { from: string; to: string } {
  const { from, to } = currentPeriodRange(period, now);
  return {
    from: toIsoWithOffset(from, APP_TIMEZONE),
    to: toIsoWithOffset(to, APP_TIMEZONE),
  };
}
