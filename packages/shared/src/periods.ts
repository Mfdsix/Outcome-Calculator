/**
 * Timezone-aware period math for Day / Week / Month ranges.
 *
 * Implemented with the standard library only (no date-fns-tz / luxon) so the
 * same code runs in Node and the browser. All ranges are half-open [from, to)
 * to avoid end-of-day boundary bugs (spec §5, §15).
 */

export type Period = "day" | "week" | "month";

export interface PeriodRange {
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

export interface ZonedParts extends Required<WallTime> {
  /** 0 = Sunday … 6 = Saturday (matches `Date#getDay`). */
  weekday: number;
}

const WEEKDAY_BY_SHORT_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Calendar components of an instant as seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_BY_SHORT_NAME[get("weekday")] ?? 0,
  };
}

/** Offset of `timeZone` from UTC, in minutes (e.g. Asia/Jakarta → 420). */
export function getTimeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * Convert wall-clock time in `timeZone` to a UTC instant.
 * Handles DST by refining the offset guess once.
 */
export function zonedWallTimeToUtc(timeZone: string, wall: WallTime): Date {
  const hour = wall.hour ?? 0;
  const minute = wall.minute ?? 0;
  const second = wall.second ?? 0;
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, hour, minute, second);
  const offset1 = getTimeZoneOffsetMinutes(timeZone, new Date(guess));
  let result = guess - offset1 * 60_000;
  const offset2 = getTimeZoneOffsetMinutes(timeZone, new Date(result));
  if (offset2 !== offset1) {
    result = guess - offset2 * 60_000;
  }
  return new Date(result);
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** Add days to a civil (calendar) date, normalizing month/year rollover. */
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Add months to a civil date, clamping to day 1. */
export function addCivilMonths(date: CivilDate, months: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: 1,
  };
}

/** Current calendar day in `timeZone`: 00:00:00 → next day 00:00:00. */
export function dayRange(anchor: Date, timeZone: string): PeriodRange {
  const parts = getZonedParts(anchor, timeZone);
  const from = zonedWallTimeToUtc(timeZone, {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  });
  const next = addCivilDays(parts, 1);
  const to = zonedWallTimeToUtc(timeZone, next);
  return { from, to };
}

/** Monday 00:00 → following Monday 00:00, in `timeZone`. */
export function weekRange(anchor: Date, timeZone: string): PeriodRange {
  const parts = getZonedParts(anchor, timeZone);
  const isoWeekday = parts.weekday === 0 ? 7 : parts.weekday; // Monday = 1 … Sunday = 7
  const monday = addCivilDays(parts, 1 - isoWeekday);
  const from = zonedWallTimeToUtc(timeZone, monday);
  const nextMonday = addCivilDays(monday, 7);
  const to = zonedWallTimeToUtc(timeZone, nextMonday);
  return { from, to };
}

/** First day 00:00 → first day of the following month 00:00, in `timeZone`. */
export function monthRange(anchor: Date, timeZone: string): PeriodRange {
  const parts = getZonedParts(anchor, timeZone);
  const from = zonedWallTimeToUtc(timeZone, {
    year: parts.year,
    month: parts.month,
    day: 1,
  });
  const nextMonth = addCivilMonths(parts, 1);
  const to = zonedWallTimeToUtc(timeZone, nextMonth);
  return { from, to };
}

export function periodRange(period: Period, anchor: Date, timeZone: string): PeriodRange {
  switch (period) {
    case "day":
           return dayRange(anchor, timeZone);
    case "week":
      return weekRange(anchor, timeZone);
    case "month":
      return monthRange(anchor, timeZone);
  }
}

/**
 * Rolling N-day window ending at the next local midnight after `anchor`.
 * For N=7 (week) or N=30 (month) this produces a half-open [from, to)
 * range covering exactly N calendar days in `timeZone`, regardless of
 * calendar week/month boundaries. (spec §5 rolling variant)
 */
export function lastNDaysRange(n: number, anchor: Date, timeZone: string): PeriodRange {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`lastNDaysRange: n must be a positive integer, got ${n}`);
  }
  const parts = getZonedParts(anchor, timeZone);
  const tomorrow = addCivilDays(parts, 1);
  const to = zonedWallTimeToUtc(timeZone, tomorrow);
  const start = addCivilDays(parts, 0 - n);
  const from = zonedWallTimeToUtc(timeZone, start);
  return { from, to };
}

export function last7DaysRange(anchor: Date, timeZone: string): PeriodRange {
  return lastNDaysRange(7, anchor, timeZone);
}

export function last30DaysRange(anchor: Date, timeZone: string): PeriodRange {
  return lastNDaysRange(30, anchor, timeZone);
}

/**
 * ISO 8601 string with an explicit UTC offset, formatted in `timeZone`.
 * Example: 2026-09-17T12:30:00+07:00
 */
export function toIsoWithOffset(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, date);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absolute / 60));
  const offsetMins = pad2(absolute % 60);
  return (
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` +
    `T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}` +
    `${sign}${offsetHours}:${offsetMins}`
  );
}

/** Short date label such as "17 Sep", rendered in `timeZone`. */
export function formatDateShort(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    day: "2-digit",
    month: "short",
  });
  return formatter.format(date);
}

/** Short time label such as "08:15", rendered in `timeZone`. */
export function formatTimeShort(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}
