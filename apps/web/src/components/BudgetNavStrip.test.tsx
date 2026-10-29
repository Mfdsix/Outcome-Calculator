import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BudgetNavStrip } from "./BudgetNavStrip";

const LABELS = ["Aktif · Rp150.000/hari", "12 Sep – 11 Okt", "14 Agu – 13 Sep"];

describe("BudgetNavStrip", () => {
  it("is hidden when there is nothing to navigate", () => {
    render(<BudgetNavStrip count={1} activeIndex={0} labels={["Aktif"]} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("budget-nav")).not.toBeInTheDocument();
  });

  it("renders the focused label and disables ‹ at the start", () => {
    render(<BudgetNavStrip count={3} activeIndex={0} labels={LABELS} onSelect={vi.fn()} />);

    expect(screen.getByTestId("budget-nav-label")).toHaveTextContent(LABELS[0]!);
    expect(screen.getByTestId("budget-nav-prev")).toBeDisabled();
    expect(screen.getByTestId("budget-nav-next")).toBeEnabled();
    expect(screen.getByTestId("budget-nav-dot-0")).toHaveAttribute("aria-selected", "true");
  });

  it("disables › at the end", () => {
    render(<BudgetNavStrip count={3} activeIndex={2} labels={LABELS} onSelect={vi.fn()} />);

    expect(screen.getByTestId("budget-nav-next")).toBeDisabled();
    expect(screen.getByTestId("budget-nav-prev")).toBeEnabled();
    expect(screen.getByTestId("budget-nav-label")).toHaveTextContent(LABELS[2]!);
  });

  it("moves with ‹ / › and jumps with a dot", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BudgetNavStrip count={3} activeIndex={1} labels={LABELS} onSelect={onSelect} />);

    await user.click(screen.getByTestId("budget-nav-prev"));
    expect(onSelect).toHaveBeenLastCalledWith(0);

    await user.click(screen.getByTestId("budget-nav-next"));
    expect(onSelect).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByTestId("budget-nav-dot-2"));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
