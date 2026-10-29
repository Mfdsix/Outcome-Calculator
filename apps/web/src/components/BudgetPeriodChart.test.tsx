import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetSeriesDay } from "@expense-app/shared";

import { BudgetPeriodChart } from "./BudgetPeriodChart";

const DAILY_DAYS: BudgetSeriesDay[] = [
  { date: "2026-09-01", total: 30_000, delta: 70_000 },
  { date: "2026-09-02", total: 50_000, delta: 50_000 },
];

const FULL_DAYS: BudgetSeriesDay[] = [
  { date: "2026-09-01", total: 40_000 },
  { date: "2026-09-02", total: 60_000 },
];

describe("BudgetPeriodChart — without projection", () => {
  it("renders the actual bars only (no projection artifacts)", () => {
    render(<BudgetPeriodChart days={DAILY_DAYS} type="daily" />);

    expect(screen.getByTestId("budget-period-bar-2026-09-01")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-chart-projection-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-chart-caption")).not.toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain("proyeksi");
  });
});

describe("BudgetPeriodChart — projection overlay", () => {
  it("draws daily ghost bars + a dashed projection line for future days", () => {
    render(
      <BudgetPeriodChart
        days={DAILY_DAYS}
        type="daily"
        projection={{ avgPerDay: 40_000, remainingDays: 2, endDate: "2026-09-04", cap: 100_000 }}
      />,
    );

    expect(screen.getByTestId("budget-chart-ghost-2026-09-03")).toBeInTheDocument();
    expect(screen.getByTestId("budget-chart-ghost-2026-09-04")).toBeInTheDocument();
    expect(screen.getByTestId("budget-chart-projection-line")).toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("termasuk proyeksi");
  });

  it("draws full-budget ghost bars and the caption matching the forecast", () => {
    render(
      <BudgetPeriodChart
        days={FULL_DAYS}
        type="full"
        projection={{
          avgPerDay: 50_000,
          remainingDays: 2,
          endDate: "2026-09-04",
          cap: 1_000_000,
          projectedTotal: 600_000,
        }}
      />,
    );

    expect(screen.getByTestId("budget-chart-ghost-2026-09-03")).toBeInTheDocument();
    expect(screen.getByTestId("budget-chart-caption")).toHaveTextContent(
      "sisa 2 hari × Rp50.000 → proyeksi Rp600.000",
    );
  });
});
