import { afterEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@testing-library/react";

import { useTotalMode } from "./useTotalMode";

describe("useTotalMode", () => {
  const get = (key: string) => localStorage.getItem(key);
  const set = (key: string, value: string) => localStorage.setItem(key, value);

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to 'raw' when nothing persisted", () => {
    const { result } = renderHook(() => useTotalMode());
    expect(result.current.mode).toBe("raw");
  });

  it("reads persisted 'fair' from localStorage", () => {
    set("expense-app.total-mode", "fair");
    const { result } = renderHook(() => useTotalMode());
    expect(result.current.mode).toBe("fair");
  });

  it("toggle switches raw → fair and persists", () => {
    const { result } = renderHook(() => useTotalMode());
    act(() => result.current.toggle());
    expect(result.current.mode).toBe("fair");
    expect(get("expense-app.total-mode")).toBe("fair");
  });

  it("toggle switches fair → raw and persists", () => {
    set("expense-app.total-mode", "fair");
    const { result } = renderHook(() => useTotalMode());
    act(() => result.current.toggle());
    expect(result.current.mode).toBe("raw");
    expect(get("expense-app.total-mode")).toBe("raw");
  });

  it("setMode updates and persists", () => {
    const { result } = renderHook(() => useTotalMode());
    act(() => result.current.setMode("fair"));
    expect(result.current.mode).toBe("fair");
    expect(get("expense-app.total-mode")).toBe("fair");
  });

  it("ignores corrupt storage value, falls back to 'raw'", () => {
    set("expense-app.total-mode", "totally-bogus");
    const { result } = renderHook(() => useTotalMode());
    expect(result.current.mode).toBe("raw");
  });

  it("survives private-mode localStorage throwing", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useTotalMode());
    expect(result.current.mode).toBe("raw");
    act(() => result.current.setMode("fair"));
    expect(result.current.mode).toBe("fair");
    spy.mockRestore();
  });
});
