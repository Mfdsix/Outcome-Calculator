import { describe, expect, it } from "vitest";

import { APP_TIMEZONE, expandedFairQuery, periodQuery } from "./periods";
import { getZonedParts, zonedWallTimeToUtc } from "@expense-app/shared";

describe("expandedFairQuery", () => {
  it("returns fairFrom/to identical to periodQuery", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const pq = periodQuery("day", now);
    const eq = expandedFairQuery("day", now);
    expect(eq.fairFrom).toBe(pq.from);
    expect(eq.fairTo).toBe(pq.to);
    expect(eq.to).toBe(pq.to);
  });

  it("expands from by 30 civil days for 'day' period", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const eq = expandedFairQuery("day", now);
    const fromParts = getZonedParts(new Date(eq.from), APP_TIMEZONE);
    // today is Sep 17 → expanded from = Sep 17 - 30 = Aug 18
    expect(fromParts.year).toBe(2026);
    expect(fromParts.month).toBe(8);
    expect(fromParts.day).toBe(18);
  });

  it("to matches periodQuery to (consistency with main fetch)", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const eq = expandedFairQuery("week", now);
    const pq = periodQuery("week", now);
    expect(eq.to).toBe(pq.to);
  });

  it("expands from by 30 civil days for 'week' period", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const eq = expandedFairQuery("week", now);
    const fromParts = getZonedParts(new Date(eq.from), APP_TIMEZONE);
    // week uses rolling last7DaysRange: Sep 10 → expanded from = Aug 11
    expect(fromParts.year).toBe(2026);
    expect(fromParts.month).toBe(8);
    expect(fromParts.day).toBe(11);
  });

  it("expands from by 30 days for 'month' period", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const eq = expandedFairQuery("month", now);
    const fromParts = getZonedParts(new Date(eq.from), APP_TIMEZONE);
    // last30DaysRange from = Aug 18 → expanded = Jul 19
    expect(fromParts.year).toBe(2026);
    expect(fromParts.month).toBe(7);
    expect(fromParts.day).toBe(19);
  });

  it("expandedFrom is 30 civil days before currentPeriodRange.from", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const eq = expandedFairQuery("month", now);
    // currentPeriodRange from for month = last30DaysRange → Aug 18
    const expectedFrom = zonedWallTimeToUtc(APP_TIMEZONE, {
      year: 2026,
      month: 7,
      day: 19,
    });
    expect(new Date(eq.from).getTime()).toBe(expectedFrom.getTime());
  });
});
