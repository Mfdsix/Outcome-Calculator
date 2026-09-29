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

  it("hour mode bars: cumulative through each hour vs cap (35+25 ijo, 42+25.5 merah)", () => {
    localStorage.clear();
    // 35k → 60k (under) → 102k → 127,5k (over) on an 85k cap.
    const hourBuckets: ChartBucket[] = [
      { key: "2026-09-28T08", label: "08", total: 35_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T09", label: "09", total: 25_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T10", label: "10", total: 42_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T11", label: "11", total: 25_500, isCurrent: true, kind: "hour" },
    ];
    render(<GraphSection buckets={hourBuckets} snapshot={mockUnder} dailyCap={85_000} />);

    const fillOf = (key: string): Element | null =>
      screen.getByTestId(`bar-${key}`).querySelector("span.w-full");

    for (const key of ["2026-09-28T08", "2026-09-28T09"]) {
      const fill = fillOf(key);
      expect(fill).not.toBeNull();
      expect(fill).not.toHaveClass("bg-red-500");
      expect(fill).not.toHaveClass("bg-red-500/30");
    }

    // Crossing hour (not highlighted) → faded red.
    const crossFill = fillOf("2026-09-28T10");
    expect(crossFill).not.toBeNull();
    expect(crossFill).toHaveClass("bg-red-500/30");

    // Current hour (highlighted) → solid red.
    const currentFill = fillOf("2026-09-28T11");
    expect(currentFill).not.toBeNull();
    expect(currentFill).toHaveClass("bg-red-500");
  });

  it("hour mode bars: nothing red when the day is under cap", () => {
    localStorage.clear();
    const hourBuckets: ChartBucket[] = [
      { key: "2026-09-28T08", label: "08", total: 60_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T10", label: "10", total: 10_000, isCurrent: true, kind: "hour" },
    ];
    render(<GraphSection buckets={hourBuckets} snapshot={mockUnder} dailyCap={100_000} />);

    const currentFill = screen.getByTestId("bar-2026-09-28T10").querySelector("span.w-full");
    expect(currentFill).not.toBeNull();
    expect(currentFill).toHaveClass("bg-emerald-500");
  });

  it("hour mode line: dots turn red from the crossing hour on", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const hourBuckets: ChartBucket[] = [
      { key: "2026-09-28T08", label: "08", total: 35_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T09", label: "09", total: 25_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T10", label: "10", total: 42_000, isCurrent: false, kind: "hour" },
      { key: "2026-09-28T11", label: "11", total: 25_500, isCurrent: true, kind: "hour" },
    ];
    render(<GraphSection buckets={hourBuckets} snapshot={mockUnder} dailyCap={85_000} />);

    await user.click(screen.getByTestId("chart-mode-toggle"));
    expect(screen.getByTestId("chart-point-2026-09-28T08")).toHaveClass("fill-emerald-400");
    expect(screen.getByTestId("chart-point-2026-09-28T09")).toHaveClass("fill-emerald-400");
    expect(screen.getByTestId("chart-point-2026-09-28T10")).toHaveClass("fill-red-400");
    expect(screen.getByTestId("chart-point-2026-09-28T11")).toHaveClass("fill-red-400");
    // Crossing segment + everything after: red; before: emerald.
    const svg = screen.getByTestId("spending-line");
    expect(svg.querySelectorAll("line.stroke-red-500")).toHaveLength(2);
    expect(svg.querySelectorAll("line.stroke-emerald-500")).toHaveLength(1);
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
