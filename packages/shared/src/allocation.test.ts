import { describe, expect, it } from "vitest";

import {
  allocateAmount,
  allocationAwareTotal,
  allocationWindow,
  distributeAllocation,
  expenseEffectiveAmount,
  fairBreakdownForDay,
  fairPeriodRange,
  fairTotalForPeriod,
  type AllocationType,
  type AllocationWindow,
} from "./allocation";
import { addCivilDays, getZonedParts, zonedWallTimeToUtc } from "./periods";

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

describe("fairPeriodRange", () => {
  it("caps `to` at tomorrow 00:00 Jakarta when period.to is in the future", () => {
    const now = new Date("2026-09-17T14:00:00+07:00"); // today 14:00
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 11 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 20 }),
    };
    const range = fairPeriodRange(period, TZ, now);
    const toParts = getZonedParts(range.to, TZ);
    expect(toParts.year).toBe(2026);
    expect(toParts.month).toBe(9);
    expect(toParts.day).toBe(18);
  });

  it("keeps `to` unchanged when it is already before tomorrow", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 16 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
    };
    const range = fairPeriodRange(period, TZ, now);
    expect(range.to.getTime()).toBe(period.to.getTime());
  });

  it("keeps `from` unchanged", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 10 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    const range = fairPeriodRange(period, TZ, now);
    expect(range.from.getTime()).toBe(period.from.getTime());
  });
});

describe("fairTotalForPeriod", () => {
  it("NONE in-period + WEEKLY 700k day1→100k + MONTHLY 300k day1→10k = 160000", () => {
    const now = new Date("2026-09-17T14:00:00+07:00"); // today
    const expenses = [
      { amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" as AllocationType },
      { amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
      { amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as AllocationType },
    ];
    // Period: today (day)
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    expect(fairTotalForPeriod(expenses, period, TZ, now)).toBe(160_000);
  });

  it("MONTHLY expense 10 days ago still contributes 10k to today's fair total (tail overlaps)", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    // Monthly expense started 10 days ago (Sep 7), 300k → 10k per day
    const expenses = [
      { amount: 300_000, occurredAt: "2026-09-07T10:00:00+07:00", allocationType: "MONTHLY" as AllocationType },
    ];
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    // Today is day 11 of the window → 10k effective for today
    expect(fairTotalForPeriod(expenses, period, TZ, now)).toBe(10_000);
  });

  it("future-tail MONTHLY expense does not leak to today's fair total (window not yet started)", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    // Monthly expense created today → window starts today, today is day 1 → 10k
    const expenses = [
      { amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as AllocationType },
    ];
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    expect(fairTotalForPeriod(expenses, period, TZ, now)).toBe(10_000);
  });

  it("caps at tomorrow midnight — no future days counted even for long WEEKLY window", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    // WEEKLY 700k started today → day 1 = 100k, but period.to is far future
    const expenses = [
      { amount: 700_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
    ];
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 11 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 30 }),
    };
    // Fair window: [Sep 11, Sep 18) (capped at tomorrow). WEEKLY started Sep 17.
    // Days 17 = day 1 (100k). Days 11-16 = 0 for this expense.
    expect(fairTotalForPeriod(expenses, period, TZ, now)).toBe(100_000);
  });
});

describe("allocationAwareTotal with expanded range", () => {
  it("sums ALL expenses across an expanded range correctly (raw sum not applied)", () => {
    const expenses = [
      { amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" as AllocationType },
      { amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
      { amount: 300_000, occurredAt: "2026-09-07T08:00:00+07:00", allocationType: "MONTHLY" as AllocationType },
    ];
    const period = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 7 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
    };
    // NONE: 50k (day 17) + 0 (day 7 is NONE at Sep 7, in period → 0 from day 17 expense... actually)
    // Let's just check: NONE expense is at Sep 17 → in [Sep7, Sep18) → 50k
    // WEEKLY 700k at Sep 17 → window Sep17-24. Overlap with [Sep7, Sep18): day 17 only → 100k
    // MONTHLY 300k at Sep 7 → window Sep7-Oct7. Overlap with [Sep7, Sep18): days 7-17 = 11 days → 11 * 10k = 110k
    const result = allocationAwareTotal(expenses, period, TZ);
    expect(result).toBe(50_000 + 100_000 + 110_000);
  });
});

describe("fairBreakdownForDay", () => {
  const day17 = {
    from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 17 }),
    to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 18 }),
  };

  it("WEEKLY 700k → 100k/day, MONTHLY 300k → 10k/day, NONE excluded from rows but in total", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const expenses = [
      { id: "e1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" as AllocationType },
      { id: "e2", amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
      { id: "e3", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as AllocationType },
    ];
    const result = fairBreakdownForDay(expenses, day17, TZ, now);
    expect(result.fairTotal).toBe(160_000);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.some((r) => r.id === "e2" && r.allocationType === "WEEKLY" && r.perDayAmount === 100_000)).toBe(true);
    expect(result.rows.some((r) => r.id === "e3" && r.allocationType === "MONTHLY" && r.perDayAmount === 10_000)).toBe(true);
  });

  it("MONTHLY expense from 20 days ago contributes 10k/day to today", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const expenses = [
      { id: "m1", amount: 300_000, occurredAt: "2026-08-28T10:00:00+07:00", allocationType: "MONTHLY" as AllocationType },
    ];
    const result = fairBreakdownForDay(expenses, day17, TZ, now);
    expect(result.fairTotal).toBe(10_000);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "m1", allocationType: "MONTHLY", perDayAmount: 10_000 });
  });

  it("expense outside the allocation window does not appear in rows", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    // WEEKLY 700k started Sep 17, so Sep 25 (day 9) is outside its 7-day window.
    const day25 = {
      from: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 25 }),
      to: zonedWallTimeToUtc(TZ, { year: 2026, month: 9, day: 26 }),
    };
    const expenses = [
      { id: "w1", amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
    ];
    const result = fairBreakdownForDay(expenses, day25, TZ, now);
    expect(result.fairTotal).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it("NONE expense in-period included in total but not in rows", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const expenses = [
      { id: "n1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" as AllocationType },
    ];
    const result = fairBreakdownForDay(expenses, day17, TZ, now);
    expect(result.fairTotal).toBe(50_000);
    expect(result.rows).toHaveLength(0);
  });

  it("no contributors → empty rows, fairTotal 0 (raw == fair)", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const result = fairBreakdownForDay([], day17, TZ, now);
    expect(result.fairTotal).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it("remainder spreads to earliest days — day 1 gets base+1", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    // 1_000_001 / 7 = 142857 base, remainder 2 → days 1 and 2 get +1
    const expenses = [
      { id: "r1", amount: 1_000_001, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
    ];
    const result = fairBreakdownForDay(expenses, day17, TZ, now);
    expect(result.fairTotal).toBe(142_858);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.perDayAmount).toBe(142_858);
  });

  it("expense id falls back to index when missing", () => {
    const now = new Date("2026-09-17T14:00:00+07:00");
    const expenses = [
      { amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as AllocationType },
    ];
    const result = fairBreakdownForDay(expenses, day17, TZ, now);
    expect(result.rows[0]!.id).toBe("fair-row-0");
  });
});
