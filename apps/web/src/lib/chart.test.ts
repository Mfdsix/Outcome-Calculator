import { describe, expect, it } from "vitest";

import { getZonedParts, last30DaysRange, last7DaysRange } from "@expense-app/shared";

import { dailyBuckets, groupExpensesByDay, hourlyBuckets, twoDayBuckets } from "./chart";
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

describe("groupExpensesByDay — range filter", () => {
  // Fixed clock: last-7 window = Sep 19 00:00 → Sep 26 00:00 (exclusive).
  const NOW = new Date("2026-09-25T12:00:00+07:00");

  it("without range returns every occurredAt day", () => {
    const expenses = [
      {
        id: "w1",
        amount: 70_000,
        allocationType: "WEEKLY" as const,
        occurredAt: "2026-09-20T10:00:00+07:00",
      },
      { id: "n1", amount: 5_000, occurredAt: "2026-09-10T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // Raw sums as-is: each expense once, in full, on its own day.
    expect(grouped).toEqual([
      { key: "2026-09-20", total: 70_000 },
      { key: "2026-09-10", total: 5_000 },
    ]);
  });

  it("with range keeps only days inside the half-open window", () => {
    const expenses = [
      {
        id: "w1",
        amount: 70_000,
        allocationType: "WEEKLY" as const,
        occurredAt: "2026-09-20T10:00:00+07:00",
      },
      { id: "n1", amount: 5_000, occurredAt: "2026-09-10T10:00:00+07:00" },
    ];
    const range = last7DaysRange(NOW, APP_TIMEZONE);
    const grouped = groupExpensesByDay(expenses, range);
    // Sep 10 is outside Sep 19–26 → only Sep 20 remains.
    expect(grouped).toEqual([{ key: "2026-09-20", total: 70_000 }]);
  });

  it("returns [] when no spread day overlaps the window", () => {
    const expenses = [
      {
        id: "w1",
        amount: 70_000,
        allocationType: "WEEKLY" as const,
        occurredAt: "2026-09-01T10:00:00+07:00",
      },
    ];
    const range = last7DaysRange(NOW, APP_TIMEZONE);
    expect(groupExpensesByDay(expenses, range)).toEqual([]);
  });
});

describe("groupExpensesByDay — ignores allocation type (raw sums as-is)", () => {
  it("WEEKLY 700k created on 17 Sep → single 700k row on 17 Sep", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // No spreading: the full amount stays on the occurredAt day.
    expect(grouped).toEqual([{ key: "2026-09-17", total: 700_000 }]);
  });

  it("allocated expense on 17 Sep never leaks onto 18-19", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped.find((g) => g.key === "2026-09-18")).toBeUndefined();
    expect(grouped.find((g) => g.key === "2026-09-19")).toBeUndefined();
  });

  it("NONE expense stays on its own day (no spreading)", () => {
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual({ key: "2026-09-17", total: 50_000 });
  });

  it("mixed NONE + WEEKLY on the same day aggregate raw", () => {
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    // 17 Sep: 50k + 700k in full = 750k.
    expect(grouped).toEqual([{ key: "2026-09-17", total: 750_000 }]);
  });

  it("MONTHLY 3M on 17 Sep → single 3M row", () => {
    const expenses = [
      { id: "m1", amount: 3_000_000, allocationType: "MONTHLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toEqual([{ key: "2026-09-17", total: 3_000_000 }]);
  });

  it("WEEKLY expense created mid-week stays on its own day", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-19T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toEqual([{ key: "2026-09-19", total: 700_000 }]);
  });

  it("WEEKLY 701k stays whole on its own day (no remainder math)", () => {
    const expenses = [
      { id: "w1", amount: 701_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const grouped = groupExpensesByDay(expenses);
    expect(grouped).toEqual([{ key: "2026-09-17", total: 701_000 }]);
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

describe("hourlyBuckets — ignores allocation type (raw sums as-is)", () => {
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

  it("WEEKLY expense counts in full at its actual hour", () => {
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = hourlyBuckets(expenses, now);
    expect(buckets[10]!.total).toBe(700_000);
    expect(buckets.reduce((sum, b) => sum + b.total, 0)).toBe(700_000);
  });

  it("MONTHLY expense counts in full at its actual hour", () => {
    const expenses = [
      { id: "m1", amount: 3_000_000, allocationType: "MONTHLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = hourlyBuckets(expenses, now);
    expect(buckets[10]!.total).toBe(3_000_000);
  });

  it("mixed NONE + WEEKLY: both count at their actual hours", () => {
    const expenses = [
      { id: "n1", amount: 30_000, occurredAt: "2026-09-17T14:00:00+07:00" },
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = hourlyBuckets(expenses, now);
    expect(buckets[14]!.total).toBe(30_000);
    expect(buckets[10]!.total).toBe(700_000);
    expect(buckets.reduce((sum, b) => sum + b.total, 0)).toBe(730_000);
  });

  it("expense on a past day does not appear in another day's hourly chart", () => {
    // WEEKLY created Sep 15; Sep 17 hourly chart is for Sep 17 only.
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-15T14:32:00+07:00" },
    ];
    const buckets = hourlyBuckets(expenses, now);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});

describe("dailyBuckets — ignores allocation type (raw sums as-is)", () => {
  it("WEEKLY 700k on 17 Sep lands in full on 17 Sep only", () => {
    const range = last7DaysRange(new Date("2026-09-18T00:00:00+07:00"), APP_TIMEZONE);
    const expenses = [
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = dailyBuckets("week", range, expenses, new Date("2026-09-18T00:00:00+07:00"));
    const nonZero = buckets.filter((b) => b.total > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0]).toMatchObject({ key: "2026-09-17", total: 700_000 });
  });

  it("MONTHLY expense lands in full on its own day", () => {
    const range = { from: new Date("2026-09-01T00:00:00+07:00"), to: new Date("2026-10-01T00:00:00+07:00") };
    const expenses = [
      { id: "m1", amount: 3_000_000, allocationType: "MONTHLY" as const, occurredAt: "2026-09-15T10:00:00+07:00" },
    ];
    const buckets = dailyBuckets("month", range, expenses, new Date("2026-09-18T00:00:00+07:00"));
    const nonZero = buckets.filter((b) => b.total > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0]).toMatchObject({ key: "2026-09-15", total: 3_000_000 });
  });

  it("mixed NONE + WEEKLY on the same day combine raw", () => {
    const range = { from: new Date("2026-09-17T00:00:00+07:00"), to: new Date("2026-09-18T00:00:00+07:00") };
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00" },
      { id: "w1", amount: 700_000, allocationType: "WEEKLY" as const, occurredAt: "2026-09-17T10:00:00+07:00" },
    ];
    const buckets = dailyBuckets("day", range, expenses, new Date("2026-09-17T10:30:00+07:00"));
    const dayBucket = buckets.find((b) => b.key === "2026-09-17");
    // 50k + 700k in full = 750k.
    expect(dayBucket).toBeTruthy();
    expect(dayBucket!.total).toBe(750_000);
  });
});

describe("twoDayBuckets — month pairs", () => {
  // Fixed clock: last-30 window = Aug 26 00:00 → Sep 26 00:00 (31 civil days,
  // end-anchored) → 15 pairs + the oldest day standing alone.
  const NOW = new Date("2026-09-25T12:00:00+07:00");
  const range = last30DaysRange(NOW, APP_TIMEZONE);

  it("renders pair candles anchored at the range end, orphan oldest first", () => {
    const buckets = twoDayBuckets(range, [], NOW);
    expect(buckets).toHaveLength(16);
    expect(buckets[0]!.key).toBe("2026-08-26");
    expect(buckets[15]!.key).toBe("2026-09-24");
    expect(buckets.every((b) => b.kind === "day")).toBe(true);
  });

  it("sums both days raw into the pair, keyed + labeled by the first day", () => {
    const buckets = twoDayBuckets(
      range,
      [
        { id: "a", amount: 10_000, occurredAt: "2026-09-20T10:00:00+07:00" },
        { id: "b", amount: 25_000, occurredAt: "2026-09-21T10:00:00+07:00" },
        { id: "c", amount: 5_000, occurredAt: "2026-09-10T10:00:00+07:00" },
      ],
      NOW,
    );
    const pair = buckets.find((b) => b.key === "2026-09-20");
    expect(pair).toMatchObject({ key: "2026-09-20", label: "20", total: 35_000 });
    // Second day of the pair never stands alone.
    expect(buckets.find((b) => b.key === "2026-09-21")).toBeUndefined();
    expect(buckets.find((b) => b.key === "2026-09-10")).toMatchObject({ total: 5_000 });
  });

  it("marks the pair containing today as current", () => {
    const buckets = twoDayBuckets(range, [], NOW);
    // 31-day window, end-anchored: [..., (Sep 22, Sep 23), (Sep 24, Sep 25)].
    const current = buckets.filter((b) => b.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.key).toBe("2026-09-24");
  });

  it("sets endKey on real pairs, omits it on the orphan single", () => {
    const buckets = twoDayBuckets(range, [], NOW);
    // Oldest day (Aug 26) stands alone: 31 dates → 15 pairs + 1 orphan.
    expect(buckets).toHaveLength(16);
    expect(buckets[0]!.key).toBe("2026-08-26");
    expect("endKey" in buckets[0]!).toBe(false);
    expect(buckets[buckets.length - 1]).toMatchObject({ key: "2026-09-24", endKey: "2026-09-25" });
  });
});
