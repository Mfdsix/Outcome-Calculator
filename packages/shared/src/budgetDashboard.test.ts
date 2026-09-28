import { describe, expect, it } from "vitest";

import {
  fillDaySeries,
  dailyDeltas,
  periodPosition,
  buildDashboardData,
  STREAK_MIN_DAYS,
} from "./budgetDashboard";
import type { BudgetDayPoint } from "./types";

describe("fillDaySeries", () => {
  it("zero-fills missing days between start and end", () => {
    const sparse: BudgetDayPoint[] = [
      { date: "2026-09-01", total: 10_000 },
      { date: "2026-09-05", total: 20_000 },
    ];
    const result = fillDaySeries(sparse, "2026-09-01", "2026-09-05");
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ date: "2026-09-01", total: 10_000 });
    expect(result[1]).toEqual({ date: "2026-09-02", total: 0 });
    expect(result[2]).toEqual({ date: "2026-09-03", total: 0 });
    expect(result[3]).toEqual({ date: "2026-09-04", total: 0 });
    expect(result[4]).toEqual({ date: "2026-09-05", total: 20_000 });
  });

  it("returns empty array for same start and end (single day)", () => {
    const result = fillDaySeries([], "2026-09-15", "2026-09-15");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-09-15", total: 0 });
  });
});

describe("dailyDeltas", () => {
  it("daily: adds delta = cap - total per day", () => {
    const days = [
      { date: "2026-09-01", total: 30_000 },
      { date: "2026-09-02", total: 80_000 },
      { date: "2026-09-03", total: 0 },
    ];
    const result = dailyDeltas(days, 50_000, "daily");
    expect((result[0] as { delta: number }).delta).toBe(20_000); // under
    expect((result[1] as { delta: number }).delta).toBe(-30_000); // over
    expect((result[2] as { delta: number }).delta).toBe(50_000); // under (zero)
  });

  it("full: returns unchanged (no delta)", () => {
    const days = [{ date: "2026-09-01", total: 30_000 }];
    const result = dailyDeltas(days, 100_000, "full");
    expect(result).toBe(days);
  });
});

describe("periodPosition — daily", () => {
  const timeZone = "Asia/Jakarta";
  const nowISO = "2026-09-03T12:00:00+07:00";

  it("daily: allowance = amount × elapsedDays, progress = spent/allowance", () => {
    // 3 days: Sep 1 (50k), Sep 2 (50k), Sep 3 (0). Today = Sep 3 = day 3.
    // Cap 50k/day → allowance = 150k, spent = 100k → 67% progress.
    const days = [
      { date: "2026-09-01", total: 50_000 },
      { date: "2026-09-02", total: 50_000 },
      { date: "2026-09-03", total: 0 },
    ];
    const deltas = dailyDeltas(days, 50_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 50_000, "daily", 0, timeZone, nowISO);
    expect(result.spent).toBe(100_000);
    expect(result.remaining).toBe(50_000); // 150k allowance - 100k spent
    expect(result.progressPct).toBe(67);
  });

  it("daily: over today → status over", () => {
    // Cap 50k/day. Today spent 60k → over.
    const days = [
      { date: "2026-09-01", total: 0 },
      { date: "2026-09-02", total: 0 },
      { date: "2026-09-03", total: 60_000 }, // today
    ];
    const deltas = dailyDeltas(days, 50_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 50_000, "daily", 60_000, timeZone, nowISO);
    expect(result.status).toBe("over");
  });

  it("daily: streak ≥ 2 under days from today backward", () => {
    // Sep 1: 60k (over), Sep 2: 30k (under), Sep 3: 20k (under). Today = Sep 3.
    // Streak from today backward: Sep 3 under, Sep 2 under → streak 2 under.
    const days = [
      { date: "2026-09-01", total: 60_000 },
      { date: "2026-09-02", total: 30_000 },
      { date: "2026-09-03", total: 20_000 },
    ];
    const deltas = dailyDeltas(days, 50_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 50_000, "daily", 20_000, timeZone, nowISO);
    expect(result.streak).not.toBeNull();
    expect(result.streak!.count).toBe(2);
    expect(result.streak!.under).toBe(true);
  });

  it("daily: streak breaks when a day has opposite sign", () => {
    // Sep 1: 20k (under), Sep 2: 60k (over), Sep 3: 10k (under). Today = Sep 3.
    // Only today is under → streak 1 < STREAK_MIN_DAYS → null.
    const days = [
      { date: "2026-09-01", total: 20_000 },
      { date: "2026-09-02", total: 60_000 },
      { date: "2026-09-03", total: 10_000 },
    ];
    const deltas = dailyDeltas(days, 50_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 50_000, "daily", 10_000, timeZone, nowISO);
    expect(result.streak).toBeNull(); // streak = 1 < 2
  });

  it("daily: streak null when today not in series", () => {
    const days = [{ date: "2026-09-01", total: 0 }];
    const deltas = dailyDeltas(days, 50_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 50_000, "daily", 0, timeZone, nowISO);
    expect(result.streak).toBeNull();
  });
});

