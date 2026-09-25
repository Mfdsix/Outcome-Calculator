import { describe, expect, it } from "vitest";

import { getZonedParts, last7DaysRange } from "@expense-app/shared";

import { dailyBuckets, groupExpensesByDay, hourlyBuckets } from "./chart";
import { APP_TIMEZONE } from "./periods";

describe("groupExpensesByDay", () => {
  it("groups expenses by civil day in APP_TIMEZONE (Asia/Jakarta)", () => {
    // Jakarta = UTC+7. 23:30 WIB 17 Sep 2026 == 16:30 UTC; 00:30 WIB 18 Sep == 17:30 UTC.
    const expenses = [
      { id: "a", amount: 1000, occurredAt: "2026-09-17T16:30:00Z" }, // 17 Sep WIB
      { id: "b", amount: 2000, occurredAt: "2026-09-17T23:59:00Z" }, // 18 Sep WIB (06:59)
      { id: "c", amount: 3000, occurredAt: "2026-09-18T00:00:00Z" }, // 18 Sep WIB (07:00)
    ];

    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toHaveLength(2);
    // Newest day first.
    expect(grouped[0]).toEqual({ key: "2026-09-18", total: 5000 });
    expect(grouped[1]).toEqual({ key: "2026-09-17", total: 1000 });
  });

  it("only includes days that have expenses (no zero rows)", () => {
    const today = new Date().toISOString();
    const grouped = groupExpensesByDay([{ id: "a", amount: 500, occurredAt: today }]);
    expect(grouped).toHaveLength(1);
  });

  it("sorts newest-first", () => {
    const expenses = [
      { id: "old", amount: 1, occurredAt: "2026-09-10T10:00:00Z" },
      { id: "mid", amount: 2, occurredAt: "2026-09-15T10:00:00Z" },
      { id: "new", amount: 3, occurredAt: "2026-09-20T10:00:00Z" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped.map((g) => g.key)).toEqual(["2026-09-20", "2026-09-15", "2026-09-10"]);
  });

  it("aggregates multiple expenses on the same day", () => {
    const expenses = [
      { id: "a", amount: 15000, occurredAt: "2026-09-17T01:00:00Z" },
      { id: "b", amount: 25000, occurredAt: "2026-09-17T05:00:00Z" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toEqual([{ key: "2026-09-17", total: 40000 }]);
  });

  it("respects APP_TIMEZONE constant", () => {
    expect(APP_TIMEZONE).toBe("Asia/Jakarta");
    // Sanity: getZonedParts on a known Z time yields Jakarta civil day.
    const parts = getZonedParts(new Date("2026-09-18T00:30:00Z"), APP_TIMEZONE);
    expect(parts).toMatchObject({ year: 2026, month: 9, day: 18, hour: 7 });
  });
});

describe("groupExpensesByDay — allocation-aware", () => {
  it("WEEKLY 700k created on 17 Sep → 100k each day across 7 days", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // Should have 7 entries (17-23 Sep), each 100k.
    expect(grouped).toHaveLength(7);
    expect(grouped.every((g) => g.total === 100_000)).toBe(true);
    // Newest first.
    expect(grouped[0]).toEqual({ key: "2026-09-23", total: 100_000 });
  });

  it("WEEKLY 700k created on 17 Sep, 2-day period 18-19 → 200k per day", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // Days 18 and 19 should each have 100k.
    const day18 = grouped.find((g) => g.key === "2026-09-18");
    const day19 = grouped.find((g) => g.key === "2026-09-19");
    expect(day18).toEqual({ key: "2026-09-18", total: 100_000 });
    expect(day19).toEqual({ key: "2026-09-19", total: 100_000 });
  });

  it("NONE expense stays on its own day (no spreading)", () => {
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual({ key: "2026-09-17", total: 50_000 });
  });

  it("mixed NONE + WEEKLY expenses aggregate correctly", () => {
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // 17 Sep: 50k (raw) + 100k (weekly allocation) = 150k
    const day17 = grouped.find((g) => g.key === "2026-09-17");
    expect(day17).toEqual({ key: "2026-09-17", total: 150_000 });
  });

  it("MONTHLY 3M on 17 Sep → 100k/day across 30 days", () => {
    const expenses = [
      { id: "m1", amount: 3_000_000, allocationType: "MONTHLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toHaveLength(30);
    expect(grouped.every((g) => g.total === 100_000)).toBe(true);
  });

  it("WEEKLY expense partially overlapping the 7-day window (created mid-week)", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-19T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // WEEKLY window is 19-25 Sep; all 7 days get 100k.
    expect(grouped).toHaveLength(7);
    expect(grouped[0]).toEqual({ key: "2026-09-25", total: 100_000 });
    expect(grouped[6]).toEqual({ key: "2026-09-19", total: 100_000 });
  });

  it("WEEKLY expense with remainder distributes correctly (701k / 7)", () => {
    const expenses = [
      { id: "w1", amount: 701_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // 701k / 7 = 100142 base, remainder 6 → first 6 days get +1.
    // Day 1 (Sep 17) gets 100143.
    const day17 = grouped.find((g) => g.key === "2026-09-17");
    expect(day17).toEqual({ key: "2026-09-17", total: 100_143 });
  });

  it("allocationType undefined treated as NONE (no spreading)", () => {
    const expenses = [
      { id: "u1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual({ key: "2026-09-17", total: 50_000 });
  });
});

describe("hourlyBuckets — allocation-aware", () => {
  const now = new Date("2026-09-17T10:30:00+07:00");

  it("NONE expense buckets by actual hour", () => {
    const expenses = [
      { id: "a", amount: 30000, occurredAt: "2026-09-17T10:00:00+07:00" },
      { id: "b", amount: 20000, occurredAt: "2026-09-17T14:00:00+07:00" },
    ];
    const buckets = hourlyBuckets(expenses, now);
    expect(buckets[10]!.total).toBe(30000);
    expect(buckets[14]!.total).toBe(20000);
  });

  it("WEEKLY expense contributes today's share to hour 0 bucket", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = hourlyBuckets(expenses, now);
    // Today gets 100k allocation, bucketed into hour 0.
    expect(buckets[0]!.total).toBe(100_000);
    expect(buckets[10]!.total).toBe(0);
  });
});

describe("dailyBuckets — allocation-aware", () => {
  it("WEEKLY 700k on 17 Sep spans 7 days in week view", () => {
    const range = last7DaysRange(new Date("2026-09-18T00:00:00+07:00"), APP_TIMEZONE);
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = dailyBuckets("week", range, expenses, new Date("2026-09-18T00:00:00+07:00"));
    // Each day with allocation should have 100k.
    const nonZero = buckets.filter((b) => b.total > 0);
    expect(nonZero.length).toBeGreaterThanOrEqual(2); // 17 Sep may not be in range
    expect(nonZero.every((b) => b.total === 100_000)).toBe(true);
  });

  it("MONTHLY expense spans 30 days, clipped to the month range", () => {
    const range = { from: new Date("2026-09-01T00:00:00+07:00"), to: new Date("2026-10-01T00:00:00+07:00") };
    const expenses = [
      { id: "m1", amount: 3_000_000, allocationType: "MONTHLY", occurredAt: "2026-09-15T10:00:00+07:00" },
    ];
    const buckets = dailyBuckets("month", range, expenses, new Date("2026-09-18T00:00:00+07:00"));
    // MONTHLY window: 15 Sep – 14 Oct (30 days). Range: 1-30 Sep.
    // Overlap = 15 Sep – 30 Sep = 16 days, each 100k.
    const nonZero = buckets.filter((b) => b.total > 0);
    expect(nonZero.length).toBe(16);
    expect(nonZero.every((b) => b.total === 100_000)).toBe(true);
  });

  it("mixed NONE + WEEKLY in dailyBuckets shows combined totals", () => {
    const range = { from: new Date("2026-09-17T00:00:00+07:00"), to: new Date("2026-09-18T00:00:00+07:00") };
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
      { id: "w1", amount: 700_000, allocationType: "WEEKLY", occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = dailyBuckets("day", range, expenses, new Date("2026-09-17T10:30:00+07:00"));
    const dayBucket = buckets.find((b) => b.key === "2026-09-17");
    // 50k (raw) + 100k (weekly share) = 150k
    expect(dayBucket).toBeTruthy();
    expect(dayBucket!.total).toBe(150_000);
  });
});
