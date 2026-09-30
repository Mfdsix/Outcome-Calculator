import {
  addCivilDays,
  dayRange,
  getZonedParts,
  last30DaysRange,
  last7DaysRange,
  toIsoWithOffset,
  zonedWallTimeToUtc,
} from "@expense-app/shared";
import type { PeriodRange } from "@expense-app/shared";

import type { Period } from "../types/ui";

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
 * Rolling windows (web spec §5): W = last 7 days, M = last 30 days. All
 * half-open [from, to) in Asia/Jakarta. The server remains the aggregation
 * authority — these mirror its windows client-side.
 */
export function currentPeriodRange(period: Period, now: Date = new Date()): PeriodRange {
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

/**
 * Expanded query for the fair-total fetch: same `to` as periodQuery, but `from`
 * is pushed back 30 civil days so allocated expenses whose allocation window
 * started before `period.from` are included (max allocation window = MONTHLY =
 * 30 days). The fair total itself is still capped at "tomorrow 00:00 Jakarta"
 * by fairPeriodRange/fairTotalForPeriod (spec §Adv-5).
 */
export function expandedFairQuery(period: Period, now: Date = new Date()): {
  from: string;
  to: string;
  fairFrom: string;
  fairTo: string;
} {
  const { from: fairFrom, to: fairTo } = periodQuery(period, now);
  const range = currentPeriodRange(period, now);
  const parts = getZonedParts(range.from, APP_TIMEZONE);
  const expandedStart = addCivilDays(parts, -30);
  const expandedFrom = toIsoWithOffset(
    zonedWallTimeToUtc(APP_TIMEZONE, expandedStart),
    APP_TIMEZONE,
  );
  return { from: expandedFrom, to: fairTo, fairFrom, fairTo: fairTo };
}
