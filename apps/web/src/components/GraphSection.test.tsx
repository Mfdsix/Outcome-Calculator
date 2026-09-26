import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { BudgetSnapshot } from "@expense-app/shared";
import type { ChartBucket } from "../lib/chart";

import { BarChart } from "./BarChart";
import { BudgetInsight } from "./BudgetInsight";
import { GraphSection } from "./GraphSection";

const mockBudget: BudgetSnapshot = {
  spent: 76_785,
  budget: 100_000,
  remaining: 23_215,
  overspent: 0,
  usagePercent: 76.785,
  status: "UNDER",
  applicableDays: 1,
  hasOverlap: true,
};

const mockBuckets: ChartBucket[] = [
  { key: "2026-09-25T08", label: "08", total: 50_000, isCurrent: true, kind: "hour" },
  { key: "2026-09-25T10", label: "10", total: 26_785, isCurrent: false, kind: "hour" },
];

describe("GraphSection", () => {
  it("renders no toggle when no active budget", () => {
    render(
      <GraphSection
        activeBudget={false}
        mode="spending"
        onModeChange={vi.fn()}
        buckets={mockBuckets}
        snapshot={null}
      />,
    );

    expect(screen.queryByTestId("graph-mode-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("renders toggle when active budget exists", () => {
    render(
      <GraphSection
        activeBudget={true}
        mode="spending"
        onModeChange={vi.fn()}
        buckets={mockBuckets}
        snapshot={mockBudget}
      />,
    );

    expect(screen.getByTestId("graph-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("graph-mode-spending")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("graph-mode-budget")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("clicking Budget switches to BudgetInsight and calls onModeChange", async () => {
    const onModeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <GraphSection
        activeBudget={true}
        mode="spending"
        onModeChange={onModeChange}
        buckets={mockBuckets}
        snapshot={mockBudget}
      />,
    );

    await user.click(screen.getByTestId("graph-mode-budget"));
    expect(onModeChange).toHaveBeenCalledWith("budget");
  });

  it("renders BudgetInsight when mode is budget + hasOverlap", () => {
    render(
      <GraphSection
        activeBudget={true}
        mode="budget"
        onModeChange={vi.fn()}
        buckets={mockBuckets}
        snapshot={mockBudget}
      />,
    );

    expect(screen.getByTestId("budget-insight")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("renders no-overlap message when snapshot hasOverlap is false", () => {
    render(
      <GraphSection
        activeBudget={true}
        mode="budget"
        onModeChange={vi.fn()}
        buckets={mockBuckets}
        snapshot={{ hasOverlap: false }}
      />,
    );

    expect(screen.getByTestId("budget-insight-no-overlap")).toHaveTextContent(
      "Tidak ada budget yang berlaku untuk periode ini.",
    );
    expect(screen.queryByTestId("budget-insight")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("passes selectedKey/onSelect through to BarChart in spending mode", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <GraphSection
        activeBudget={false}
        mode="spending"
        onModeChange={vi.fn()}
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
