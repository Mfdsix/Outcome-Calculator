import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { BudgetHistoryItem, BudgetSeriesDay } from "@expense-app/shared";
import { dailyDeltas } from "@expense-app/shared";

import { BudgetPastCard } from "./BudgetPastCard";

function budget(overrides: Partial<BudgetHistoryItem> = {}): BudgetHistoryItem {
  return {
    id: "hist-1",
    type: "full",
    amount: 1_000_000,
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    spent: 350_000,
    capTotal: 1_000_000,
    status: "ok",
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

/** Zero-filled days straight from the source of truth (no hand-written deltas). */
function days(
  totals: number[],
  cap: number,
  type: BudgetHistoryItem["type"] = "full",
  startDay = 1,
): BudgetSeriesDay[] {
  const filled = totals.map((total, index) => ({
    date: `2026-08-${String(startDay + index).padStart(2, "0")}`,
    total,
  }));
  return dailyDeltas(filled, cap, type);
}

const BETTER_SERIES = days(
  [50_000, 50_000, 50_000, 50_000, 50_000, 20_000, 20_000, 20_000, 20_000, 20_000],
  1_000_000,
);

function renderCard(overrides: {
  budget?: Partial<BudgetHistoryItem>;
  days?: BudgetSeriesDay[] | null;
  seriesLoading?: boolean;
  seriesError?: string | null;
  onUseAgain?: () => void;
  onRetry?: () => void;
}) {
  return render(
    <BudgetPastCard
      budget={budget(overrides.budget)}
      days={overrides.days === undefined ? BETTER_SERIES : overrides.days}
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
    renderCard({ days: null, seriesLoading: true });
    expect(screen.getByTestId("budget-past-loading")).toBeInTheDocument();
  });

  it("shows an error banner + retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderCard({ days: null, seriesError: "boom", onRetry });

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
      days: days(
        [20_000, 20_000, 20_000, 20_000, 20_000, 100_000, 100_000, 100_000, 100_000, 100_000],
        1_000_000,
      ),
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
        capTotal: 300_000,
      },
      days: days([100_000, 200_000], 150_000, "daily"),
    });

    expect(screen.getByTestId("budget-past-forecast")).toHaveTextContent(
      "1 dari 2 hari under cap",
    );
  });

  it("omits the forecast row for a single-day range", () => {
    renderCard({
      budget: { startDate: "2026-08-01", endDate: "2026-08-01", spent: 10_000, capTotal: 1_000_000 },
      days: days([10_000], 1_000_000),
    });

    expect(screen.queryByTestId("budget-past-forecast")).not.toBeInTheDocument();
  });

  // --- Daily cap semantics (the bug this card used to have) ----------------

  it("compares a daily period total against the WHOLE-range cap", () => {
    // Rp70.000/hari × 31 hari = Rp2.170.000; spent Rp2.500.000 → over Rp330.000.
    renderCard({
      budget: {
        type: "daily",
        amount: 70_000,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        spent: 2_500_000,
        capTotal: 2_170_000,
        status: "over",
      },
      days: days(Array.from({ length: 31 }, () => 80_645), 70_000, "daily"),
    });

    expect(screen.getByTestId("budget-past-spent")).toHaveTextContent("Rp2.500.000");
    expect(screen.getByTestId("budget-past-card")).toHaveTextContent("Rp2.170.000");
    expect(screen.getByTestId("budget-past-cap-caption")).toHaveTextContent(
      "Rp70.000/hari × 31 hari",
    );
    expect(screen.getByTestId("budget-past-remaining")).toHaveTextContent(
      "lewat Rp330.000 dari cap",
    );
    // Chip must agree with the arithmetic.
    expect(screen.getByTestId("budget-past-card")).toHaveTextContent("Lewat batas");
  });

  it("omits the per-day caption for full budgets", () => {
    renderCard({});
    expect(screen.queryByTestId("budget-past-cap-caption")).not.toBeInTheDocument();
  });

  // --- Daily insights ------------------------------------------------------

  it("summarises daily average, over-cap days and the extreme days", () => {
    renderCard({
      budget: {
        type: "daily",
        amount: 100_000,
        startDate: "2026-08-01",
        endDate: "2026-08-04",
        spent: 310_000,
        capTotal: 400_000,
        status: "warning",
      },
      days: days([40_000, 200_000, 0, 70_000], 100_000, "daily"),
    });

    // (40k + 200k + 0 + 70k) / 4 = 77_500
    expect(screen.getByTestId("budget-past-stat-avg")).toHaveTextContent("Rp77.500");
    expect(screen.getByTestId("budget-past-stat-overdays")).toHaveTextContent("1 dari 4");
    // Best/worst skip the zero-spend day (which would always win).
    expect(screen.getByTestId("budget-past-stat-best")).toHaveTextContent("+Rp60.000");
    expect(screen.getByTestId("budget-past-stat-worst")).toHaveTextContent("−Rp100.000");
    expect(screen.getByTestId("budget-past-stat-zerodays")).toHaveTextContent("1 dari 4");
  });

  it("hides an extreme side that never happened", () => {
    renderCard({
      budget: {
        type: "daily",
        amount: 100_000,
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        spent: 90_000,
        capTotal: 200_000,
      },
      days: days([40_000, 50_000], 100_000, "daily"),
    });

    expect(screen.getByTestId("budget-past-stat-best")).toHaveTextContent("+Rp60.000");
    expect(screen.queryByTestId("budget-past-stat-worst")).not.toBeInTheDocument();
  });

  it("shows only the average and zero-spend count for full budgets", () => {
    renderCard({});

    expect(screen.getByTestId("budget-past-stat-avg")).toBeInTheDocument();
    expect(screen.getByTestId("budget-past-stat-zerodays")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-past-stat-overdays")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-past-stat-best")).not.toBeInTheDocument();
  });

  it("does not render the insight grid before the series loads", () => {
    renderCard({ days: null, seriesLoading: true });
    expect(screen.queryByTestId("budget-past-stats")).not.toBeInTheDocument();
  });
});
