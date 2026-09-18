import { describe, expect, it } from "vitest";

import { dayRange, formatDateShort, formatTimeShort, getZonedParts, last30DaysRange, last7DaysRange, lastNDaysRange, monthRange, toIsoWithOffset, weekRange } from "./periods";

const TZ = "Asia/Jakarta";

describe("periods", () => {
  it("day range is [local midnight, next local midnight) in Asia/Jakarta", () => {
    const anchor = new Date("2026-09-17T12:30:00+07:00");
    const { from, to } = dayRange(anchor, TZ);
    expect(toIsoWithOffset(from, TZ)).toBe("2026-09-17T00:00:00+07:00");
    expect(toIsoWithOffset(to, TZ)).toBe("2026-09-18T00:00:00+07:00");
  });

  it("week starts on Monday and ends the following Monday", () => {
    // 2026-09-17 is a Thursday.
    const anchor = new Date("2026-09-17T12:30:00+07:00");
    const { from, to } = weekRange(anchor, TZ);
    expect(toIsoWithOffset(from, TZ)).toBe("2026-09-14T00:00:00+07:00"); // Monday
    expect(toIsoWithOffset(to, TZ)).toBe("2026-09-21T00:00:00+07:00");
  });

  it("week boundary handles Sunday correctly", () => {
    // 2026-09-20 is a Sunday.
    const anchor = new Date("2026-09-20T23:00:00+07:00");
    const { from, to } = weekRange(anchor, TZ);
    expect(toIsoWithOffset(from, TZ)).toBe("2026-09-14T00:00:00+07:00");
    expect(toIsoWithOffset(to, TZ)).toBe("2026-09-21T00:00:00+07:00");
  });

  it("month range spans the full calendar month", () => {
    const anchor = new Date("2026-09-17T23:59:59+07:00");
    const { from, to } = monthRange(anchor, TZ);
    expect(toIsoWithOffset(from, TZ)).toBe("2026-09-01T00:00:00+07:00");
    expect(toIsoWithOffset(to, TZ)).toBe("2026-10-01T00:00:00+07:00");
  });

  it("aggregates by Jakarta calendar day even when UTC day differs", () => {
    // 2026-09-17 00:30 +07:00 == 2026-09-16 17:30 UTC.
    const lateEvening = new Date("2026-09-17T00:30:00+07:00");
    const { from, to } = dayRange(lateEvening, TZ);
    expect(toIsoWithOffset(from, TZ)).toBe("2026-09-17T00:00:00+07:00");

    // Expense at 23:00 WIB stays inside the same Jakarta day.
    const beforeMidnight = new Date("2026-09-17T23:00:00+07:00");
    expect(beforeMidnight.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(beforeMidnight.getTime()).toBeLessThan(to.getTime());
  });

  it("toIsoWithOffset renders explicit +07:00 offsets", () => {
    const date = new Date("2026-09-17T05:30:00Z");
    expect(toIsoWithOffset(date, TZ)).toBe("2026-09-17T12:30:00+07:00");
  });

  describe("rolling ranges", () => {
    it("last7DaysRange: anchor Wednesday → from 9 days ago 00:00, to next day 00:00", () => {
      // 2026-09-16 is a Wednesday.
      const anchor = new Date("2026-09-16T14:00:00+07:00");
      const { from, to } = last7DaysRange(anchor, TZ);
      // 7 days back from 2026-09-16 → 2026-09-09 (16 - 7 = 9)
      expect(toIsoWithOffset(from, TZ)).toBe("2026-09-09T00:00:00+07:00");
      expect(toIsoWithOffset(to, TZ)).toBe("2026-09-17T00:00:00+07:00");
    });

    it("last30DaysRange: anchor mid-month → 30 day window ending at next midnight", () => {
      const anchor = new Date("2026-09-17T12:30:00+07:00");
      const { from, to } = last30DaysRange(anchor, TZ);
      // 30 days back from 2026-09-17 → 2026-08-18
      expect(toIsoWithOffset(from, TZ)).toBe("2026-08-18T00:00:00+07:00");
      expect(toIsoWithOffset(to, TZ)).toBe("2026-09-18T00:00:00+07:00");
    });

    it("last7DaysRange: crosses month boundary (anchor 2 Jan → from 26 Dec)", () => {
      const anchor = new Date("2026-01-02T12:00:00+07:00");
      const { from, to } = last7DaysRange(anchor, TZ);
      // 7 days back from 2026-01-02 → 2025-12-26
      expect(toIsoWithOffset(from, TZ)).toBe("2025-12-26T00:00:00+07:00");
      expect(toIsoWithOffset(to, TZ)).toBe("2026-01-03T00:00:00+07:00");
    });

    it("lastNDaysRange throws for non-positive n", () => {
      const anchor = new Date("2026-09-17T12:00:00+07:00");
      expect(() => lastNDaysRange(0, anchor, TZ)).toThrow(RangeError);
      expect(() => lastNDaysRange(-1, anchor, TZ)).toThrow(RangeError);
      expect(() => lastNDaysRange(0.5, anchor, TZ)).toThrow(RangeError);
    });

    it("ranges from < to and align to local midnight", () => {
      const anchor = new Date("2026-09-17T12:30:00+07:00");
      const { from, to } = last7DaysRange(anchor, TZ);
      expect(from.getTime()).toBeLessThan(to.getTime());
      expect(getZonedParts(from, TZ).hour).toBe(0);
      expect(getZonedParts(from, TZ).minute).toBe(0);
      expect(getZonedParts(to, TZ).hour).toBe(0);
      expect(getZonedParts(to, TZ).minute).toBe(0);
    });
  });

  it("formatTimeShort renders HH:MM in Jakarta timezone", () => {
    // 2026-09-17T06:45:00Z = 13:45 WIB
    const date = new Date("2026-09-17T06:45:00Z");
    expect(formatTimeShort(date, TZ)).toBe("13:45");
    // 2026-09-17T00:00:00Z = 07:00 WIB
    const midnightUtc = new Date("2026-09-17T00:00:00Z");
    expect(formatTimeShort(midnightUtc, TZ)).toBe("07:00");
  });

  it("formatDateShort renders short date in id-ID", () => {
    const date = new Date("2026-09-17T12:30:00+07:00");
    expect(formatDateShort(date, TZ)).toBe("17 Sep");
  });
});
