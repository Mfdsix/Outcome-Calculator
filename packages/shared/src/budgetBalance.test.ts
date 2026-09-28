import { describe, expect, it } from "vitest";

import {
  budgetBalance,
  BALANCE_DEVIATION_PCT,
} from "./budgetBalance";
import { PACE_DEVIATION_PCT } from "./insights";

const timeZone = "Asia/Jakarta";

/** Full-month budget helper (plan §3: 1st → last day). */
function fullBudget(overrides: Partial<{
  amount: number;
  startDate: string;
  endDate: string;
  spent: number;
}> = {}): { type: "full"; amount: number; startDate: string; endDate: string; spent: number } {
  return {
    type: "full",
    amount: 300_000,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    spent: 0,
    ...overrides,
  };
}

describe("budgetBalance — full type", () => {
  it("boros: spent > fair + threshold → dev > threshold", () => {
    // Day 15 of 30: fair = 150.000. Spent 200.000 → dev = 50.000 > threshold 30.000.
    const result = budgetBalance(
      fullBudget({ startDate: "2026-09-01", endDate: "2026-09-30", spent: 200_000 }),
      "2026-09-15T12:00:00+07:00",
      timeZone,
    );
    expect(result.dayIndex).toBe(15);
    expect(result.totalDays).toBe(30);
    expect(result.daysLeft).toBe(15);
    expect(result.fair).toBe(150_000);
    expect(result.dev).toBe(50_000);
    expect(result.threshold).toBe(30_000); // 10% of 300.000
    expect(result.dev).toBeGreaterThan(result.threshold);
  });

  it("surplus: spent well below fair → dev < -threshold", () => {
    // Day 15: fair 150.000. Spent 50.000 → dev = -100.000.
    const result = budgetBalance(
      fullBudget({ spent: 50_000 }),
      "2026-09-15T12:00:00+07:00",
      timeZone,
    );
    expect(result.dev).toBe(-100_000);
    expect(result.dev).toBeLessThan(-result.threshold);
  });

  it("on-track: within ±threshold → di jalur", () => {
    // Day 10 of 30: fair 100.000. Spent 105.000 → dev 5.000 < threshold 30.000.
    const result = budgetBalance(
      fullBudget({ spent: 105_000 }),
      "2026-09-10T12:00:00+07:00",
      timeZone,
    );
    expect(Math.abs(result.dev)).toBeLessThanOrEqual(result.threshold);
  });

  it("recovery math: ceil(dev / daysLeft / 1000) * 1000 per day", () => {
    // Day 15: fair 150.000, spent 210.000 → dev = 60.000, daysLeft = 15.
    // perDay = ceil(60000 / 15 / 1000) * 1000 = ceil(4) * 1000 = 4000.
    const result = budgetBalance(
      fullBudget({ spent: 210_000 }),
      "2026-09-15T12:00:00+07:00",
      timeZone,
    );
    expect(result.dev).toBe(60_000);
    expect(result.daysLeft).toBe(15);
    const perDay = Math.ceil(result.dev / result.daysLeft / 1000) * 1000;
    expect(perDay).toBe(4_000);
  });

  it("daysLeft = 0 on the last day → no recovery nudge path", () => {
    const result = budgetBalance(
      fullBudget({ spent: 200_000 }),
      "2026-09-30T12:00:00+07:00",
      timeZone,
    );
    expect(result.daysLeft).toBe(0);
    expect(result.dayIndex).toBe(30);
  });

  it("finished period (today past end) → finished=true, dev over cap", () => {
    const result = budgetBalance(
      fullBudget({ startDate: "2026-09-01", endDate: "2026-09-10", spent: 250_000 }),
      "2026-09-20T12:00:00+07:00",
      timeZone,
    );
    expect(result.finished).toBe(true);
    expect(result.upcoming).toBe(false);
    expect(result.daysLeft).toBe(0);
  });

  it("upcoming period (today before start) → upcoming=true, fair=0", () => {
    const result = budgetBalance(
      fullBudget({ startDate: "2026-09-20", endDate: "2026-09-30", spent: 0 }),
      "2026-09-10T12:00:00+07:00",
      timeZone,
    );
    expect(result.upcoming).toBe(true);
    expect(result.finished).toBe(false);
    expect(result.fair).toBe(0);
    expect(result.daysLeft).toBe(11); // 20 Sep - 10 Sep = 10, +1 inclusive = 11
  });
});

describe("budgetBalance — daily type", () => {
  it("daily cumulative: fair = amount × dayIndex", () => {
    // Daily budget: amount is per-day cap. Day 15 → fair 15 × amount.
    const result = budgetBalance(
      { type: "daily", amount: 10_000, startDate: "2026-09-01", endDate: "2026-09-30", spent: 200_000 },
      "2026-09-15T12:00:00+07:00",
      timeZone,
    );
    expect(result.fair).toBe(150_000); // 10.000 × 15
    expect(result.dev).toBe(50_000); // 200.000 - 150.000
  });

  it("daily on-track", () => {
    // Daily amount 10.000, threshold = 1.000. Day 15: fair 150.000.
    // Spent 150.000 → dev 0 (exactly on track).
    const result = budgetBalance(
      { type: "daily", amount: 10_000, startDate: "2026-09-01", endDate: "2026-09-30", spent: 150_000 },
      "2026-09-15T12:00:00+07:00",
      timeZone,
    );
    expect(result.dev).toBe(0);
    expect(Math.abs(result.dev)).toBeLessThanOrEqual(result.threshold);
  });
});

describe("budgetBalance — threshold consistency", () => {
  it("BALANCE_DEVIATION_PCT equals PACE_DEVIATION_PCT (shared vocabulary)", () => {
    expect(BALANCE_DEVIATION_PCT).toBe(PACE_DEVIATION_PCT);
  });
});
