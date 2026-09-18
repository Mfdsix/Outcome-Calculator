import { dayRange, last30DaysRange, last7DaysRange, toIsoWithOffset } from "@expense-app/shared";
import type { PeriodRange } from "@expense-app/shared";

import type { Period } from "../types/ui";

/** Browser-safe default; aggregation authority remains the server (spec §5). */
export const APP_TIMEZONE = "Asia/Jakarta";

export const PERIOD_LABEL: Record<Period, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/** Half-open [from, to) ISO range for the period containing `now`. */
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
