import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { BudgetSnapshot } from "@expense-app/shared";
import type { ChartBucket } from "../lib/chart";

import { GraphSection } from "./GraphSection";

const mockUnder: BudgetSnapshot = {
  spent: 76_785,
  budget: 100_000,
  remaining: 23_215,
  overspent: 0,
  usagePercent: 76.785,
  status: "UNDER",
  applicableDays: 1,
  hasOverlap: true,
};

const mockOver: BudgetSnapshot = {
  spent: 126_785,
  budget: 100_000,
  remaining: 0,
  overspent: 26_785,
  usagePercent: 126.785,
  status: "OVER",
  applicableDays: 1,
  hasOverlap: true,
};

const mockBuckets: ChartBucket[] = [
  { key: "2026-09-25T08", label: "08", total: 50_000, isCurrent: true, kind: "hour" },
  { key: "2026-09-25T10", label: "10", total: 26_785, isCurrent: false, kind: "hour" },
];

describe("GraphSection", () => {
  it("renders a bare chart with no header delta when there is no budget", () => {
    render(<GraphSection buckets={mockBuckets} snapshot={null} />);

    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-budget-delta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("graph-mode-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-insight")).not.toBeInTheDocument();
  });

  it("shows a green +Rp delta when the budget overlaps and is under", () => {
    render(<GraphSection buckets={mockBuckets} snapshot={mockUnder} />);

    const delta = screen.getByTestId("chart-budget-delta");
    expect(delta).toHaveTextContent("+Rp23.215");
    expect(delta).toHaveClass("text-emerald-300");
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("shows a red −Rp delta when overspent", () => {
    render(<GraphSection buckets={mockBuckets} snapshot={mockOver} />);

    const delta = screen.getByTestId("chart-budget-delta");
    expect(delta).toHaveTextContent("−Rp26.785");
    expect(delta).toHaveClass("text-red-300");
  });

  it("renders a bare chart when the snapshot has no overlap", () => {
    render(<GraphSection buckets={mockBuckets} snapshot={{ hasOverlap: false }} />);

    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-budget-delta")).not.toBeInTheDocument();
  });

  it("passes selectedKey/onSelect through to BarChart", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <GraphSection
        buckets={mockBuckets}
        snapshot={null}
        selectedKey="2026-09-25T08"
        onSelect={onSelect}
        title="Per jam"
      />,
    );

    await user.click(screen.getByTestId("bar-2026-09-25T08"));
    expect(onSelect).toHaveBeenCalledWith("2026-09-25T08");
  });
});
