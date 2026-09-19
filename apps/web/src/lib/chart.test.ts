import { describe, expect, it } from "vitest";

import { getZonedParts } from "@expense-app/shared";

import { groupExpensesByDay } from "./chart";
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
