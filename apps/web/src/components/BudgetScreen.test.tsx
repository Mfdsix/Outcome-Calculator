import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  BudgetActiveResponse,
  BudgetForecast,
  BudgetHistoryItem,
} from "@expense-app/shared";

import { BudgetScreen } from "./BudgetScreen";

const ACTIVE: NonNullable<BudgetActiveResponse["budget"]> = {
  id: "active-1",
  type: "full",
  amount: 3_000_000,
  startDate: "2099-09-01",
  endDate: "2099-09-30",
  spent: 900_000,
  todaySpent: 90_000,
  remaining: 2_100_000,
  status: "ok",
  progressPct: 30,
};

const PAST: BudgetHistoryItem = {
  id: "past-1",
  type: "full",
  amount: 1_000_000,
  startDate: "2026-08-01",
  endDate: "2026-08-10",
  spent: 350_000,
  capTotal: 1_000_000,
  status: "ok",
  createdAt: "2026-08-11T00:00:00.000Z",
};

const PAST_SERIES = [
  { date: "2026-08-01", total: 50_000 },
  { date: "2026-08-02", total: 50_000 },
  { date: "2026-08-03", total: 50_000 },
  { date: "2026-08-04", total: 50_000 },
  { date: "2026-08-05", total: 50_000 },
  { date: "2026-08-06", total: 20_000 },
  { date: "2026-08-07", total: 20_000 },
  { date: "2026-08-08", total: 20_000 },
  { date: "2026-08-09", total: 20_000 },
  { date: "2026-08-10", total: 20_000 },
];

const PAST_DAILY: BudgetHistoryItem = {
  id: "past-daily",
  type: "daily",
  amount: 100_000,
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  spent: 160_000,
  capTotal: 200_000,
  status: "ok",
  createdAt: "2026-08-03T00:00:00.000Z",
};

const PAST_DAILY_SERIES = [
  { date: "2026-08-01", total: 40_000 },
  { date: "2026-08-02", total: 120_000 },
];

const FORECAST: BudgetForecast = {
  available: true,
  avgPerDay: 90_000,
  elapsedDays: 10,
  remainingDays: 20,
  projectedTotal: 2_700_000,
  projectedDelta: 300_000,
  allowedPerDay: 105_000,
  overDays: null,
  totalDays: 30,
};

function Harness({
  history = [PAST],
  pastSeries = { "past-1": PAST_SERIES },
  initialFocus = 0,
}: {
  history?: BudgetHistoryItem[];
  pastSeries?: Record<string, { date: string; total: number }[]>;
  initialFocus?: number;
} = {}) {
  const [focusedIndex, setFocusedIndex] = useState(initialFocus);
  return (
    <BudgetScreen
      active={ACTIVE}
      history={history}
      loading={false}
      onBack={vi.fn()}
      onCreate={vi.fn(async () => true)}
      onRemove={vi.fn(async () => true)}
      series={[]}
      seriesLoading={false}
      budgetTodayMode="raw"
      onToggleBudgetTodayMode={vi.fn()}
      budgetTodaySpentFair={null}
      budgetTodayLoading={false}
      budgetTodayFairFallback={false}
      focusedIndex={focusedIndex}
      onFocusChange={setFocusedIndex}
      budgetList={[ACTIVE, ...history]}
      pastSeries={pastSeries}
      pastSeriesLoading={null}
      pastSeriesError={null}
      onRetryPastSeries={vi.fn()}
      forecast={FORECAST}
    />
  );
}

describe("BudgetScreen — history navigation + forecast", () => {
  it("shows the strip and the active card, without the projection card", () => {
    render(<Harness />);

    expect(screen.getByTestId("budget-nav")).toBeInTheDocument();
    expect(screen.getByTestId("budget-nav-label")).toHaveTextContent("Aktif · Rp3.000.000");
    expect(screen.getByTestId("budget-today")).toBeInTheDocument();
    // Projection moved to the Insight screen — Budget shows actuals only.
    expect(screen.queryByTestId("budget-forecast")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-past-card")).not.toBeInTheDocument();
  });

  it("moves to the past budget with › and back with ‹", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("budget-nav-next"));

    expect(screen.getByTestId("budget-past-card")).toBeInTheDocument();
    expect(screen.getByTestId("budget-past-forecast")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-forecast")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-today")).not.toBeInTheDocument();
    // Focused label switches to the period range (no "Aktif" prefix).
    expect(screen.getByTestId("budget-nav-label").textContent).not.toContain("Aktif");

    await user.click(screen.getByTestId("budget-nav-prev"));
    expect(screen.getByTestId("budget-today")).toBeInTheDocument();
  });

  it("navigates with the desktop arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("budget-past-card")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("budget-today")).toBeInTheDocument();
  });

  it("jumps to a history budget from the Kelola modal", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("budget-kelola-toggle"));
    await user.click(screen.getByTestId("budget-history-view-past-1"));

    expect(screen.getByTestId("budget-past-card")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-history-item-past-1")).not.toBeInTheDocument();
  });

  it("shows the same +/- day history for a focused past budget", () => {
    render(
      <Harness
        history={[PAST_DAILY]}
        pastSeries={{ "past-daily": PAST_DAILY_SERIES }}
        initialFocus={1}
      />,
    );

    expect(screen.getByTestId("budget-past-card")).toBeInTheDocument();
    expect(screen.getByTestId("budget-day-history")).toBeInTheDocument();

    // Newest first, same as the active budget.
    expect(screen.getAllByTestId(/^budget-day-row-/).map((row) => row.getAttribute("data-testid"))).toEqual([
      "budget-day-row-2026-08-02",
      "budget-day-row-2026-08-01",
    ]);
    expect(screen.getByTestId("budget-day-delta-2026-08-01")).toHaveTextContent("+Rp60.000");
    expect(screen.getByTestId("budget-day-delta-2026-08-02")).toHaveTextContent("−Rp20.000");
  });

  it("swaps the day history back to the active budget when navigating home", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        history={[PAST_DAILY]}
        pastSeries={{ "past-daily": PAST_DAILY_SERIES }}
        initialFocus={1}
      />,
    );

    expect(screen.getByTestId("budget-day-row-2026-08-02")).toBeInTheDocument();

    await user.click(screen.getByTestId("budget-nav-prev"));

    // Active budget here has an empty (future) series → no day rows at all.
    expect(screen.queryByTestId("budget-day-row-2026-08-02")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-day-history")).not.toBeInTheDocument();
  });

  it("'Pakai lagi' on a past card opens the prefilled form without moving focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("budget-nav-next"));
    await user.click(screen.getByTestId("budget-past-use-again"));

    expect(await screen.findByTestId("budget-form")).toBeInTheDocument();
    expect(screen.getByTestId("budget-prefill-note")).toBeInTheDocument();
    expect(screen.getByTestId("budget-nav-label").textContent).not.toContain("Aktif");
  });
});
