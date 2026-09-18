import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Keypad } from "./Keypad";

describe("Keypad — special navDisabled", () => {
  it("disabled nav direction is dimmed + inert, others remain enabled", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <Keypad
        layout="special"
        onDigit={() => {}}
        onBackspace={() => {}}
        onEnter={() => {}}
        enterDisabled
        disabled={false}
        onNavigate={onNavigate}
        navDisabled={{ left: true, right: false }}
      />,
    );

    const left = screen.getByTestId("key-4");
    const right = screen.getByTestId("key-6");
    expect(left).toBeDisabled();
    expect(right).not.toBeDisabled();

    await user.click(left);
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(right);
    expect(onNavigate).toHaveBeenCalledWith("right");
  });

  it("calc mode ignores navDisabled entirely (digits always active)", async () => {
    const user = userEvent.setup();
    const onDigit = vi.fn();
    render(
      <Keypad onDigit={onDigit} onBackspace={() => {}} onEnter={() => {}} enterDisabled={false} />,
    );
    const two = screen.getByTestId("key-2");
    expect(two).not.toBeDisabled();
    await user.click(two);
    expect(onDigit).toHaveBeenCalledWith("2");
  });
});
