import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BudgetForecast, Insight } from "@expense-app/shared";

import { InsightScreen } from "./InsightScreen";

function forecast(overrides: Partial<BudgetForecast> = {}): BudgetForecast {
  return {
    available: true,
    avgPerDay: 90_000,
    elapsedDays: 10,
    remainingDays: 20,
    projectedTotal: 2_700_000,
    projectedDelta: 300_000,
    allowedPerDay: 105_000,
    overDays: null,
    totalDays: 30,
    ...overrides,
  };
}

const INSIGHTS: Insight[] = [
  { id: "daily-ok", short: "Sisa Rp25rb hari ini, santai.", full: "Hari ini masih ada Rp25.000 dari jatah Rp100.000 — santai.", tone: "ok" },
];

function renderScreen(props: Partial<ComponentProps<typeof InsightScreen>> = {}) {
  return render(
    <InsightScreen
      insights={INSIGHTS}
      hasBudget
      tickerVisible
      onToggleTicker={vi.fn()}
      onBack={vi.fn()}
      onOpenBudget={vi.fn()}
      {...props}
    />,
  );
}

describe("InsightScreen — Proyeksi section", () => {
  it("renders the projection card below the insight list", () => {
    renderScreen({
      forecast: forecast(),
      activeBudget: { type: "full", amount: 3_000_000 },
    });

    const list = screen.getByTestId("insight-list");
    const section = screen.getByTestId("insight-forecast");

    expect(section).toBeInTheDocument();
    expect(screen.getByTestId("budget-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("budget-forecast-total")).toHaveTextContent("Rp2.700.000");
    // Section comes after the list in document order.
    expect(list.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders a single 'Proyeksi' heading (no duplicated caption)", () => {
    renderScreen({
      forecast: forecast(),
      activeBudget: { type: "full", amount: 3_000_000 },
    });

    expect(screen.getAllByText("Proyeksi")).toHaveLength(1);
  });

  it("supports daily budgets (average + over days)", () => {
    renderScreen({
      forecast: forecast({ projectedTotal: null, projectedDelta: null, allowedPerDay: null, overDays: 3 }),
      activeBudget: { type: "daily", amount: 85_000 },
    });

    expect(screen.getByTestId("budget-forecast-avg")).toHaveTextContent("Rata-rata Rp90.000/hari");
    expect(screen.getByTestId("budget-forecast-days-over")).toHaveTextContent("3 dari 10 hari over");
  });

  it("hides the section without a forecast or before the first elapsed day", () => {
    renderScreen({ forecast: null, activeBudget: { type: "full", amount: 3_000_000 } });
    expect(screen.queryByTestId("insight-forecast")).not.toBeInTheDocument();

    renderScreen({
      forecast: forecast({ available: false }),
      activeBudget: { type: "full", amount: 3_000_000 },
    });
    expect(screen.queryByTestId("insight-forecast")).not.toBeInTheDocument();
  });

  it("hides the section without an active budget", () => {
    renderScreen({ forecast: forecast(), activeBudget: null, hasBudget: false });

    expect(screen.queryByTestId("insight-forecast")).not.toBeInTheDocument();
    expect(screen.getByTestId("insight-cta-budget")).toBeInTheDocument();
  });
});
