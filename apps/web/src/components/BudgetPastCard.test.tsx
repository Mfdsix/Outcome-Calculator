import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { BudgetDayPoint, BudgetHistoryItem } from "@expense-app/shared";

import { BudgetPastCard } from "./BudgetPastCard";

function budget(overrides: Partial<BudgetHistoryItem> = {}): BudgetHistoryItem {
  return {
    id: "hist-1",
    type: "full",
    amount: 1_000_000,
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    spent: 350_000,
    status: "ok",
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function series(totals: number[], startDay = 1): BudgetDayPoint[] {
  return totals.map((total, index) => ({
    date: `2026-08-${String(startDay + index).padStart(2, "0")}`,
    total,
  }));
}

const BETTER_SERIES = series([50_000, 50_000, 50_000, 50_000, 50_000, 20_000, 20_000, 20_000, 20_000, 20_000]);

function renderCard(overrides: {
  budget?: Partial<BudgetHistoryItem>;
  series?: BudgetDayPoint[] | null;
  seriesLoading?: boolean;
  seriesError?: string | null;
  onUseAgain?: () => void;
  onRetry?: () => void;
}) {
  return render(
    <BudgetPastCard
      budget={budget(overrides.budget)}
      series={overrides.series === undefined ? BETTER_SERIES : overrides.series}
      seriesLoading={overrides.seriesLoading ?? false}
      seriesError={overrides.seriesError ?? null}
      onUseAgain={overrides.onUseAgain ?? vi.fn()}
      onRetry={overrides.onRetry ?? vi.fn()}
    />,
  );
}

describe("BudgetPastCard", () => {
  it("renders the head, full chart and the floating action", () => {
    renderCard({});

    expect(screen.getByTestId("budget-past-card")).toBeInTheDocument();
    expect(screen.getByTestId("budget-past-spent")).toHaveTextContent("Rp350.000");
    expect(screen.getByTestId("budget-past-remaining")).toHaveTextContent(
      "tersisa Rp650.000 dari cap",
    );
    expect(screen.getByTestId("budget-period-chart")).toBeInTheDocument();
    expect(screen.getByTestId("budget-past-use-again")).toHaveTextContent("Pakai lagi");
  });

  it("calls onUseAgain", async () => {
    const user = userEvent.setup();
    const onUseAgain = vi.fn();
    renderCard({ onUseAgain });

    await user.click(screen.getByTestId("budget-past-use-again"));
    expect(onUseAgain).toHaveBeenCalledTimes(1);
  });

  it("shows a shimmer while the series loads", () => {
    renderCard({ series: null, seriesLoading: true });
    expect(screen.getByTestId("budget-past-loading")).toBeInTheDocument();
  });

  it("shows an error banner + retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderCard({ series: null, seriesError: "boom", onRetry });

    expect(screen.getByTestId("budget-past-error")).toHaveTextContent(
      "Gagal memuat riwayat budget.",
    );
    await user.click(screen.getByTestId("budget-past-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("reflects a better-than-predicted full budget", () => {
    renderCard({});

    expect(screen.getByTestId("budget-past-forecast-pred")).toHaveTextContent(
      "diprediksi under Rp500.000",
    );
    expect(screen.getByTestId("budget-past-forecast-actual")).toHaveTextContent(
      "ternyata under Rp650.000. Konsisten.",
    );
  });

  it("reflects a worse-than-predicted full budget", () => {
    renderCard({
      budget: { spent: 600_000, status: "over" },
      series: series([20_000, 20_000, 20_000, 20_000, 20_000, 100_000, 100_000, 100_000, 100_000, 100_000]),
    });

    expect(screen.getByTestId("budget-past-forecast-pred")).toHaveTextContent(
      "diprediksi under Rp800.000",
    );
    expect(screen.getByTestId("budget-past-forecast-actual")).toHaveTextContent(
      "ternyata over Rp400.000. Next time.",
    );
  });

  it("shows the under-cap summary for a daily past budget", () => {
    renderCard({
      budget: {
        type: "daily",
        amount: 150_000,
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        spent: 300_000,
      },
      series: series([100_000, 200_000]),
    });

    expect(screen.getByTestId("budget-past-forecast")).toHaveTextContent(
      "1 dari 2 hari under cap",
    );
  });

  it("omits the forecast row for a single-day range", () => {
    renderCard({
      budget: { startDate: "2026-08-01", endDate: "2026-08-01", spent: 10_000 },
      series: series([10_000]),
    });

    expect(screen.queryByTestId("budget-past-forecast")).not.toBeInTheDocument();
  });
});
