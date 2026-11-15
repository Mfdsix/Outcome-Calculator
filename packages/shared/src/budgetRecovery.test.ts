import { describe, expect, it } from "vitest";

import { recoveryOption, recoveryPlan } from "./budgetRecovery";

/**
 * Today = 2026-11-15, range 1..25 Nov, cap Rp70.000/3 hari berjalan → 15
 * elapsed days = Rp1.050.000 allowance. Spending Rp1.080.000 leaves a
 * Rp30.000 deficit.
 */
function plan(overrides: Partial<Parameters<typeof recoveryPlan>[0]> = {}) {
  return recoveryPlan({
    type: "daily",
    amount: 70_000,
    startDate: "2026-11-01",
    endDate: "2026-11-25",
    todayKey: "2026-11-15",
    spentToDate: 1_080_000,
    ...overrides,
  });
}

/** Numbers for a horizon on top of the default plan (deficit Rp30.000). */
function option(days: number, overrides: Partial<Parameters<typeof recoveryPlan>[0]> = {}) {
  const base = plan(overrides);
  return recoveryOption({
    todayKey: base.todayKey,
    days,
    deficit: base.deficit,
    dailyCap: base.dailyCap,
  });
}

describe("recoveryPlan — availability", () => {
  it("plans the CUMULATIVE overrun for the running range", () => {
    const result = plan();

    expect(result.available).toBe(true);
    expect(result.todayKey).toBe("2026-11-15");
    expect(result.endDate).toBe("2026-11-25");
    expect(result.dailyCap).toBe(70_000);
    expect(result.elapsedDays).toBe(15); // 1..15 Nov inclusive
    expect(result.allowanceToDate).toBe(1_050_000); // 15 × 70.000
    expect(result.spentToDate).toBe(1_080_000);
    expect(result.deficit).toBe(30_000);
    expect(result.daysLeft).toBe(10); // 16..25 Nov
  });

  it("ignores a day that is only over TODAY's cap but still on track overall", () => {
    // 14 days at Rp50.000 + today Rp150.000 = Rp850.000 < Rp1.050.000.
    expect(plan({ spentToDate: 850_000 }).available).toBe(false);
  });

  it("is unavailable when the range is exactly inside the cap", () => {
    expect(plan({ spentToDate: 1_050_000 }).available).toBe(false); // +0, not in the red
  });

  it("is unavailable for full budgets (no per-day reset)", () => {
    expect(plan({ type: "full", amount: 3_000_000, spentToDate: 5_000_000 }).available).toBe(false);
  });

  it("is unavailable outside the budget range", () => {
    expect(plan({ todayKey: "2026-10-31" }).available).toBe(false); // before start
    expect(plan({ todayKey: "2026-11-26" }).available).toBe(false); // after end
  });

  it("is unavailable on a zero cap", () => {
    expect(plan({ amount: 0 }).available).toBe(false);
  });

  it("reports zero days left on the last day of the period", () => {
    const result = plan({ endDate: "2026-11-15" });

    expect(result.available).toBe(true);
    expect(result.daysLeft).toBe(0);
    expect(result.elapsedDays).toBe(15);
  });

  it("reports the minimum days of zero spending needed", () => {
    // cap 10.000 × 15 days = 150.000 allowance; 240.000 spent → 90.000 deficit.
    const result = plan({ amount: 10_000, spentToDate: 240_000 });
    expect(result.deficit).toBe(90_000);
    expect(result.minDaysToBreakEven).toBe(9);
  });
});

describe("recoveryOption — one horizon", () => {
  it("divides the deficit and rounds the saving UP to Rp1.000", () => {
    expect(option(5)).toMatchObject({
      days: 5,
      savingsPerDay: 6_000,
      targetPerDay: 64_000,
      reachable: true,
    });
    // 30.000 / 7 = 4.286 → 5.000
    expect(option(7)).toMatchObject({ days: 7, savingsPerDay: 5_000, targetPerDay: 65_000 });
    // 30.000 / 10 = 3.000 exactly
    expect(option(10)).toMatchObject({ days: 10, savingsPerDay: 3_000, targetPerDay: 67_000 });
  });

  it("rounds a sub-Rp1.000 share up to one step, never to zero", () => {
    expect(option(25).savingsPerDay).toBe(2_000); // 1.200 → 2.000
    expect(option(30).savingsPerDay).toBe(1_000); // 1.000 exactly
  });

  it("dates the break-even at today + days", () => {
    expect(option(1).endDate).toBe("2026-11-16");
    expect(option(5).endDate).toBe("2026-11-20");
    expect(option(10).endDate).toBe("2026-11-25"); // the budget's own end date
  });

  it("clamps the horizon to at least one day", () => {
    expect(option(0).days).toBe(1);
    expect(option(-4).days).toBe(1);
  });

  it("marks a horizon unreachable when even zero spending cannot offset it", () => {
    const five = option(5, { amount: 10_000, spentToDate: 240_000 }); // deficit 90.000

    expect(five).toMatchObject({ savingsPerDay: 18_000, reachable: false, targetPerDay: 0 });
    expect(option(10, { amount: 10_000, spentToDate: 240_000 }).reachable).toBe(true); // 9.000
  });

  it("floors the target at zero", () => {
    const huge = option(1, { amount: 70_000, spentToDate: 10_000_000 });
    expect(huge.targetPerDay).toBe(0);
    expect(huge.reachable).toBe(false);
  });
});
