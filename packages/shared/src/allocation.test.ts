import { describe, expect, it } from "vitest";

import {
  allocateAmount,
  allocationWindow,
  distributeAllocation,
  expenseEffectiveAmount,
  type AllocationType,
  type AllocationWindow,
} from "./allocation";
import { getZonedParts, zonedWallTimeToUtc } from "./periods";

const TZ = "Asia/Jakarta";

describe("allocationWindow", () => {
  const anchor = new Date("2026-09-17T14:00:00+07:00"); // Thursday

  it("returns null for NONE", () => {
    expect(allocationWindow(anchor, "NONE", TZ)).toBeNull();
  });

  it("WEEKLY → 7 civil days from 00:00 Jakarta", () => {
    const win = allocationWindow(anchor, "WEEKLY", TZ);
    expect(win).not.toBeNull();
    expect(win!.days).toBe(7);
    const fromParts = getZonedParts(win!.from, TZ);
    const toParts = getZonedParts(win!.to, TZ);
    expect(fromParts.hour).toBe(0);
    expect(fromParts.minute).toBe(0);
    expect(toParts.hour).toBe(0);
    expect(toParts.minute).toBe(0);
    // 2026-09-17 + 7 = 2026-09-24
    expect(fromParts.day).toBe(17);
    expect(toParts.day).toBe(24);
  });

  it("MONTHLY → 30 civil days from 00:00 Jakarta", () => {
    const win = allocationWindow(anchor, "MONTHLY", TZ);
    expect(win).not.toBeNull();
    expect(win!.days).toBe(30);
  });

  it("crosses month boundary correctly (anchor 28 Sep → +7 = 5 Oct)", () => {
    const sep28 = new Date("2026-09-28T10:00:00+07:00");
    const win = allocationWindow(sep28, "WEEKLY", TZ);
    expect(win).not.toBeNull();
    const toParts = getZonedParts(win!.to, TZ);
    expect(toParts.month).toBe(10);
    expect(toParts.day).toBe(5);
  });
});

describe("distributeAllocation", () => {
  const anchor = new Date("2026-09-17T00:00:00+07:00");

  it("distributes evenly when amount divides cleanly", () => {
    const win = allocationWindow(anchor, "WEEKLY", TZ)!;
    const { perDay, total } = distributeAllocation(700_000, win, TZ);
    expect(total).toBe(700_000n);
    expect(perDay.size).toBe(7);
    for (const amount of perDay.values()) {
      expect(amount).toBe(100_000n);
    }
  });

  it("spreads remainder 1 per day on earliest days", () => {
    // 1.000.001 / 7 → base 142.857 each (142857), remainder 2
    const win = allocationWindow(anchor, "WEEKLY", TZ)!;
    const { perDay, total } = distributeAllocation(1_000_001, win, TZ);
    expect(total).toBe(1_000_001n);
    // 7 × 142857 = 999.999, + 2 remainder = 1.000.001
    const base = 1_000_001n / 7n; // 142857
    const remainder = 1_000_001n % 7n; // 2
    const values = Array.from(perDay.values());
    // Days with base + 1 should be the first `remainder` days
    const extraDays = values.filter((v) => v === base + 1n);
    expect(extraDays.length).toBe(Number(remainder));
  });

  it("handles amount that does not divide evenly (700k / 30)", () => {
    const win = allocationWindow(anchor, "MONTHLY", TZ)!;
    const { perDay, total } = distributeAllocation(700_000, win, TZ);
    expect(total).toBe(700_000n);
    // 700000 / 30 = 23333.33 → base 23333, remainder 700000 - 23333*30 = 700000 - 699990 = 10
    const base = 700_000n / 30n; // 23333
    const extraDays = Array.from(perDay.values()).filter((v) => v === base + 1n);
    expect(extraDays.length).toBe(10);
  });

  it("zero amount returns empty distribution", () => {
    const win = allocationWindow(anchor, "WEEKLY", TZ)!;
    const { perDay, total } = distributeAllocation(0, win, TZ);
    expect(total).toBe(0n);
    expect(perDay.size).toBe(7);
    for (const amount of perDay.values()) {
      expect(amount).toBe(0n);
    }
  });
});

