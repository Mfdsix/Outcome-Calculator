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

const mockDayBuckets: ChartBucket[] = [
  { key: "2026-09-25", label: "25", total: 190_019, isCurrent: false, kind: "day" },
  { key: "2026-09-26", label: "26", total: 47_000, isCurrent: false, kind: "day" },
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

  it("marks over-cap days faded red, solid red when selected", () => {
    render(<GraphSection buckets={mockDayBuckets} snapshot={mockUnder} dailyCap={85_000} />);

    const overFill = screen
      .getByTestId("bar-2026-09-25")
      .querySelector("span.w-full");
    expect(overFill).not.toBeNull();
    expect(overFill).toHaveClass("bg-red-500/30");

    const underFill = screen
      .getByTestId("bar-2026-09-26")
      .querySelector("span.w-full");
    expect(underFill).not.toBeNull();
    expect(underFill).not.toHaveClass("bg-red-500/30");
  });

  it("selected over-cap day renders solid red with a red value label", () => {
    render(
      <GraphSection
        buckets={mockDayBuckets}
        snapshot={mockUnder}
        dailyCap={85_000}
        selectedKey="2026-09-25"
      />,
    );

    const fill = screen.getByTestId("bar-2026-09-25").querySelector("span.w-full");
    expect(fill).not.toBeNull();
    expect(fill).toHaveClass("bg-red-500");
    expect(screen.getByTestId("bar-value-2026-09-25")).toHaveClass("text-red-300");
  });

  it("month pairs compare against cap × 2 days (no all-red month)", () => {
    const pairBuckets: ChartBucket[] = [
      { key: "2026-09-20", label: "20", total: 100_000, isCurrent: false, kind: "day", endKey: "2026-09-21" },
      { key: "2026-09-22", label: "22", total: 190_019, isCurrent: false, kind: "day", endKey: "2026-09-23" },
    ];
    render(<GraphSection buckets={pairBuckets} snapshot={mockUnder} dailyCap={85_000} />);

    // 100k < 2 × 85k → under, stays neutral.
    const underFill = screen.getByTestId("bar-2026-09-20").querySelector("span.w-full");
    expect(underFill).not.toBeNull();
    expect(underFill).not.toHaveClass("bg-red-500/30");

    // 190.019 > 2 × 85k → over, faded red.
    const overFill = screen.getByTestId("bar-2026-09-22").querySelector("span.w-full");
    expect(overFill).not.toBeNull();
    expect(overFill).toHaveClass("bg-red-500/30");
  });

  it("toggles bars ↔ line and persists the choice", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const { unmount } = render(<GraphSection buckets={mockBuckets} snapshot={mockUnder} />);

    expect(screen.getByTestId("bar-2026-09-25T08")).toBeInTheDocument();
    await user.click(screen.getByTestId("chart-mode-toggle"));
    expect(screen.getByTestId("spending-line")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-2026-09-25T08")).not.toBeInTheDocument();
    expect(localStorage.getItem("expense-app.chart-mode")).toBe("line");

    // Remount reads the persisted choice.
    unmount();
    render(<GraphSection buckets={mockBuckets} snapshot={mockUnder} />);
    expect(screen.getByTestId("spending-line")).toBeInTheDocument();

    await user.click(screen.getByTestId("chart-mode-toggle"));
    expect(screen.getByTestId("bar-2026-09-25T08")).toBeInTheDocument();
    expect(localStorage.getItem("expense-app.chart-mode")).toBe("bar");
    localStorage.clear();
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
