import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Insight } from "@expense-app/shared";

import { InsightTicker } from "./InsightTicker";

const A: Insight = { id: "a", short: "Jalur aman, hari ke-5 dari 30.", full: "A full", tone: "ok" };
const B: Insight = { id: "b", short: "Agak boros ya, −Rp35rb dari jalur.", full: "B full", tone: "warn" };

afterEach(() => {
  vi.useRealTimers();
});

describe("InsightTicker", () => {
  it("renders the first insight as a status button", () => {
    const onOpen = vi.fn();
    render(<InsightTicker insights={[A, B]} onOpen={onOpen} />);

    const ticker = screen.getByTestId("insight-ticker");
    expect(ticker).toHaveTextContent("Jalur aman, hari ke-5 dari 30.");
    expect(ticker).toHaveAttribute("role", "status");
    expect(ticker).toHaveAttribute("aria-label", expect.stringContaining("Jalur aman"));
  });

  it("rotates every 4 seconds with wrap-around", () => {
    vi.useFakeTimers();
    render(<InsightTicker insights={[A, B]} onOpen={vi.fn()} />);

    const ticker = screen.getByTestId("insight-ticker");
    expect(ticker).toHaveTextContent("Jalur aman");

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(ticker).toHaveTextContent("Agak boros ya");

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(ticker).toHaveTextContent("Jalur aman"); // wraps
  });

  it("does not rotate with a single insight", () => {
    vi.useFakeTimers();
    render(<InsightTicker insights={[A]} onOpen={vi.fn()} />);

    const ticker = screen.getByTestId("insight-ticker");
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(ticker).toHaveTextContent("Jalur aman");
  });

  it("tapping the row calls onOpen", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<InsightTicker insights={[A]} onOpen={onOpen} />);

    await user.click(screen.getByTestId("insight-ticker"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