describe("expenseEffectiveAmount", () => {
  const period = {
    from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
    to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
  };

  it("NONE expense in-period returns full amount", () => {
    const expense = {
      amount: 50000,
      occurredAt: "2026-09-17T10:00:00+07:00",
      allocationType: "NONE" as AllocationType,
    };
    expect(expenseEffectiveAmount(expense, period, TZ)).toBe(50000);
  });

  it("NONE expense out-of-period returns 0", () => {
    const expense = {
      amount: 50000,
      occurredAt: "2026-09-16T10:00:00+07:00",
      allocationType: "NONE" as AllocationType,
    };
    expect(expenseEffectiveAmount(expense, period, TZ)).toBe(0);
  });

  it("WEEKLY expense 700k on day 1 → 100k effective for that day", () => {
    const expense = {
      amount: 700_000,
      occurredAt: "2026-09-17T10:00:00+07:00",
      allocationType: "WEEKLY" as AllocationType,
    };
    expect(expenseEffectiveAmount(expense, period, TZ)).toBe(100_000);
  });

  it("WEEKLY expense on day 3 → 100k effective for day 3", () => {
    const day3Expense = {
      amount: 700_000,
      occurredAt: "2026-09-19T10:00:00+07:00",
      allocationType: "WEEKLY" as AllocationType,
    };
    const day3Period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 19 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 20 }),
    };
    expect(expenseEffectiveAmount(day3Expense, day3Period, TZ)).toBe(100_000);
  });

  it("WEEKLY expense allocated to 17-23 Sep but period is 18-19 → 2 days effective", () => {
    const expense = {
      amount: 700_000,
      occurredAt: "2026-09-17T10:00:00+07:00",
      allocationType: "WEEKLY" as AllocationType,
    };
    const twoDayPeriod = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 20 }),
    };
    expect(expenseEffectiveAmount(expense, twoDayPeriod, TZ)).toBe(200_000);
  });

  it("WEEKLY expense with remainder (1.000.001 / 7), day 1 gets 142858, day 2 gets 142858", () => {
    const expense = {
      amount: 1_000_001,
      occurredAt: "2026-09-17T10:00:00+07:00",
      allocationType: "WEEKLY" as AllocationType,
    };
    // Day 1 gets 142857 + 1 = 142858, day 2 gets 142857 + 1 = 142858 (remainder 2 spread to first 2 days)
    expect(expenseEffectiveAmount(expense, period, TZ)).toBe(142_858);
  });
});

describe("allocateAmount", () => {
  it("NONE: full amount if in period, 0 otherwise", () => {
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    expect(allocateAmount(50000, "NONE", "2026-09-17T10:00:00+07:00", period, TZ)).toBe(50000);
    expect(allocateAmount(50000, "NONE", "2026-09-16T10:00:00+07:00", period, TZ)).toBe(0);
  });

  it("WEEKLY: prorates to 1/7 per day in period", () => {
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    expect(allocateAmount(700_000, "WEEKLY", "2026-09-17T10:00:00+07:00", period, TZ)).toBe(100_000);
  });

  it("WEEKLY: partial overlap (period covers days 2-3 of a 7-day window)", () => {
    const expense = {
      amount: 700_000,
      occurredAt: "2026-09-17T10:00:00+07:00",
      allocationType: "WEEKLY" as AllocationType,
    };
    // Days 18 and 19 are days 2 and 3 of the window (17-23 Sep)
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 20 }),
    };
    expect(allocateAmount(700_000, "WEEKLY", "2026-09-17T10:00:00+07:00", period, TZ)).toBe(200_000);
  });
});
