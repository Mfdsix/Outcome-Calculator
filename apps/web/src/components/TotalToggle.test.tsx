import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TotalToggle } from "./TotalToggle";

describe("TotalToggle", () => {
  it("renders Raw (active) + Fair pills with correct aria", () => {
    render(<TotalToggle mode="raw" onToggle={() => {}} loading={false} />);
    expect(screen.getByTestId("total-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("total-toggle-raw")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("total-toggle-fair")).toHaveAttribute("aria-pressed", "false");
  });

  it("highlights Fair when mode is 'fair'", () => {
    render(<TotalToggle mode="fair" onToggle={() => {}} loading={false} />);
    expect(screen.getByTestId("total-toggle-raw")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("total-toggle-fair")).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onToggle when clicking the inactive pill", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TotalToggle mode="raw" onToggle={onToggle} loading={false} />);
    await user.click(screen.getByTestId("total-toggle-fair"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not call onToggle when clicking the active pill", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TotalToggle mode="raw" onToggle={onToggle} loading={false} />);
    await user.click(screen.getByTestId("total-toggle-raw"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows '…' on Fair pill while loading", () => {
    render(<TotalToggle mode="fair" onToggle={() => {}} loading={true} />);
    expect(screen.getByTestId("total-toggle-fair")).toHaveTextContent("…");
  });

  it("shows 'Fair' on Fair pill when not loading", () => {
    render(<TotalToggle mode="fair" onToggle={() => {}} loading={false} />);
    expect(screen.getByTestId("total-toggle-fair")).toHaveTextContent("Fair");
  });
});
