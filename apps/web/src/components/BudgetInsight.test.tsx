import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetSnapshot } from "@expense-app/shared";

import { BudgetInsight } from "./BudgetInsight";

const UNDER_SNAPSHOT: BudgetSnapshot = {
  spent: 76_785,
  budget: 100_000,
  remaining: 23_215,
  overspent: 0,
  usagePercent: 76.785,
  status: "UNDER",
  applicableDays: 1,
  hasOverlap: true,
};

const WARNING_SNAPSHOT: BudgetSnapshot = {
  spent: 80_000,
  budget: 100_000,
  remaining: 20_000,
  overspent: 0,
  usagePercent: 80,
  status: "WARNING",
  applicableDays: 1,
  hasOverlap: true,
};

const OVER_SNAPSHOT: BudgetSnapshot = {
  spent: 126_785,
  budget: 100_000,
  remaining: 0,
  overspent: 26_785,
  usagePercent: 126.785,
  status: "OVER",
  applicableDays: 1,
  hasOverlap: true,
};

describe("BudgetInsight", () => {
  it("renders pct/bar/spent/remaining for UNDER state", () => {
    render(<BudgetInsight snapshot={UNDER_SNAPSHOT} />);

    expect(screen.getByTestId("budget-insight-pct")).toHaveTextContent("76.8%");
    expect(screen.getByTestId("budget-insight-spent")).toHaveTextContent("Rp76.785");
    expect(screen.getByTestId("budget-insight-remaining")).toHaveTextContent("Rp23.215");
    expect(screen.queryByTestId("budget-insight-overspent")).not.toBeInTheDocument();
  });

  it("shows remaining in the remaining slot for WARNING", () => {
    render(<BudgetInsight snapshot={WARNING_SNAPSHOT} />);

    expect(screen.getByTestId("budget-insight-pct")).toHaveTextContent("80.0%");
    expect(screen.getByTestId("budget-insight-remaining")).toHaveTextContent("Rp20.000");
  });

  it("over budget shows overspent instead of remaining", () => {
    render(<BudgetInsight snapshot={OVER_SNAPSHOT} />);

    expect(screen.getByTestId("budget-insight-pct")).toHaveTextContent("126.8%");
    expect(screen.getByTestId("budget-insight-overspent")).toHaveTextContent("Rp26.785");
    expect(screen.queryByTestId("budget-insight-remaining")).not.toBeInTheDocument();
  });

  it("progressbar aria-valuenow is clamped at 100 even when usage exceeds it", () => {
    render(<BudgetInsight snapshot={OVER_SNAPSHOT} />);

    const bar = screen.getByTestId("budget-insight-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar.getAttribute("role")).toBe("progressbar");
  });

  it("bar width is clamped at 100% while text shows the unclamped value", () => {
    render(<BudgetInsight snapshot={OVER_SNAPSHOT} />);

    const bar = screen.getByTestId("budget-insight-bar");
    const fill = bar.querySelector("div");
    expect(fill).toHaveStyle({ width: "100%" });
  });
});
