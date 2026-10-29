import { describe, expect, it } from "vitest";

import { budgetForecast, historicalForecast } from "./budgetForecast";
import type { BudgetSeriesDay } from "./budgetDashboard";

const TZ = "Asia/Jakarta";
const NOW = new Date("2026-09-10T10:00:00+07:00");

function series(startDate: string, totals: number[]): BudgetSeriesDay[] {
  const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
  return totals.map((total, index) => ({
    date: new Date(Date.UTC(y, m - 1, d + index)).toISOString().slice(0, 10),
    total,
  }));
}

describe("budgetForecast — full", () => {
  it("projects under the cap and exposes a per-day allowance", () => {
    const forecast = budgetForecast({
      type: "full",
      amount: 3_000_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      days: series("2026-09-01", [90_000, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000]),
      todaySpent: 90_000,
      now: NOW,
      timeZone: TZ,
    });

    expect(forecast.available).toBe(true);
    expect(forecast.elapsedDays).toBe(10);
    expect(forecast.remainingDays).toBe(20);
    expect(forecast.avgPerDay).toBe(90_000);
    expect(forecast.projectedTotal).toBe(2_700_000);
    expect(forecast.projectedDelta).toBe(300_000);
    expect(forecast.allowedPerDay).toBe(105_000);
    expect(forecast.overDays).toBeNull();
    expect(forecast.totalDays).toBe(30);
  });

  it("projects over the cap and clamps the allowance at zero", () => {
    const forecast = budgetForecast({
      type: "full",
      amount: 1_000_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      days: series("2026-09-01", Array.from({ length: 10 }, () => 120_000)),
      todaySpent: 120_000,
      now: NOW,
      timeZone: TZ,
    });

    expect(forecast.projectedTotal).toBe(3_600_000);
    expect(forecast.projectedDelta).toBe(-2_600_000);
    expect(forecast.allowedPerDay).toBe(0);
  });

  it("hides the per-day allowance on the last day (remainingDays = 0)", () => {
    const forecast = budgetForecast({
      type: "full",
      amount: 100_000,
      startDate: "2026-09-30",
      endDate: "2026-09-30",
      days: series("2026-09-30", [50_000]),
      todaySpent: 50_000,
      now: NOW,
      timeZone: TZ,
    });

    expect(forecast.remainingDays).toBe(0);
    expect(forecast.projectedTotal).toBe(50_000);
    expect(forecast.allowedPerDay).toBeNull();
  });

  it("is unavailable before the period starts", () => {
    const forecast = budgetForecast({
      type: "full",
      amount: 1_000_000,
      startDate: "2099-01-01",
      endDate: "2099-01-31",
      days: [],
      todaySpent: 0,
      now: NOW,
      timeZone: TZ,
    });

    expect(forecast.available).toBe(false);
    expect(forecast.elapsedDays).toBe(0);
    expect(forecast.projectedTotal).toBeNull();
    expect(forecast.remainingDays).toBe(31);
  });
});

describe("budgetForecast — daily", () => {
  it("has no nominal projection, counts over days and keeps today's remaining cap", () => {
    const forecast = budgetForecast({
      type: "daily",
      amount: 150_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      days: series("2026-09-01", [100_000, 200_000, 50_000]),
      todaySpent: 50_000,
      now: NOW,
      timeZone: TZ,
    });

    expect(forecast.available).toBe(true);
    expect(forecast.avgPerDay).toBe(116_667);
    expect(forecast.remainingDays).toBe(27);
    expect(forecast.projectedTotal).toBeNull();
    expect(forecast.projectedDelta).toBeNull();
    expect(forecast.allowedPerDay).toBe(100_000);
    expect(forecast.overDays).toBe(1);
    expect(forecast.totalDays).toBe(30);
  });
});

describe("historicalForecast", () => {
  const base = {
    type: "full" as const,
    amount: 1_000_000,
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    now: NOW,
    timeZone: TZ,
  };

  it("marks reality as better when the second half was cheaper", () => {
    const result = historicalForecast({
      ...base,
      days: series("2026-08-01", [50_000, 50_000, 50_000, 50_000, 50_000, 20_000, 20_000, 20_000, 20_000, 20_000]),
    });

    expect(result.available).toBe(true);
    expect(result.projectedTotal).toBe(500_000);
    expect(result.actualTotal).toBe(350_000);
    expect(result.surprise).toBe(-150_000);
    expect(result.tone).toBe("better");
  });

  it("marks reality as worse when the second half was more expensive", () => {
    const result = historicalForecast({
      ...base,
      days: series("2026-08-01", [20_000, 20_000, 20_000, 20_000, 20_000, 100_000, 100_000, 100_000, 100_000, 100_000]),
    });

    expect(result.tone).toBe("worse");
    expect(result.surprise).toBe(400_000);
  });

  it("marks a tiny miss as close (< 10% of the amount)", () => {
    const result = historicalForecast({
      ...base,
      days: series("2026-08-01", [50_000, 50_000, 50_000, 50_000, 50_000, 55_000, 55_000, 55_000, 55_000, 55_000]),
    });

    expect(result.tone).toBe("close");
    expect(result.surprise).toBe(25_000);
  });

  it("is unavailable for daily budgets (caps reset every day)", () => {
    const result = historicalForecast({
      ...base,
      type: "daily",
      days: series("2026-08-01", [10_000, 10_000]),
    });

    expect(result.available).toBe(false);
    expect(result.projectedTotal).toBeNull();
    expect(result.surprise).toBeNull();
    expect(result.actualTotal).toBe(20_000);
  });

  it("is unavailable for single-day ranges", () => {
    const result = historicalForecast({
      ...base,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      days: series("2026-08-01", [10_000]),
    });

    expect(result.available).toBe(false);
  });
});