describe("periodPosition — full", () => {
  const timeZone = "Asia/Jakarta";
  const nowISO = "2026-09-15T12:00:00+07:00";

  it("full: progress = spent / amount, no streak", () => {
    // 5 days, 1M cap, spent 400k → 40%, remaining 600k.
    const days = [
      { date: "2026-09-11", total: 100_000 },
      { date: "2026-09-12", total: 100_000 },
      { date: "2026-09-13", total: 100_000 },
      { date: "2026-09-14", total: 100_000 },
      { date: "2026-09-15", total: 0 },
    ];
    const result = periodPosition(days, 1_000_000, "full", 0, timeZone, nowISO);
    expect(result.spent).toBe(400_000);
    expect(result.remaining).toBe(600_000);
    expect(result.progressPct).toBe(40);
    expect(result.status).toBe("ok");
    expect(result.streak).toBeNull();
  });

  it("full: over when spent > cap", () => {
    const days = [
      { date: "2026-09-11", total: 600_000 },
      { date: "2026-09-12", total: 500_000 },
    ];
    const result = periodPosition(days, 1_000_000, "full", 0, timeZone, nowISO);
    expect(result.status).toBe("over");
  });

  it("full: warning at ≥80%", () => {
    const days = [
      { date: "2026-09-11", total: 800_000 },
    ];
    const result = periodPosition(days, 1_000_000, "full", 0, timeZone, nowISO);
    expect(result.status).toBe("warning");
  });
});

describe("buildDashboardData", () => {
  const timeZone = "Asia/Jakarta";
  const nowISO = "2026-09-03T12:00:00+07:00";

  it("clamps end to today (no future days)", () => {
    const budget = {
      type: "daily" as const,
      amount: 50_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      todaySpent: 20_000,
    };
    const sparse: BudgetDayPoint[] = [
      { date: "2026-09-01", total: 10_000 },
      { date: "2026-09-03", total: 20_000 },
    ];
    const data = buildDashboardData(budget, sparse, nowISO, timeZone);
    expect(data.days).toHaveLength(3); // Sep 1, 2, 3 — not 30
    expect(data.days[2]?.date).toBe("2026-09-03");
  });

  it("produces daily deltas for daily budgets", () => {
    const budget = {
      type: "daily" as const,
      amount: 50_000,
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      todaySpent: 20_000,
    };
    const data = buildDashboardData(budget, [{ date: "2026-09-01", total: 10_000 }], nowISO, timeZone);
    const deltas = data.days as Array<{ date: string; total: number; delta: number }>;
    expect(deltas.every((d) => "delta" in d)).toBe(true);
  });

  it("produces no deltas for full budgets", () => {
    const budget = {
      type: "full" as const,
      amount: 1_000_000,
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      todaySpent: 20_000,
    };
    const data = buildDashboardData(budget, [{ date: "2026-09-01", total: 10_000 }], nowISO, timeZone);
    const hasDelta = data.days.some((d) => "delta" in d);
    expect(hasDelta).toBe(false);
  });
});

describe("Streak threshold", () => {
  it("STREAK_MIN_DAYS is 2", () => {
    expect(STREAK_MIN_DAYS).toBe(2);
  });
});

describe("periodPosition — signed position + guards", () => {
  const timeZone = "Asia/Jakarta";
  const nowISO = "2026-09-03T12:00:00+07:00";

  it("daily: position = allowance − spent (signed), elapsed/total days", () => {
    // Allowance 150k, spent 100k → position +50k (under).
    const days = [
      { date: "2026-09-01", total: 50_000 },
      { date: "2026-09-02", total: 50_000 },
      { date: "2026-09-03", total: 0 },
    ];
    const deltas = dailyDeltas(days, 50_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 50_000, "daily", 0, timeZone, nowISO);
    expect(result.allowance).toBe(150_000);
    expect(result.position).toBe(50_000);
    expect(result.elapsedDays).toBe(3);
    expect(result.totalDays).toBe(3);
  });

  it("daily: behind position is negative", () => {
    const days = [
      { date: "2026-09-01", total: 76_785 },
      { date: "2026-09-02", total: 153_405 },
      { date: "2026-09-03", total: 190_019 },
    ];
    const deltas = dailyDeltas(days, 85_000, "daily") as Array<{
      date: string; total: number; delta: number;
    }>;
    const result = periodPosition(deltas, 85_000, "daily", 190_019, timeZone, nowISO);
    // Allowance 255k, spent 420.209 → position −165.209, remaining clamped 0.
    expect(result.position).toBe(255_000 - 420_209);
    expect(result.remaining).toBe(0);
    expect(result.status).toBe("over");
  });

  it("empty series never crashes (upcoming budget)", () => {
    const result = periodPosition([], 50_000, "daily", 0, timeZone, nowISO);
    expect(result.spent).toBe(0);
    expect(result.elapsedDays).toBe(0);
    expect(result.streak).toBeNull();
  });

  it("buildDashboardData with empty sparse + future start → empty days, no crash", () => {
    const budget = {
      type: "daily" as const,
      amount: 50_000,
      startDate: "2026-09-10",
      endDate: "2026-09-30",
      todaySpent: 0,
    };
    const data = buildDashboardData(budget, [], nowISO, timeZone);
    expect(data.days).toHaveLength(0);
    expect(data.periodPosition.streak).toBeNull();
  });
});
