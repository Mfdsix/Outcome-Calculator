import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnIndicator } from "./ConnIndicator";
import { useOnline } from "../hooks/useOnline";

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

describe("useOnline", () => {
  it("tracks navigator.onLine and reacts to online/offline events", () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("reports offline when the liveness probe failed despite navigator.onLine", () => {
    setNavigatorOnline(true);
    const { result, rerender } = renderHook((props: { failed?: boolean } | undefined) => useOnline(props));
    expect(result.current).toBe(true);

    rerender({ failed: true });
    expect(result.current).toBe(false);
  });
});

describe("ConnIndicator", () => {
  it("shows only the green dot when fully online (no Online label)", () => {
    render(<ConnIndicator online syncing={false} pending={0} />);
    const indicator = screen.getByTestId("conn-indicator");
    // Fully connected → no status label, just the green dot.
    expect(screen.queryByTestId("conn-indicator-label")).toBeNull();
    expect(indicator.querySelector("span")).toHaveClass("bg-emerald-500");
  });

  it("renders Offline when disconnected", () => {
    render(<ConnIndicator online={false} syncing={false} pending={0} />);
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Offline");
  });

  it("renders Sync with a pulse while syncing", () => {
    render(<ConnIndicator online syncing pending={3} />);
    const indicator = screen.getByTestId("conn-indicator");
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Sync");
    expect(indicator.querySelector("span")).toHaveClass("animate-pulse");
  });

  it("renders Menunggu N when online with pending ops", () => {
    render(<ConnIndicator online syncing={false} pending={2} />);
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Menunggu 2");
  });

  it("renders Lokal when online but showing the cached snapshot", () => {
    render(<ConnIndicator online syncing={false} pending={0} cached />);
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Lokal");
  });

  it("offline state wins over cached and mentions local storage in the title", () => {
    render(<ConnIndicator online={false} syncing={false} pending={0} cached />);
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Offline");
    expect(screen.getByTestId("conn-indicator")).toHaveAttribute("title");
  });
});
