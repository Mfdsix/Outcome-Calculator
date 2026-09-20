import { describe, expect, it } from "vitest";

import {
  BUDGET_MAX_DAYS,
  addCivilMonthsClamped,
  budgetProgressPct,
  budgetStatus,
  civilDateSchema,
  createBudgetSchema,
  inclusiveDayCount,
  isFullMonthRange,
  parseCivilDate,
  formatCivilDate,
  suggestCopyDates,
} from "./budget";

const TZ = "Asia/Jakarta";

describe("createBudgetSchema", () => {
  it("accepts a valid full-month payload", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "full",
      amount: 10_000_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-integer / zero / negative amounts (amountSchema reuse)", () => {
    for (const amount of [0, -1000, 35.5]) {
      const parsed = createBudgetSchema.safeParse({
        type: "daily",
        amount,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects amounts above the shared MAX_AMOUNT cap", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "full",
      amount: 2_000_000_000_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non YYYY-MM-DD dates", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "daily",
      amount: 100_000,
      startDate: "17/09/2026",
      endDate: "2026-09-30",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects impossible calendar dates like 2026-02-30", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "daily",
      amount: 100_000,
      startDate: "2026-02-30",
      endDate: "2026-03-30",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects start after end", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "daily",
      amount: 100_000,
      startDate: "2026-09-30",
      endDate: "2026-09-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a one-day budget (start == end)", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "daily",
      amount: 50_000,
      startDate: "2026-09-18",
      endDate: "2026-09-18",
    });
    expect(parsed.success).toBe(true);
  });

  it(`rejects ranges longer than ${BUDGET_MAX_DAYS} days`, () => {
    const parsed = createBudgetSchema.safeParse({
      type: "full",
      amount: 10_000_000,
      startDate: "2026-01-01",
      endDate: "2027-01-02", // 367 days inclusive
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a 366-day budget", () => {
    const parsed = createBudgetSchema.safeParse({
      type: "full",
      amount: 10_000_000,
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("budgetStatus", () => {
  it("ok below 80%", () => {
    expect(budgetStatus(79_999, 100_000)).toBe("ok");
  });

  it("warning exactly at 80% (plan §5: kasus '80% pas')", () => {
    expect(budgetStatus(80_000, 100_000)).toBe("warning");
  });

  it("over beyond 100%", () => {
    expect(budgetStatus(100_001, 100_000)).toBe("over");
  });

  it("spent 0 on a zero-safe cap stays ok", () => {
    expect(budgetStatus(0, 0)).toBe("ok");
  });
});

describe("budgetProgressPct", () => {
  it("rounds and clamps to ≥ 0; can exceed 100 when over", () => {
    expect(budgetProgressPct(36_000, 100_000)).toBe(36);
    expect(budgetProgressPct(0, 100_000)).toBe(0);
    expect(budgetProgressPct(150_000, 100_000)).toBe(150);
    expect(budgetProgressPct(0, 0)).toBe(0);
  });
});

describe("civil date helpers", () => {
  it("civilDateSchema rejects impossible dates", () => {
    expect(civilDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(civilDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(civilDateSchema.safeParse("2026-9-1").success).toBe(false);
    expect(civilDateSchema.safeParse("2026-02-28").success).toBe(true);
  });

  it("parses and formats round-trip", () => {
    expect(formatCivilDate(parseCivilDate("2026-09-17"))).toBe("2026-09-17");
  });

  it("inclusiveDayCount counts both ends", () => {
    expect(inclusiveDayCount("2026-09-01", "2026-09-30")).toBe(30);
    expect(inclusiveDayCount("2026-09-17", "2026-09-17")).toBe(1);
    expect(inclusiveDayCount("2024-02-01", "2024-02-29")).toBe(29);
  });
});

describe("isFullMonthRange", () => {
  it("detects 1 → last day of the same month", () => {
    expect(isFullMonthRange("2026-09-01", "2026-09-30")).toBe(true);
    expect(isFullMonthRange("2024-02-01", "2024-02-29")).toBe(true); // leap
    expect(isFullMonthRange("2023-02-01", "2023-02-28")).toBe(true);
  });

  it("rejects partial months and cross-month ranges", () => {
    expect(isFullMonthRange("2026-09-05", "2026-09-30")).toBe(false);
    expect(isFullMonthRange("2026-09-01", "2026-10-15")).toBe(false);
    expect(isFullMonthRange("2026-08-15", "2026-09-14")).toBe(false);
  });
});

describe("addCivilMonthsClamped", () => {
  it("29 Feb leap → 28 Feb non-leap (plan §5: catat clamp)", () => {
    expect(addCivilMonthsClamped({ year: 2024, month: 2, day: 29 }, 12)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    });
  });

  it("31 Jan → 28/29 Feb depending on year", () => {
    expect(addCivilMonthsClamped({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addCivilMonthsClamped({ year: 2024, month: 1, day: 31 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it("rolls year correctly (Sep + 4 → Jan next year)", () => {
    expect(addCivilMonthsClamped({ year: 2026, month: 9, day: 15 }, 4)).toEqual({
      year: 2027,
      month: 1,
      day: 15,
    });
  });
});

describe("suggestCopyDates", () => {
  it("full-month Sep budget copied in October → 1–31 Oct", () => {
    const now = new Date("2026-10-08T10:00:00+07:00");
    const suggested = suggestCopyDates(
      { startDate: "2026-09-01", endDate: "2026-09-30" },
      TZ,
      now,
    );
    expect(suggested).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("full-month budget copied mid-month stays in this month (user can edit)", () => {
    const now = new Date("2026-10-25T10:00:00+07:00");
    const suggested = suggestCopyDates(
      { startDate: "2026-09-01", endDate: "2026-09-30" },
      TZ,
      now,
    );
    expect(suggested).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("full-month Feb budget in March → 1–31 Mar", () => {
    const now = new Date("2026-03-02T10:00:00+07:00");
    const suggested = suggestCopyDates(
      { startDate: "2026-02-01", endDate: "2026-02-28" },
      TZ,
      now,
    );
    expect(suggested).toEqual({ startDate: "2026-03-01", endDate: "2026-03-31" });
  });

  it("10-day range → today..today+9", () => {
    const now = new Date("2026-10-08T10:00:00+07:00");
    const suggested = suggestCopyDates(
      { startDate: "2026-09-05", endDate: "2026-09-14" },
      TZ,
      now,
    );
    expect(suggested).toEqual({ startDate: "2026-10-08", endDate: "2026-10-17" });
  });

  it("one-day range → today..today", () => {
    const now = new Date("2026-10-08T10:00:00+07:00");
    const suggested = suggestCopyDates(
      { startDate: "2026-09-21", endDate: "2026-09-21" },
      TZ,
      now,
    );
    expect(suggested).toEqual({ startDate: "2026-10-08", endDate: "2026-10-08" });
  });

  it("uses Jakarta civil today, not UTC today (late-evening UTC instant)", () => {
    // 2026-10-31 21:00 WIB == 2026-10-31 14:00 UTC, but an instant like
    // 2026-11-01T00:30+07:00 is still 2026-10-31 in UTC — the reverse case:
    const now = new Date("2026-11-01T00:30:00+07:00"); // Jakarta: 1 Nov
    const suggested = suggestCopyDates(
      { startDate: "2026-09-05", endDate: "2026-09-14" },
      TZ,
      now,
    );
    expect(suggested.startDate).toBe("2026-11-01");
  });

  it("N-day range crossing a month boundary keeps exact length", () => {
    const now = new Date("2026-10-30T10:00:00+07:00");
    const suggested = suggestCopyDates(
      { startDate: "2026-09-05", endDate: "2026-09-14" },
      TZ,
      now,
    );
    expect(suggested).toEqual({ startDate: "2026-10-30", endDate: "2026-11-08" });
  });
});
